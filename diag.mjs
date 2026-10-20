// Diagnostic: dump full transaction details on failure.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xbE760bec3EeBbc3e86Ef67B3F38D4d9C0A3250f4";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

console.log("=== chain info ===");
console.log("chain ID:", client.chain.id);
console.log("consensus:", client.chain.consensusMainContract?.address);

console.log("\n=== read test ===");
try {
  const total = await client.readContract({ address: ADDR, functionName: "total_judgments", args: [] });
  console.log("total_judgments:", total);
} catch (e) {
  console.log("READ FAILED:", e.message);
}

console.log("\n=== write test ===");
try {
  const hash = await client.writeContract({
    address: ADDR,
    functionName: "submit_judgment",
    args: ["diag-1", "What is 2+2?", "4", "I don't know"],
    gasLimit: 5000000n,
  });
  console.log("tx hash:", hash);
  const rc = await client.waitForTransactionReceipt({ hash, retries: 60, interval: 5000 });
  console.log("status:", rc?.statusName ?? rc?.status);
  console.log("tx:", JSON.stringify(rc, null, 2).slice(0, 2000));
} catch (e) {
  console.log("WRITE FAILED:", e.message);
  if (e.cause) console.log("cause:", e.cause);
  if (e.metaMessages) console.log("meta:", e.metaMessages);
}
