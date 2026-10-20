"""Direct-mode tests for Model Output Judge.

No network and no chain: the LLM is mocked, so these tests exercise the
contract's plumbing — input validation, verdict storage, counters, and read
integrity.

They do NOT prove the model discriminates; in direct mode gltest runs only the
leader function and the LLM is a stub. That proof is the live on-chain run.
"""

import json
import re

from tests.direct.conftest import to_hex

PROMPT = "What is the capital of France?"
RESPONSE_A = "The capital of France is Paris."
RESPONSE_B = "France is a country in Europe. Its capital is Paris, which is known for the Eiffel Tower."
LONG_TEXT = "x" * 5000


def _judge_for(vm, prompt_text, winner, reason="Response A is more concise."):
    """Bind one verdict to one prompt.

    The mock matches on the prompt TEXT alone (re.search finds it anywhere in
    the full prompt), which avoids anchoring on the fence marker — the model
    reply is the same regardless of which iteration calls it.
    """
    pattern = re.escape(prompt_text) if prompt_text else r"<<<PROMPT"
    vm.mock_llm(
        pattern,
        json.dumps({"winner": winner, "reason": reason}),
    )


def _submit(vm, c, alice, pid="j1", prompt=PROMPT, a=RESPONSE_A, b=RESPONSE_B):
    vm.sender = alice
    return c.submit_judgment(pid, prompt, a, b)


# ------------------------------------------------------------------ verdicts


def test_response_a_wins(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    _judge_for(direct_vm, PROMPT, "A", "Response A is more concise.")

    direct_vm.sender = direct_alice
    assert c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B) == "A"

    row = c.get_judgment("j1")
    assert row["exists"] is True
    assert row["winner"] == "A"
    assert row["prompt"] == PROMPT
    assert row["response_a"] == RESPONSE_A
    assert row["response_b"] == RESPONSE_B
    assert "concise" in row["reason"]


def test_response_b_wins(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    _judge_for(direct_vm, PROMPT, "B", "Response B is more detailed.")

    direct_vm.sender = direct_alice
    assert c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B) == "B"
    assert c.get_judgment("j1")["winner"] == "B"


def test_tie(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    _judge_for(direct_vm, PROMPT, "TIE", "Both are equally good.")

    direct_vm.sender = direct_alice
    assert c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B) == "TIE"
    assert c.get_judgment("j1")["winner"] == "TIE"


# --------------------------------------------------------------- validation


def test_empty_prompt_id_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    _judge_for(direct_vm, PROMPT, "A")

    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("", PROMPT, RESPONSE_A, RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "prompt_id" in str(exc).lower()


def test_duplicate_prompt_id_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    _judge_for(direct_vm, PROMPT, "A")

    direct_vm.sender = direct_alice
    c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B)
    try:
        c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "already exists" in str(exc).lower()


def test_empty_prompt_text_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("j1", "", RESPONSE_A, RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "prompt_text" in str(exc).lower()


def test_empty_response_a_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("j1", PROMPT, "", RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "response_a" in str(exc).lower()


def test_empty_response_b_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("j1", PROMPT, RESPONSE_A, "")
        assert False, "expected UserError"
    except Exception as exc:
        assert "response_b" in str(exc).lower()


def test_prompt_over_cap_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("j1", LONG_TEXT, RESPONSE_A, RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "prompt_text" in str(exc).lower()


def test_response_over_cap_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.sender = direct_alice
    try:
        c.submit_judgment("j1", PROMPT, LONG_TEXT, RESPONSE_B)
        assert False, "expected UserError"
    except Exception as exc:
        assert "response_a" in str(exc).lower()


# ----------------------------------------------------------------- counters


def test_counters_track_verdicts(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")

    # First judgment: A wins
    _judge_for(direct_vm, PROMPT, "A")
    _submit(direct_vm, c, direct_alice, pid="j1")

    # Second judgment: B wins
    PROMPT_2 = "What is the capital of Japan?"
    RESP_A_2 = "Tokyo."
    RESP_B_2 = "Tokyo is the capital of Japan. It is the largest city in Japan."
    _judge_for(direct_vm, PROMPT_2, "B")
    _submit(direct_vm, c, direct_alice, pid="j2", prompt=PROMPT_2, a=RESP_A_2, b=RESP_B_2)

    # Third judgment: TIE
    PROMPT_3 = "What is the capital of Germany?"
    RESP_A_3 = "Berlin is the capital of Germany."
    RESP_B_3 = "Berlin is the capital of Germany."
    _judge_for(direct_vm, PROMPT_3, "TIE")
    _submit(direct_vm, c, direct_alice, pid="j3", prompt=PROMPT_3, a=RESP_A_3, b=RESP_B_3)

    counts = c.verdict_counts()
    assert counts["a"] == 1
    assert counts["b"] == 1
    assert counts["tie"] == 1
    assert counts["total"] == 3


def test_total_judgments_matches_index(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")

    for i in range(5):
        p = f"prompt {i}"
        _judge_for(direct_vm, p, "A")
        _submit(direct_vm, c, direct_alice, pid=f"j{i}", prompt=p)

    assert int(c.total_judgments()) == 5
    listed = c.list_judgments(0, 20)
    assert listed["total"] == 5
    assert len(listed["judgments"]) == 5


def test_list_judgments_pagination(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")

    for i in range(5):
        p = f"prompt {i}"
        _judge_for(direct_vm, p, "A")
        _submit(direct_vm, c, direct_alice, pid=f"j{i}", prompt=p)

    page1 = c.list_judgments(0, 2)
    assert len(page1["judgments"]) == 2
    page2 = c.list_judgments(2, 2)
    assert len(page2["judgments"]) == 2
    page3 = c.list_judgments(4, 2)
    assert len(page3["judgments"]) == 1


def test_get_judgment_not_found(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    row = c.get_judgment("nonexistent")
    assert row["exists"] is False


def test_limits_exposes_caps(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    lim = c.limits()
    assert lim["max_prompt_chars"] == 2000
    assert lim["max_response_chars"] == 4000
    assert lim["max_id_chars"] == 200
    assert lim["verdicts"] == ["A", "B", "TIE"]


def test_invalid_llm_reply_defaults_to_tie(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    c = direct_deploy("contracts/model_judge.py")
    direct_vm.mock_llm(
        re.escape(PROMPT),
        "I cannot decide.",
    )

    direct_vm.sender = direct_alice
    assert c.submit_judgment("j1", PROMPT, RESPONSE_A, RESPONSE_B) == "TIE"
