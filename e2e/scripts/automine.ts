/**
 * Automine script - advances Aztec blocks every 5 seconds
 *
 * Aztec sandbox only advances blocks on transaction submission.
 * This script runs in an infinite loop, sending transactions to simulate automining.
 *
 * Usage:
 *   cd e2e && bun run scripts/automine.ts
 *
 * Environment:
 *   AUTOMINE_INTERVAL - Interval in ms between transactions (default: 5000)
 *   PXE_URL - PXE endpoint (default: http://localhost:8080)
 */

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";
const INTERVAL_MS = parseInt(process.env.AUTOMINE_INTERVAL || "5000", 10);

async function main() {
  console.log("═".repeat(50));
  console.log("  AZTEC AUTOMINE");
  console.log("═".repeat(50));
  console.log(`\nPXE URL: ${PXE_URL}`);
  console.log(`Interval: ${INTERVAL_MS}ms\n`);

  // Load Aztec modules
  console.log("[1/3] Loading Aztec modules...");
  const { createAztecNodeClient, waitForNode } = await import("@aztec/aztec.js/node");
  const { TestWallet } = await import("@aztec/test-wallet/server");
  const {
    INITIAL_TEST_SECRET_KEYS,
    INITIAL_TEST_SIGNING_KEYS,
    INITIAL_TEST_ACCOUNT_SALTS,
  } = await import("@aztec/accounts/testing");
  const { AaveWrapperContract } = await import("../src/generated/AaveWrapper");
  const { EthAddress } = await import("@aztec/foundation/eth-address");

  // Connect to node
  console.log("[2/3] Connecting to Aztec node...");
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);

  const nodeInfo = await node.getNodeInfo();
  console.log(`  Connected to node version ${nodeInfo.nodeVersion}`);

  // Create wallet
  console.log("[3/3] Creating test wallet...");
  const wallet = await TestWallet.create(node, { proverEnabled: false });
  const account = await wallet.createSchnorrAccount(
    INITIAL_TEST_SECRET_KEYS[0]!,
    INITIAL_TEST_ACCOUNT_SALTS[0]!,
    INITIAL_TEST_SIGNING_KEYS[0]!
  );
  console.log(`  Wallet address: ${account.address.toString().slice(0, 20)}...`);

  // Mock addresses for contract deployment
  const mockPortal = EthAddress.fromString("0x1234567890123456789012345678901234567890");
  const mockBridgedToken = account.address;
  const mockFeeTreasury = account.address;

  console.log("\n" + "─".repeat(50));
  console.log("  AUTOMINE RUNNING (Ctrl+C to stop)");
  console.log("─".repeat(50) + "\n");

  let txCount = 0;

  // Infinite loop
  while (true) {
    try {
      const blockBefore = await node.getBlockNumber();
      txCount++;

      process.stdout.write(`[${new Date().toISOString()}] TX #${txCount}: block ${blockBefore} → `);

      // Deploy a contract to create a block
      await AaveWrapperContract.deploy(wallet, account.address, mockPortal, mockBridgedToken, mockFeeTreasury)
        .send({ from: account.address })
        .deployed();

      const blockAfter = await node.getBlockNumber();
      console.log(`${blockAfter} ✓`);
    } catch (error) {
      console.log(`failed: ${error instanceof Error ? error.message.slice(0, 50) : "Unknown"}`);
    }

    // Wait before next transaction
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nAutomine stopped.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\nAutomine stopped.");
  process.exit(0);
});

main().catch((error) => {
  console.error("\n✗ Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
