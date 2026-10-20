// Live discrimination test for Model Output Judge.
//
// Submits three judgments with clear expected winners:
//   - A: response A is clearly better
//   - B: response B is clearly better
//   - TIE: both responses are identical
// Paced 45s apart to avoid rate-limiting.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xbE760bec3EeBbc3e86Ef67B3F38D4d9C0A3250f4";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const CASES = [
  ["live-a-wins", "What is 2+2?", "The answer is 4.", "I think it might be 4, or maybe 5, I'm not sure.", "A"],
  ["live-b-wins", "What is 2+2?", "I don't know math.", "The answer is 4.", "B"],
  ["live-tie", "What is 2+2?", "The answer is 4.", "The answer is 4.", "TIE"],
];

async function send(fn, args) {
  const hash = await client.writeContract({ address: ADDR, functionName: fn, args, gasLimit: 5000000n });
  const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
  return rc?.statusName ?? rc?.status ?? "unknown";
}

async function readBack(pid) {
  for (let i = 0; i < 6; i++) {
    const r = await client.readContract({ address: ADDR, functionName: "get_judgment", args: [pid] });
    if (r?.exists) return r;
    await sleep(3000);
  }
  return null;
}

const results = [];
for (const [pid, prompt, a, b, expect] of CASES) {
  let winner = null;
  const out = await send("submit_judgment", [pid, prompt, a, b]);
  if (out === "FINISHED_WITH_RETURN") {
    const row = await readBack(pid);
    winner = row?.winner ?? null;
  }
  const ok = winner === expect;
  results.push({ pid, expect, winner, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${pid} -> ${expect}  got=${winner} (${out})`);
  await sleep(45000);
}

const counts = await client.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
console.log("\nverdict_counts():", JSON.stringify(counts));
const failed = results.filter((r) => !r.ok);
console.log(`\n=== live discrimination: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) console.log("failed:", failed.map((f) => f.pid).join("; "));
