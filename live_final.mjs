// Live discrimination test for Model Output Judge.
//
// Status 5 (numeric FINISHED_WITH_RETURN) means committed. Unique prompt_ids
// per run — a retry on a committed pid hits the duplicate guard and reverts.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const RUN = Date.now().toString(36);
const CASES = [
  [`${RUN}-a`, "What is 2+2?", "The answer is 4.", "I think it might be 4, or maybe 5, I'm not sure.", "A"],
  [`${RUN}-b`, "What is 2+2?", "I don't know math.", "The answer is 4.", "B"],
  [`${RUN}-tie`, "What is 2+2?", "The answer is 4.", "The answer is 4.", "TIE"],
];

const isCommitted = (s) => s === "FINISHED_WITH_RETURN" || s === 5;

async function readBack(pid) {
  for (let i = 0; i < 12; i++) {
    const r = await client.readContract({ address: ADDR, functionName: "get_judgment", args: [pid] });
    if (r?.exists) return r;
    await sleep(3000);
  }
  return null;
}

const results = [];
for (const [pid, prompt, a, b, expect] of CASES) {
  let winner = null, status = "unknown";
  try {
    const hash = await client.writeContract({
      address: ADDR, functionName: "submit_judgment", args: [pid, prompt, a, b], gasLimit: 5000000n,
    });
    const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
    status = String(rc?.statusName ?? rc?.status ?? "unknown");
    if (isCommitted(status)) {
      const row = await readBack(pid);
      winner = row?.winner ?? null;
    }
  } catch (e) {
    status = `ERROR: ${e.message.slice(0, 60)}`;
  }
  const ok = winner === expect;
  results.push({ pid, expect, winner, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${pid} -> ${expect}  got=${winner} (${status})`);
  await sleep(45000);
}

const counts = await client.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
console.log("\nverdict_counts():", JSON.stringify(counts));
const failed = results.filter((r) => !r.ok);
console.log(`\n=== live discrimination: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) console.log("failed:", failed.map((f) => f.pid).join("; "));
