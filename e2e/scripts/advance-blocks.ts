/**
 * Advance Aztec blocks by sending transactions
 *
 * This script deploys AaveWrapper contract instances to produce blocks.
 * Each deployment transaction produces a new L2 block in the Aztec sandbox.
 *
 * Usage:
 *   cd e2e && bun run scripts/advance-blocks.ts
 *   cd e2e && bun run scripts/advance-blocks.ts 5  # advance 5 blocks
 *
 * Prerequisites:
 *   - Local devnet running (make devnet-up)
 */

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";
const DEFAULT_BLOCKS = 2;

async function main() {
  const numBlocks = parseInt(process.argv[2] || String(DEFAULT_BLOCKS), 10);

  console.log("═".repeat(50));
  console.log("  AZTEC BLOCK ADVANCEMENT");
  console.log("═".repeat(50));
  console.log(`\nTarget: ${numBlocks} block(s)`);
  console.log(`PXE URL: ${PXE_URL}\n`);

  // Load Aztec modules
  console.log("[1/4] Loading Aztec modules...");
  const { createAztecNodeClient, waitForNode } = await import("@aztec/aztec.js/node");
  const { TestWallet } = await import("@aztec/test-wallet/server");
  const {
    INITIAL_TEST_SECRET_KEYS,
    INITIAL_TEST_SIGNING_KEYS,
    INITIAL_TEST_ACCOUNT_SALTS,
  } = await import("@aztec/accounts/testing");

  // Connect to node
  console.log("[2/4] Connecting to Aztec node...");
  const node = createAztecNodeClient(PXE_URL);
  await waitForNode(node);

  const nodeInfo = await node.getNodeInfo();
  console.log(`  Connected to node version ${nodeInfo.nodeVersion}`);

  const initialBlock = await node.getBlockNumber();
  console.log(`  Initial block number: ${initialBlock}`);

  // Create wallet
  console.log("[3/4] Creating test wallet...");
  const wallet = await TestWallet.create(node, { proverEnabled: false });
  const account = await wallet.createSchnorrAccount(
    INITIAL_TEST_SECRET_KEYS[0]!,
    INITIAL_TEST_ACCOUNT_SALTS[0]!,
    INITIAL_TEST_SIGNING_KEYS[0]!
  );
  console.log(`  Wallet address: ${account.address.toString().slice(0, 20)}...`);

  // Deploy the AaveWrapper contract (or use existing) to have something to call
  console.log(`[4/4] Sending ${numBlocks} transaction(s) to advance blocks...`);

  // Load the AaveWrapper contract to call it
  const { AaveWrapperContract } = await import("../src/generated/AaveWrapper");
  const { EthAddress } = await import("@aztec/foundation/eth-address");

  // Deploy a fresh contract instance - deployment creates a block
  console.log(`  Deploying AaveWrapper contract (creates block)...`);
  const mockPortal = EthAddress.fromString("0x1234567890123456789012345678901234567890");
  // Use account address as mock bridged token and fee treasury for testing
  const mockBridgedToken = account.address;
  const mockFeeTreasury = account.address;

  let contract;
  try {
    contract = await AaveWrapperContract.deploy(wallet, account.address, mockPortal, mockBridgedToken, mockFeeTreasury)
      .send({ from: account.address })
      .deployed();
    console.log(`  ✓ Contract deployed at ${contract.address.toString().slice(0, 20)}...`);
  } catch (error) {
    console.error(`  ✗ Deployment failed:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Check block after deployment
  let currentBlock = await node.getBlockNumber();
  console.log(`  Block after deployment: ${currentBlock}`);

  // If we need more blocks, call a view function repeatedly
  // (view functions don't create blocks, but we can use other methods)
  const blocksFromDeployment = currentBlock - initialBlock;
  const remainingBlocks = numBlocks - blocksFromDeployment;

  if (remainingBlocks > 0) {
    console.log(`  Need ${remainingBlocks} more block(s)...`);

    // For each remaining block, we need to send a state-changing transaction
    // Since AaveWrapper doesn't have a simple "increment" function,
    // we'll deploy additional contract instances
    for (let i = 0; i < remainingBlocks; i++) {
      currentBlock = await node.getBlockNumber();
      console.log(`  [${blocksFromDeployment + i + 1}/${numBlocks}] Block ${currentBlock} → deploying another instance...`);

      try {
        const extraContract = await AaveWrapperContract.deploy(wallet, account.address, mockPortal, mockBridgedToken, mockFeeTreasury)
          .send({ from: account.address })
          .deployed();
        console.log(`    ✓ Deployed at ${extraContract.address.toString().slice(0, 20)}...`);
      } catch (error) {
        console.log(`    ✗ Failed: ${error instanceof Error ? error.message.slice(0, 50) : "Unknown"}`);
      }
    }
  }

  // Verify block advancement
  const finalBlock = await node.getBlockNumber();
  const blocksAdvanced = finalBlock - initialBlock;

  console.log("\n" + "─".repeat(50));
  console.log("  RESULT");
  console.log("─".repeat(50));
  console.log(`  Initial block: ${initialBlock}`);
  console.log(`  Final block:   ${finalBlock}`);
  console.log(`  Blocks advanced: ${blocksAdvanced}`);

  if (blocksAdvanced >= numBlocks) {
    console.log("\n✓ Successfully advanced blocks");
  } else if (blocksAdvanced > 0) {
    console.log(`\n⚠ Advanced ${blocksAdvanced} blocks (requested ${numBlocks})`);
    console.log("  Note: Aztec sandbox may batch transactions into fewer blocks");
  } else {
    console.log("\n⚠ No blocks advanced");
    console.log("  Check sandbox logs for errors.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n✗ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });

// Make this file a module to avoid "duplicate function" errors in TypeScript
export {};
