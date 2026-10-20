# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Model Output Judge — decentralized reward model.

Submit a prompt plus two model responses (A and B). AI validators independently
judge which response is better and why. The contract reaches consensus on the
winner (A, B, or TIE) and stores it on-chain with reasoning.

The judgment — "which response is better?" — has no deterministic oracle. It
requires understanding quality, relevance, accuracy, and helpfulness, and every
validator can independently reach the judgment itself.

Storage is parallel TreeMaps of scalars — no @allow_storage dataclass, which this
GenVM build accepts at deploy then stores no code. No funds are held or moved.
"""

import json
import re
from datetime import datetime, timezone

from genlayer import *

# Every input to the prompt is capped. A heavy prompt times the round out
# (VALIDATORS_TIMEOUT 12 / LEADER_TIMEOUT 13) instead of disagreeing.
MAX_PROMPT_CHARS = 2000
MAX_RESPONSE_CHARS = 4000
MAX_REASON_CHARS = 500
MAX_ID_CHARS = 200

VERDICTS = ("A", "B", "TIE")


def _parse_obj(raw) -> dict:
    """Salvage a JSON object from a reply that happens to be JSON."""
    if isinstance(raw, dict):
        return raw
    text = re.sub(r"```json\s*", "", str(raw), flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        text = match.group()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass
    token = re.search(r'"winner"\s*:\s*"?(A|B|TIE)"?', text, flags=re.IGNORECASE)
    if token:
        return {"winner": token.group(1)}
    return {}


def _parse_lines(text: str) -> dict:
    """Parse the plain-text reply: a WINNER line plus a REASON line."""
    out = {}
    winner = re.search(r"WINNER\s*:\s*(A|B|TIE)", text, flags=re.IGNORECASE)
    if winner:
        out["winner"] = winner.group(1).upper()
    reason = re.search(r"REASON\s*:\s*(.+)", text, flags=re.IGNORECASE | re.DOTALL)
    if reason:
        out["reason"] = reason.group(1).strip()
    return out


def _normalize(data: dict) -> dict:
    """Coerce any parsed reply into {winner, reason}; default is the safe value."""
    winner = str(data.get("winner", "")).strip().upper()
    if winner not in VERDICTS:
        winner = "TIE"
    return {
        "winner": winner,
        "reason": str(data.get("reason", "")).strip()[:MAX_REASON_CHARS],
    }


def _sanitise(text: str) -> str:
    """Strip fence markers so untrusted content cannot close its own fence."""
    for marker in ("<<<PROMPT", "PROMPT>>>", "<<<RESPONSE_A", "RESPONSE_A>>>",
                   "<<<RESPONSE_B", "RESPONSE_B>>>"):
        text = text.replace(marker, "")
    return text


def _judge(prompt: str, response_a: str, response_b: str) -> dict:
    """Judge which of two responses is better.

    The reply is PLAIN TEXT, never response_format="json": a JSON reply crosses
    the calldata boundary as a parsed object, and the encoder takes only
    bytes/str/Sequence/Mapping — so one float field makes the whole response
    unencodable and the verdict is lost. Plain text always crosses.

    All three inputs are fenced and sanitised, or a response containing a
    fence marker could close its own fence and inject instructions.
    """
    prompt_text = (
        "You are a rigorous evaluator. Decide which of the two responses (A or B) "
        "better answers the prompt.\n\n"
        "Judge ONLY on: relevance, accuracy, completeness, clarity, and helpfulness. "
        "Do not favour a response for being longer or for matching your style.\n\n"
        "<<<PROMPT\n"
        + _sanitise(prompt) + "\n"
        + "PROMPT>>>\n\n"
        "<<<RESPONSE_A\n"
        + _sanitise(response_a) + "\n"
        + "RESPONSE_A>>>\n\n"
        "<<<RESPONSE_B\n"
        + _sanitise(response_b) + "\n"
        + "RESPONSE_B>>>\n\n"
        "Reply with exactly two lines and no other text:\n"
        "WINNER: A\n"
        "REASON: one sentence explaining why that response is better\n\n"
        "Use B or TIE in place of A when that is the answer."
    )
    raw = gl.nondet.exec_prompt(prompt_text)
    if isinstance(raw, dict):
        return _normalize(raw)
    text = str(raw)
    data = _parse_obj(text)
    if not data:
        data = _parse_lines(text)
    return _normalize(data)


class ModelJudge(gl.Contract):
    # judgments — parallel TreeMaps keyed by prompt_id, scalar values only
    prompt_text: TreeMap[str, str]
    response_a: TreeMap[str, str]
    response_b: TreeMap[str, str]
    judge_verdict: TreeMap[str, str]
    judge_reasoning: TreeMap[str, str]
    judge_created: TreeMap[str, u256]
    judge_count: u256 = u256(0)

    # enumeration index
    judge_index: TreeMap[str, str]

    # public-good counters
    count_a: u256 = u256(0)
    count_b: u256 = u256(0)
    count_tie: u256 = u256(0)

    def __init__(self):
        self.judge_count = u256(0)
        self.count_a = u256(0)
        self.count_b = u256(0)
        self.count_tie = u256(0)

    def _consensus(self, prompt: str, response_a: str, response_b: str) -> dict:
        # The leader judges; each validator independently re-judges and agrees
        # only if its verdict matches the leader's.
        c = prompt
        ra = response_a
        rb = response_b

        def leader_fn() -> dict:
            return _judge(c, ra, rb)

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            data = leader_res.calldata
            if not isinstance(data, dict):
                return False
            verdict = str(data.get("winner", "")).upper()
            if verdict not in VERDICTS:
                return False
            mine = _judge(c, ra, rb).get("winner")
            # Only a POSITIVE contrary finding blocks: a run returning TIE where
            # the leader picked A or B is honest uncertainty, not fabrication,
            # and requiring those to match deadlocks the round. An A/B flip
            # still blocks.
            return mine == verdict or mine == "TIE"

        result = gl.vm.run_nondet(leader_fn, validator_fn)
        data = result.calldata if hasattr(result, "calldata") else result
        return data if isinstance(data, dict) else {}

    @gl.public.write
    def submit_judgment(self, prompt_id: str, prompt_text: str,
                        response_a: str, response_b: str) -> str:
        # Submit a prompt and two responses for consensus judging.
        prompt_id = str(prompt_id).strip()
        if not prompt_id:
            raise gl.vm.UserError("prompt_id required")
        if len(prompt_id) > MAX_ID_CHARS:
            raise gl.vm.UserError(f"prompt_id must be {MAX_ID_CHARS} characters or fewer")
        if self.prompt_text.get(prompt_id, None) is not None:
            raise gl.vm.UserError(f"Judgment {prompt_id} already exists")
        prompt_text = str(prompt_text).strip()
        if not prompt_text:
            raise gl.vm.UserError("prompt_text required")
        if len(prompt_text) > MAX_PROMPT_CHARS:
            raise gl.vm.UserError(f"prompt_text must be {MAX_PROMPT_CHARS} characters or fewer")
        response_a = str(response_a).strip()
        if not response_a:
            raise gl.vm.UserError("response_a required")
        if len(response_a) > MAX_RESPONSE_CHARS:
            raise gl.vm.UserError(f"response_a must be {MAX_RESPONSE_CHARS} characters or fewer")
        response_b = str(response_b).strip()
        if not response_b:
            raise gl.vm.UserError("response_b required")
        if len(response_b) > MAX_RESPONSE_CHARS:
            raise gl.vm.UserError(f"response_b must be {MAX_RESPONSE_CHARS} characters or fewer")

        outcome = self._consensus(prompt_text, response_a, response_b)
        winner = str(outcome.get("winner", "TIE")).upper()
        if winner not in VERDICTS:
            winner = "TIE"

        index = int(self.judge_count)
        self.prompt_text[prompt_id] = prompt_text
        self.response_a[prompt_id] = response_a
        self.response_b[prompt_id] = response_b
        self.judge_verdict[prompt_id] = winner
        self.judge_reasoning[prompt_id] = str(outcome.get("reason", ""))[:MAX_REASON_CHARS]
        self.judge_created[prompt_id] = u256(int(datetime.now(timezone.utc).timestamp()))
        self.judge_index[str(index)] = prompt_id
        self.judge_count = u256(index + 1)
        if winner == "A":
            self.count_a += u256(1)
        elif winner == "B":
            self.count_b += u256(1)
        else:
            self.count_tie += u256(1)
        return winner

    @gl.public.view
    def get_judgment(self, prompt_id: str) -> dict:
        prompt_id = str(prompt_id)
        if self.prompt_text.get(prompt_id, None) is None:
            return {"exists": False}
        return {
            "exists": True,
            "prompt_id": prompt_id,
            "prompt": self.prompt_text[prompt_id],
            "response_a": self.response_a[prompt_id],
            "response_b": self.response_b[prompt_id],
            "winner": self.judge_verdict[prompt_id],
            "reason": self.judge_reasoning[prompt_id],
            "created_at": int(self.judge_created[prompt_id]),
        }

    @gl.public.view
    def list_judgments(self, offset: u256, limit: u256) -> dict:
        """Page the judgment set; `limit` is clamped to 20."""
        start = int(offset)
        total = int(self.judge_count)
        count = min(int(limit), 20)
        out = []
        for i in range(start, min(start + count, total)):
            pid = self.judge_index.get(str(i), None)
            if pid is None:
                continue
            out.append({
                "prompt_id": pid,
                "winner": self.judge_verdict.get(pid, ""),
                "created_at": int(self.judge_created.get(pid, u256(0))),
            })
        return {"offset": start, "total": total, "judgments": out}

    @gl.public.view
    def total_judgments(self) -> u256:
        return self.judge_count

    @gl.public.view
    def verdict_counts(self) -> dict:
        return {
            "a": int(self.count_a),
            "b": int(self.count_b),
            "tie": int(self.count_tie),
            "total": int(self.judge_count),
        }

    @gl.public.view
    def probe(self) -> str:
        """Diagnostic: returns a simple string to verify the contract is callable."""
        return "probe-ok"

    @gl.public.view
    def limits(self) -> dict:
        return {
            "max_prompt_chars": MAX_PROMPT_CHARS,
            "max_response_chars": MAX_RESPONSE_CHARS,
            "max_reason_chars": MAX_REASON_CHARS,
            "max_id_chars": MAX_ID_CHARS,
            "verdicts": list(VERDICTS),
        }
