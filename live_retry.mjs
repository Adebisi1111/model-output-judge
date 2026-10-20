// Live discrimination test with retry: revert-tolerant, fresh pid per attempt.
//
// The consensus contract intermittently reverts a submission (node-side
// capacity/leader error), so each case retries with a NEW prompt_id — reusing a
// committed pid hits the duplicate guard and reverts too.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const CASES = [
  ["a", "What is 2+2?", "The answer is 4.", "I think it might be 4, or maybe 5, I'm not sure.", "A"],
  ["b", "What is 2+2?", "I don't know math.", "The answer is 4.", "B"],
  ["tie", "What is 2+2?", "The answer is 4.", "The answer is 4.", "TIE"],
];

const isCommitted = (s) => s === "FINISHED_WITH_RETURN" || s === 5;

async function readBack(pid) {
  for (let i = 0; i < 15; i++) {
    const r = await client.readContract({ address: ADDR, functionName: "get_judgment", args: [pid] });
    if (r?.exists) return r;
    await sleep(4000);
  }
  return null;
}

let n = 0;
const results = [];
for (const [label, prompt, a, b, expect] of CASES) {
  let winner = null, last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pid = `r${Date.now().toString(36)}-${label}-${attempt}`;
    try {
      const hash = await client.writeContract({
        address: ADDR, functionName: "submit_judgment", args: [pid, prompt, a, b], gasLimit: 5000000n,
      });
      const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
      const status = String(rc?.statusName ?? rc?.status ?? "unknown");
      last = status;
      if (isCommitted(status)) {
        const row = await readBack(pid);
        winner = row?.winner ?? null;
        if (winner) break;
        last = `${status} but read-back empty`;
      }
    } catch (e) {
      last = `ERR ${e.message.slice(0, 50)}`;
    }
    console.log(`  [${label}] attempt ${attempt}: ${last}`);
    await sleep(90000);
  }
  const ok = winner === expect;
  results.push({ label, expect, winner, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  case-${label} -> ${expect}  got=${winner}`);
  await sleep(60000);
}

const counts = await client.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
console.log("\nverdict_counts():", JSON.stringify(counts));
const failed = results.filter((r) => !r.ok);
console.log(`\n=== live discrimination: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) console.log("failed:", failed.map((f) => f.label).join("; "));
