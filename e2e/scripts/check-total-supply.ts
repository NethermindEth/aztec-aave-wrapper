/**
 * Simple script to check BridgedToken total_supply and balance
 * Uses low-level storage reads to avoid wallet API issues
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { readFileSync } from "fs";
import { join } from "path";

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";
const TARGET_WALLET = process.argv[2] || "0x240b398965c86b47d59c1f42ca4dff87b5d1c857f15f9089b5c35ff02a1a2b1f";

async function main() {
  console.log("=".repeat(60));
  console.log("BridgedToken State Check");
  console.log("=".repeat(60));

  // Load deployment addresses
  const deploymentsPath = join(__dirname, "../../.deployments.local.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));

  console.log(`BridgedToken: ${deployments.l2.bridgedToken}`);
  console.log(`Target wallet: ${TARGET_WALLET}`);
  console.log();

  // Connect to Aztec node
  console.log(`Connecting to ${PXE_URL}...`);
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);

  const blockNumber = await node.getBlockNumber();
  console.log(`Current L2 block: ${blockNumber}\n`);

  // Parse addresses
  const bridgedTokenAddress = AztecAddress.fromString(deployments.l2.bridgedToken);

  // Read public storage slots directly
  // From BridgedToken.ts: total_supply slot is 10
  const TOTAL_SUPPLY_SLOT = new Fr(10n);

  // Try to read public storage
  console.log("=== PUBLIC STORAGE ===");

  try {
    // Use getPublicStorageAt if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeAny = node as any;

    if (typeof nodeAny.getPublicStorageAt === "function") {
      const totalSupplyValue = await nodeAny.getPublicStorageAt(bridgedTokenAddress, TOTAL_SUPPLY_SLOT);
      console.log(`total_supply (slot 10): ${totalSupplyValue?.toString() ?? "null"}`);

      if (totalSupplyValue) {
        const supply = BigInt(totalSupplyValue.toString());
        console.log(`  = ${supply} units = ${Number(supply) / 1_000_000} USDC`);
      }
    } else {
      console.log("getPublicStorageAt not available on node client");

      // Try alternative: getStorageAt
      if (typeof nodeAny.getStorageAt === "function") {
        const totalSupplyValue = await nodeAny.getStorageAt(bridgedTokenAddress, TOTAL_SUPPLY_SLOT);
        console.log(`total_supply via getStorageAt: ${totalSupplyValue?.toString() ?? "null"}`);
      }
    }

    // Also check admin slot (7) and portal_address slot (11 for BridgedToken)
    // Note: From the generated code, the slots are:
    // admin: slot 1, minter: slot 2, portal_address: slot 3
    // But looking at the contract, it uses:
    // admin: PublicMutable
    // minter: PublicMutable
    // portal_address: PublicImmutable

  } catch (error) {
    console.log(`Storage read failed: ${error}`);
  }

  // Check for L1->L2 messages
  console.log("\n=== L1->L2 MESSAGES ===");
  try {
    // Try to get message count or recent messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeAny = node as any;

    // Check various methods that might be available
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(node));
    const l1l2Methods = methods.filter(m => m.toLowerCase().includes('l1') || m.toLowerCase().includes('message'));
    console.log(`Available L1/message methods: ${l1l2Methods.join(', ')}`);

  } catch (error) {
    console.log(`Message query failed: ${error}`);
  }

  // Try to check if target wallet has any registered notes
  console.log("\n=== PRIVATE NOTES INFO ===");
  const targetAddress = AztecAddress.fromString(TARGET_WALLET);
  console.log(`Target: ${targetAddress.toString()}`);
  console.log("Note: Private notes can only be decrypted by the owner's PXE");
  console.log("The Azguard wallet must sync to discover new notes");

  console.log("\n" + "=".repeat(60));
  console.log("Done");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
