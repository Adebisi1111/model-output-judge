// Clean end-to-end verification for Model Output Judge — fresh client per submit.
//
// A fresh client re-reads the nonce from the chain, so a stale cached nonce from
// a previous run cannot fail a submission. Verification reads the counters and
// the judgment list at the end, which is on-chain ground truth.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const fresh = () => createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

const state = async () => {
  const c = fresh();
  const counts = await c.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
  const listed = await c.readContract({ address: ADDR, functionName: "list_judgments", args: [0, 60] });
  return { counts, listed };
};

const RUN = Date.now().toString(36);
const CASES = [
  [`${RUN}-a`, "What is the capital of France?", "The capital of France is Paris.", "France is in Asia, and its capital is Tokyo.", "A"],
  [`${RUN}-b`, "What is the capital of France?", "I have no idea.", "The capital of France is Paris.", "B"],
  [`${RUN}-tie`, "What is the capital of France?", "The capital of France is Paris.", "The capital of France is Paris.", "TIE"],
];

const before = await state();
console.log("BEFORE: counts", JSON.stringify(before.counts), "| total", before.listed.total, "\n");

const submitted = [];
for (const [pid, prompt, a, b, expect] of CASES) {
  const c = fresh();
  let status = "unknown";
  try {
    const hash = await c.writeContract({
      address: ADDR, functionName: "submit_judgment", args: [pid, prompt, a, b], gasLimit: 5000000n,
    });
    const rc = await c.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
    status = String(rc?.statusName ?? rc?.status ?? "unknown");
  } catch (e) {
    status = `ERR ${e.message.slice(0, 60)}`;
  }
  submitted.push({ pid, expect, status });
  console.log(`  submit ${pid} (${expect}): ${status}`);
  await sleep(60000);
}

console.log("\nwaiting for state propagation (90s)...");
await sleep(90000);

const after = await state();
console.log("\nAFTER: counts", JSON.stringify(after.counts), "| total", after.listed.total, "\n");

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
console.log(`counts delta: a +${Number(after.counts.a) - Number(before.counts.a)}, b +${Number(after.counts.b) - Number(before.counts.b)}, tie +${Number(after.counts.tie) - Number(before.counts.tie)}`);
console.log(`\n=== ${passed}/${submitted.length} cases committed with the correct verdict ===`);
