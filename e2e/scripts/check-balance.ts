import { createPXEClient, AztecAddress, Contract } from "@aztec/aztec.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

async function main() {
  const deployments = JSON.parse(
    readFileSync("/home/ametel/source/aztec-aave-wrapper/.deployments.local.json", "utf8")
  );

  const pxe = await createPXEClient("http://localhost:8080");

  // Get registered accounts
  const accounts = await pxe.getRegisteredAccounts();
  console.log("Registered accounts:", accounts.length);

  for (const account of accounts) {
    console.log("  -", account.address.toString());
  }

  // BridgedToken address
  const bridgedTokenAddr = deployments.l2.bridgedToken;
  console.log("\nBridgedToken address:", bridgedTokenAddr);

  // Load contract artifact
  const artifactPath = "/home/ametel/source/aztec-aave-wrapper/aztec/target/bridged_token-BridgedToken.json";
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  // Check balance for each account
  for (const account of accounts) {
    try {
      const wallet = await pxe.getWallet(account.address);
      const contract = await Contract.at(
        AztecAddress.fromString(bridgedTokenAddr),
        artifact,
        wallet
      );

      const balance = await (contract.methods as any).balance_of_private(account.address).simulate();
      const addrStr = account.address.toString();
      console.log("\nBalance for " + addrStr.slice(0, 20) + "...:", balance?.toString?.() ?? balance);
    } catch (e) {
      const addrStr = account.address.toString();
      console.log("\nError getting balance for " + addrStr.slice(0, 20) + "...:", (e as Error).message);
    }
  }
}

main().catch(console.error);
