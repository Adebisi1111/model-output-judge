// Capture the FULL revert reason for a consensus-contract revert.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const pid = `diag-${Date.now().toString(36)}`;
console.log("submitting", pid);
const c = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

try {
  const hash = await c.writeContract({
    address: ADDR, functionName: "submit_judgment",
    args: [pid, "What is the capital of France?", "I have no idea.", "The capital of France is Paris."],
    gasLimit: 5000000n,
  });
  console.log("tx hash:", hash);
  const rc = await c.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
  console.log("status:", rc?.statusName ?? rc?.status);
  console.log("execution:", rc?.txExecutionResultName ?? "?");
  console.log("messages:", JSON.stringify(rc?.messages ?? []));
  console.log("vote:", JSON.stringify(rc?.votes ?? rc?.vote ?? "n/a"));
  console.log("raw:", JSON.stringify(rc, null, 2).slice(0, 3000));
} catch (e) {
  console.log("\n=== FULL ERROR ===");
  console.log("message:", e.message);
  console.log("cause:", JSON.stringify(e.cause, null, 2) ?? e.cause);
  console.log("details:", e.details);
  console.log("metaMessages:", e.metaMessages);
  console.log("stack:", e.stack?.split("\n").slice(0, 4).join("\n"));
  const m = /0x[0-9a-f]{64}/i.exec(e.message);
  if (m) {
    console.log("\n=== transaction detail ===");
    try {
      const tx = await c.getTransaction({ hash: m[0] });
      console.log(JSON.stringify(tx, null, 2).slice(0, 4000));
    } catch (e2) {
      console.log("getTransaction failed:", e2.message.slice(0, 200));
    }
  }
}
