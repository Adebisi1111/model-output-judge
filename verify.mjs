// Verify source parity for Model Output Judge.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { Wallet } from "ethers";

const ADDR = "0xa008B85c04a93eAaf5bB95C3895fce7F66171c04";
const KS = "/home/administrator/.genlayer/keystores/user_wallet.json";
const wallet = Wallet.fromEncryptedJsonSync(readFileSync(KS, "utf8"), process.env.GLPASS);
const client = createClient({ chain: testnetBradbury, account: createAccount(wallet.privateKey) });

const local = readFileSync(new URL("./contracts/model_judge.py", import.meta.url), "utf8");
const code = await client.getContractCode(ADDR);
const live = typeof code === "string" ? code : String(code);
const h = (s) => createHash("sha256").update(s, "utf8").digest("hex");

console.log("=== source parity ===");
console.log("live bytes :", Buffer.byteLength(live, "utf8"));
console.log("local bytes:", Buffer.byteLength(local, "utf8"));
console.log("live  sha256:", h(live));
console.log("local sha256:", h(local));
console.log("MATCH      :", h(live) === h(local) ? "YES" : "NO");

console.log("\n=== live reads ===");
const lim = await client.readContract({ address: ADDR, functionName: "limits", args: [] });
console.log("limits():", JSON.stringify(lim));
const total = await client.readContract({ address: ADDR, functionName: "total_judgments", args: [] });
console.log("total_judgments():", total);
const counts = await client.readContract({ address: ADDR, functionName: "verdict_counts", args: [] });
console.log("verdict_counts():", JSON.stringify(counts));
