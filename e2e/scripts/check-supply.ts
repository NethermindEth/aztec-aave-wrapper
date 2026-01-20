import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { readFileSync } from "fs";
import { join } from "path";

const PXE_URL = "http://localhost:8080";

async function main() {
  const deployments = JSON.parse(readFileSync(join(__dirname, "../../.deployments.local.json"), "utf-8"));
  console.log("BridgedToken:", deployments.l2.bridgedToken);

  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);

  const blockNumber = await node.getBlockNumber();
  console.log("Current L2 block:", blockNumber);

  const contractAddress = AztecAddress.fromString(deployments.l2.bridgedToken);

  // Try reading public storage using getPublicStorageAt
  console.log("\nTrying to read public storage...");
  try {
    // total_supply is at slot 12 according to generated contract
    const totalSupplySlot = new Fr(12n);
    console.log("Checking for getPublicStorageAt on node...");

    // The node client should have this method
    const methods = Object.keys(node).filter(k => typeof (node as any)[k] === 'function');
    console.log("Node methods:", methods.length > 0 ? methods.join(", ") : "none visible (proxy)");

    // Try with block number - getPublicStorageAt(contract, slot, blockNumber)
    console.log("Trying getPublicStorageAt with contract, slot, blockNumber...");
    const result = await (node as any).getPublicStorageAt(contractAddress, totalSupplySlot, blockNumber);
    console.log("total_supply (slot 12):", result?.toString?.() ?? result);
  } catch (err) {
    console.log("Error:", err instanceof Error ? err.message : err);

    // Try with just contract and slot
    try {
      console.log("\nTrying without block number...");
      const result2 = await (node as any).getPublicStorageAt(contractAddress, new Fr(12n));
      console.log("Result:", result2?.toString?.() ?? result2);
    } catch (e2) {
      console.log("Also failed:", e2 instanceof Error ? e2.message : e2);
    }
  }
  
  // Try another approach - get contract data
  console.log("\nTrying getContractData...");
  try {
    const contractData = await (node as any).getContractData(contractAddress);
    console.log("Contract data:", contractData ? "found" : "not found");
    if (contractData) {
      console.log("Contract keys:", Object.keys(contractData).join(", "));
    }
  } catch (err) {
    console.log("Error:", err instanceof Error ? err.message : err);
  }
}

main().catch(console.error);
