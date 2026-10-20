// Diagnostic: test probe view and simple writes on the new contract.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { Wallet } from "ethers";

const ADDR = "0xF90e3003EF437B26e381aC1d221Ac83be6AB52b7";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

console.log("=== probe view ===");
try {
  const r = await client.readContract({ address: ADDR, functionName: "probe", args: [] });
  console.log("probe:", r);
} catch (e) {
  console.log("PROBE FAILED:", e.message);
}

console.log("\n=== simple write (identical responses = TIE, no consensus) ===");
try {
  const hash = await client.writeContract({
    address: ADDR,
    functionName: "submit_judgment",
    args: ["diag-tie", "Hello", "World", "World"],
    gasLimit: 5000000n,
  });
  const rc = await client.waitForTransactionReceipt({ hash, retries: 60, interval: 5000 });
  console.log("status:", rc?.statusName ?? rc?.status);
} catch (e) {
  console.log("WRITE FAILED:", e.message.slice(0, 200));
}

console.log("\n=== write with consensus (different responses) ===");
try {
  const hash = await client.writeContract({
    address: ADDR,
    functionName: "submit_judgment",
    args: ["diag-consensus", "What is 2+2?", "4", "I don't know"],
    gasLimit: 5000000n,
  });
  const rc = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000 });
  console.log("status:", rc?.statusName ?? rc?.status);
  if (rc?.statusName === "FINISHED_WITH_RETURN") {
    const row = await client.readContract({ address: ADDR, functionName: "get_judgment", args: ["diag-consensus"] });
    console.log("winner:", row?.winner);
  }
} catch (e) {
  console.log("WRITE FAILED:", e.message.slice(0, 200));
}
