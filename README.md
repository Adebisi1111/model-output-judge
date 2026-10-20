# Model Output Judge — Decentralized Reward Model

A standalone GenLayer Intelligent Contract. Anyone submits a prompt plus two model responses (A and B). AI validators independently judge which response is better and why. The contract reaches consensus on the winner (A, B, or TIE) and stores it on-chain with reasoning.

- **Contract (Bradbury, chain 4221):** `0x21B27bf664f87Fe909970bEe18440cd86A5b2B56`
- **Explorer:** https://explorer-bradbury.genlayer.com/address/0x21B27bf664f87Fe909970bEe18440cd86A5b2B56
- **Source:** `contracts/model_judge.py` (10,127 bytes)

## Why this belongs on GenLayer

The judgment — *which response is better?* — has no deterministic oracle. You cannot write a function that compares two natural language responses and decides which is more helpful, accurate, or relevant. It requires reading and interpretation, and every validator can independently reach the judgment itself.

The stored verdict is a durable, consensus-derived artifact that any other contract or application can query. That artifact **is** the product.

## How a verdict is reached

One leader/validator round per judgment, via `gl.vm.run_nondet`:

1. The **leader** reads the prompt and both responses, judges which is better, and returns the verdict with reasoning.
2. Each **validator** independently re-reads the same prompt and responses, **re-judges** which is better, and agrees only if its verdict matches the leader's.

That second clause is the substantive check: the validator judges the content, it does not audit the leader's formatting.

## Public API

| Method | Kind | Purpose |
|---|---|---|
| `submit_judgment(prompt_id, prompt_text, response_a, response_b)` | write | Judge two responses against a prompt |
| `get_judgment(prompt_id)` | view | Full record: prompt, responses, winner, reasoning, timestamp |
| `list_judgments(offset, limit)` | view | Page the judgment set (`limit` clamped to 20) |
| `total_judgments()` | view | Judgments recorded |
| `verdict_counts()` | view | `{a, b, tie, total}` |
| `limits()` | view | The caps a caller must respect |

### Using it

```javascript
await client.writeContract({
  address: "0x21B27bf664f87Fe909970bEe18440cd86A5b2B56",
  functionName: "submit_judgment",
  args: ["j1", "What is 2+2?", "The answer is 4.", "I don't know math."],
  gasLimit: 5000000n,   // REQUIRED — GenLayer cannot estimate gas for nondet writes
});
```

### Caps

`limits()` returns them, so a caller never has to guess:

| Cap | Value | Why |
|---|---|---|
| `max_prompt_chars` | 2000 | the prompt is submitter-controlled and goes into the LLM call |
| `max_response_chars` | 4000 | each response is submitter-controlled |
| `max_reason_chars` | 500 | keeps the stored record bounded |
| `max_id_chars` | 200 | a key in a TreeMap; unbounded is a storage-bloat vector |

## Verification

### Source parity

`getContractCode` at the address returns the source running on-chain, and its
sha256 is identical to the committed `contracts/model_judge.py`:

```
live bytes : 10127
local bytes: 10127
live  sha256: c7f30afc402d0a1ddcb6c84f08976d34bb647161f15caf221daf5dd994e95396
local sha256: c7f30afc402d0a1ddcb6c84f08976d34bb647161f15caf221daf5dd994e95396
MATCH      : YES
```

### Live discrimination

Three judgments submitted against the live contract:

| Prompt | Response A | Response B | Expected | Committed |
|---|---|---|---|---|
| "What is 2+2?" | "The answer is 4." | "I think it might be 4, or maybe 5..." | A wins | `counts.a += 1` |
| "What is 2+2?" | "I don't know math." | "The answer is 4." | B wins | `counts.b += 1` |
| "What is 2+2?" | "The answer is 4." | "The answer is 4." | TIE | `counts.tie += 1` |

Final on-chain state: `verdict_counts() = {a:1, b:1, tie:1, total:3}` — the committee correctly discriminated all three cases.

## Tests

```bash
gltest tests/direct -q     # 16 passed
```

| File | Tests | Covers |
|---|---|---|
| `test_model_judge.py` | 16 | plumbing: validation, verdict storage, counters, pagination, defaults |

## Design notes

- **Storage** is parallel `TreeMap`s of scalars. No `@allow_storage` dataclass:
  this GenVM build accepts such a contract at deploy and then stores no code.
- **All integer storage fields are `u256`.**
- **Imports are at the top.** `import json` below the class breaks the transpiler.
- **The model reply is plain text**, never `response_format="json"`.
- **No funds are held or moved.** The verdict is the artifact.

## Layout

```
contracts/model_judge.py                        the contract (10,127 B)
tests/direct/test_model_judge.py                16 tests
deploy.mjs / verify.mjs                         deploy + source parity
live_check.mjs                                  live discrimination test
README.md / gltest.config.yaml / .gitignore
```
