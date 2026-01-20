/**
 * Read BridgedToken public storage directly via node API
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { readFileSync } from "fs";
import { join } from "path";

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

async function main() {
  console.log("=".repeat(60));
  console.log("BridgedToken Public Storage Read");
  console.log("=".repeat(60));

  // Load deployment addresses
  const deploymentsPath = join(__dirname, "../../.deployments.local.json");
  const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));

  console.log(`BridgedToken: ${deployments.l2.bridgedToken}`);

  // Connect to Aztec node
  console.log(`\nConnecting to ${PXE_URL}...`);
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);

  const blockNumber = await node.getBlockNumber();
  console.log(`Current L2 block: ${blockNumber}`);

  // Parse contract address
  const contractAddress = AztecAddress.fromString(deployments.l2.bridgedToken);

  // From BridgedToken.ts storage layout:
  // admin: slot 1
  // minter: slot 2
  // portal_address: slot 3
  // authorized_burners: slot 4 (map)
  // name: slot 5
  // symbol: slot 6
  // decimals: slot 7
  // total_supply: slot 8 (wait, checking generated code)

  // Actually from the generated BridgedToken.ts:
  // admin: slot 1
  // minter: slot 2
  // portal_address: slot 3
  // authorized_burners: map starting at 4 (skip)
  // name: slot 5
  // symbol: slot 6
  // decimals: slot 7
  // total_supply: slot 10
  // balances: slot 11 (map)

  console.log("\n=== PUBLIC STORAGE SLOTS ===\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeAny = node as any;

  // Try different methods to read storage
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(node));
  console.log("Available node methods:");
  const storageMethods = methods.filter(m =>
    m.includes('storage') || m.includes('Storage') ||
    m.includes('state') || m.includes('State') ||
    m.includes('public') || m.includes('Public')
  );
  console.log(storageMethods.join(', ') || "none found");

  // Try getPublicStorageAt
  if (typeof nodeAny.getPublicStorageAt === 'function') {
    console.log("\nUsing getPublicStorageAt:");
    try {
      const slot10 = await nodeAny.getPublicStorageAt(contractAddress, new Fr(10n));
      console.log(`  Slot 10 (total_supply): ${slot10?.toString?.() ?? slot10}`);
    } catch (e) {
      console.log(`  Error: ${e}`);
    }
  }

  // Try simulatePublicStorageRead if available
  if (typeof nodeAny.simulatePublicStorageRead === 'function') {
    console.log("\nUsing simulatePublicStorageRead:");
    try {
      const result = await nodeAny.simulatePublicStorageRead(contractAddress, new Fr(10n));
      console.log(`  Result: ${result?.toString?.() ?? result}`);
    } catch (e) {
      console.log(`  Error: ${e}`);
    }
  }

  // Try getting via block state
  if (typeof nodeAny.getBlock === 'function') {
    console.log("\nTrying to get block state:");
    try {
      const block = await nodeAny.getBlock(blockNumber);
      console.log(`  Block ${blockNumber}: ${block ? 'found' : 'not found'}`);
      if (block) {
        console.log(`  Block keys: ${Object.keys(block).join(', ')}`);
      }
    } catch (e) {
      console.log(`  Error: ${e}`);
    }
  }

  // List all methods for debugging
  console.log("\n=== ALL NODE METHODS ===");
  console.log(methods.filter(m => !m.startsWith('_')).join('\n'));

  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
