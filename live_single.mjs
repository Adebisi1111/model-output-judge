// Single-claim live test with retry.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function submitWithRetry(pid, prompt, a, b, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  attempt ${attempt}...`);
      const hash = await client.writeContract({
        address: ADDR,
        functionName: "submit_judgment",
        args: [pid, prompt, a, b],
        gasLimit: 5000000n,
      });
      const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
      const status = rc?.statusName ?? rc?.status ?? "unknown";
      console.log(`  status: ${status}`);
      if (status === "FINISHED_WITH_RETURN") {
        await sleep(4000);
        const row = await client.readContract({ address: ADDR, functionName: "get_judgment", args: [pid] });
        return row;
      }
      console.log(`  retrying after ${status}...`);
    } catch (e) {
      console.log(`  error: ${e.message.slice(0, 100)}`);
    }
    await sleep(45000);
  }
  return null;
}

console.log("=== single claim test ===");
const result = await submitWithRetry(
  "live-test-1",
  "What is 2+2?",
  "The answer is 4.",
  "I don't know math."
);

if (result) {
  console.log("\nSUCCESS:");
  console.log("  winner:", result.winner);
  console.log("  reason:", result.reason);
} else {
  console.log("\nFAILED after retries");
}
