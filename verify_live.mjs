// Clean end-to-end verification for Model Output Judge.
//
// Method: snapshot chain state -> submit 3 fresh cases -> wait for propagation
// -> snapshot again -> assert 3 new judgments with the correct winners.
// Reading the counters/list at the end is ground truth and avoids the
// read-back propagation delay that made earlier harnesses report false failures.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const R = (fn, args) => client.readContract({ address: ADDR, functionName: fn, args });
const state = async () => ({
  counts: await R("verdict_counts", []),
  listed: await R("list_judgments", [0, 50]),
});

const RUN = Date.now().toString(36);
const CASES = [
  [`${RUN}-a`, "What is the capital of France?", "The capital of France is Paris.", "France is in Asia, and its capital is Tokyo.", "A"],
  [`${RUN}-b`, "What is the capital of France?", "I have no idea.", "The capital of France is Paris.", "B"],
  [`${RUN}-tie`, "What is the capital of France?", "The capital of France is Paris.", "The capital of France is Paris.", "TIE"],
];

const before = await state();
console.log("BEFORE: counts", JSON.stringify(before.counts));
console.log("BEFORE: total", before.listed.total, "judgments\n");

const submitted = [];
for (const [pid, prompt, a, b, expect] of CASES) {
  let status = "unknown";
  try {
    const hash = await client.writeContract({
      address: ADDR, functionName: "submit_judgment", args: [pid, prompt, a, b], gasLimit: 5000000n,
    });
    const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
    status = String(rc?.statusName ?? rc?.status ?? "unknown");
  } catch (e) {
    status = `ERR ${e.message.slice(0, 60)}`;
  }
  submitted.push({ pid, expect, status });
  console.log(`  submit ${pid} (${expect}): ${status}`);
  await sleep(60000);
}

// Wait for state propagation
console.log("\nwaiting for state propagation (90s)...");
await sleep(90000);

const after = await state();
console.log("\nAFTER: counts", JSON.stringify(after.counts));
console.log("AFTER: total", after.listed.total, "judgments\n");

// Verify each submitted case
const byId = Object.fromEntries(after.listed.judgments.map((j) => [j.prompt_id, j.winner]));
let passed = 0;
console.log("=== results ===");
for (const { pid, expect, status } of submitted) {
  const got = byId[pid];
  const ok = got === expect;
  if (ok) passed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${pid} expected=${expect} got=${got} (${status})`);
}

const delta = after.listed.total - before.listed.total;
console.log(`\nnew judgments on chain: ${delta}`);
console.log(`verdict_counts delta: a +${Number(after.counts.a) - Number(before.counts.a)}, b +${Number(after.counts.b) - Number(before.counts.b)}, tie +${Number(after.counts.tie) - Number(before.counts.tie)}`);
console.log(`\n=== ${passed}/${submitted.length} cases committed with the correct verdict ===`);
