// Robust live test: nonce handling, retry, and full error triage.
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
  ["live-a-wins", "What is 2+2?", "The answer is 4.", "I think it might be 4, or maybe 5, I'm not sure.", "A"],
  ["live-b-wins", "What is 2+2?", "I don't know math.", "The answer is 4.", "B"],
  ["live-tie", "What is 2+2?", "The answer is 4.", "The answer is 4.", "TIE"],
];

async function send(fn, args, attempt) {
  const hash = await client.writeContract({ address: ADDR, functionName: fn, args, gasLimit: 5000000n });
  const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
  const status = rc?.statusName ?? rc?.status ?? "unknown";
  if (status === "FINISHED_WITH_RETURN") return { ok: true, status };
  // Non-terminal: return the status so the caller can decide
  return { ok: false, status, hash };
}

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
  let winner = null, lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await send("submit_judgment", [pid, prompt, a, b], attempt);
      if (res.ok) {
        const row = await readBack(pid);
        winner = row?.winner ?? null;
        break;
      }
      lastErr = `status=${res.status}`;
    } catch (e) {
      lastErr = e.message.slice(0, 120);
    }
    console.log(`  [${pid}] attempt ${attempt} failed: ${lastErr}`);
    await sleep(45000);
  }
  const ok = winner === expect;
  results.push({ pid, expect, winner, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${pid} -> ${expect}  got=${winner}`);
  await sleep(20000);
}

const counts = await client.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
console.log("\nverdict_counts():", JSON.stringify(counts));
const failed = results.filter((r) => !r.ok);
console.log(`\n=== live discrimination: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) console.log("failed:", failed.map((f) => f.pid).join("; "));
