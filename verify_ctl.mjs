// Controlled single-submission test with retry on the node-side revert.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const fresh = () => createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

console.log("=== node health ===");
try {
  const c = fresh();
  const total = await c.readContract({ address: ADDR, functionName: "total_judgments", args: [] });
  const counts = await c.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
  console.log("read OK — total:", total, "counts:", JSON.stringify(counts));
} catch (e) {
  console.log("READ FAILED:", e.message.slice(0, 120));
}

const expect = "B";
const prompt = "What is the capital of France?";
const a = "I have no idea.";
const b = "The capital of France is Paris.";

let winner = null, status = "";
for (let attempt = 1; attempt <= 3 && !winner; attempt++) {
  const pid = `ctl-${Date.now().toString(36)}-${attempt}`;
  const c = fresh();
  try {
    const hash = await c.writeContract({
      address: ADDR, functionName: "submit_judgment", args: [pid, prompt, a, b], gasLimit: 5000000n,
    });
    const rc = await c.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
    status = String(rc?.statusName ?? rc?.status ?? "unknown");
    if (status === "FINISHED_WITH_RETURN" || status === "5") {
      await sleep(30000);
      const row = await c.readContract({ address: ADDR, functionName: "get_judgment", args: [pid] });
      winner = row?.winner ?? null;
      if (!winner) {
        console.log(`  attempt ${attempt}: committed but read-back empty, re-checking list`);
        const listed = await c.readContract({ address: ADDR, functionName: "list_judgments", args: [0, 60] });
        winner = listed.judgments.find((j) => j.prompt_id === pid)?.winner ?? null;
      }
    }
  } catch (e) {
    status = `ERR ${e.message.slice(0, 80)}`;
  }
  console.log(`  attempt ${attempt}: ${status} -> winner=${winner}`);
  if (!winner) await sleep(60000);
}

console.log("\n=== RESULT ===");
if (winner) {
  console.log(`winner: ${winner}  expected: ${expect}  -> ${winner === expect ? "PASS" : "FAIL"}`);
} else {
  console.log("no verdict committed after 3 attempts");
}
