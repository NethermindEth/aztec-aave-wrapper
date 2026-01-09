/**
 * Deploy all contracts to local devnet
 *
 * This script orchestrates the full deployment sequence:
 * 1. Deploy Wormhole mocks on both L1 and target chains
 * 2. Deploy mock ERC20 token for testing
 * 3. Deploy AztecAavePortalL1 on L1
 * 4. Deploy AaveExecutorTarget on target chain
 * 5. Save all addresses to deployment file
 *
 * Usage:
 *   bun run scripts/deploy-local.ts
 *
 * Prerequisites:
 *   - Local devnet running (make devnet-up)
 *   - All contracts built (make build)
 */

import { execSync } from "child_process";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

// Chain configurations
const L1_RPC = process.env.L1_RPC || "http://localhost:8545";
const TARGET_RPC = process.env.TARGET_RPC || "http://localhost:8546";

// Anvil default account (for testing only - has 10000 ETH on anvil)
const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Wormhole chain IDs (these are standard Wormhole chain IDs)
const L1_WORMHOLE_CHAIN_ID = 2; // Ethereum
const TARGET_WORMHOLE_CHAIN_ID = 23; // Arbitrum

// Placeholder addresses for contracts not yet deployed
const PLACEHOLDER_AZTEC_OUTBOX = "0x0000000000000000000000000000000000000001";
const PLACEHOLDER_AZTEC_INBOX = "0x0000000000000000000000000000000000000002";
const PLACEHOLDER_TOKEN_PORTAL = "0x0000000000000000000000000000000000000003";
const PLACEHOLDER_L2_CONTRACT = "0x0000000000000000000000000000000000000000000000000000000000000004";
const PLACEHOLDER_AAVE_POOL = "0x0000000000000000000000000000000000000005";

interface DeploymentAddresses {
  l1: {
    wormholeCore: string;
    wormholeTokenBridge: string;
    wormholeRelayer: string;
    mockToken: string;
    aztecAavePortal: string;
  };
  target: {
    wormholeCore: string;
    mockToken: string;
    aaveExecutor: string;
  };
  config: {
    l1ChainId: number;
    targetChainId: number;
    l1WormholeChainId: number;
    targetWormholeChainId: number;
  };
}

/**
 * Execute a forge script and extract deployed contract address from output
 */
function deployContract(
  contractPath: string,
  constructorArgs: string[],
  rpcUrl: string,
  workDir: string
): string {
  console.log(`\nDeploying ${contractPath}...`);
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  Args: ${constructorArgs.join(", ")}`);

  // Build the forge create command
  const args = constructorArgs.length > 0 ? `--constructor-args ${constructorArgs.join(" ")}` : "";

  const cmd = `cd ${workDir} && forge create ${contractPath} \
    --rpc-url ${rpcUrl} \
    --private-key ${DEPLOYER_PRIVATE_KEY} \
    ${args} \
    --broadcast \
    --legacy \
    --json`;

  try {
    const output = execSync(cmd, { encoding: "utf-8" });

    // Extract JSON from output (filter out warnings)
    const lines = output.split('\n');
    const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('deployedTo'));

    if (!jsonLine) {
      throw new Error(`No deployment output found in: ${output}`);
    }

    const result = JSON.parse(jsonLine);

    if (!result.deployedTo) {
      throw new Error(`Deployment failed: ${output}`);
    }

    console.log(`  ✓ Deployed to: ${result.deployedTo}`);
    return result.deployedTo;
  } catch (error) {
    console.error(`  ✗ Deployment failed:`, error);
    throw error;
  }
}

/**
 * Check if devnet is running
 */
function checkDevnetRunning() {
  try {
    execSync(`curl -sf ${L1_RPC} -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log("✓ L1 devnet is running");
  } catch (error) {
    console.error("✗ L1 devnet is not running. Start it with 'make devnet-up'");
    process.exit(1);
  }

  try {
    execSync(`curl -sf ${TARGET_RPC} -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log("✓ Target devnet is running");
  } catch (error) {
    console.error("✗ Target devnet is not running. Start it with 'make devnet-up'");
    process.exit(1);
  }
}

/**
 * Main deployment function
 */
async function main() {
  console.log("=".repeat(80));
  console.log("Deploying Aztec Aave Wrapper to Local Devnet");
  console.log("=".repeat(80));

  // Check devnet is running
  console.log("\nChecking devnet status...");
  checkDevnetRunning();

  const addresses: DeploymentAddresses = {
    l1: {
      wormholeCore: "",
      wormholeTokenBridge: "",
      wormholeRelayer: "",
      mockToken: "",
      aztecAavePortal: "",
    },
    target: {
      wormholeCore: "",
      mockToken: "",
      aaveExecutor: "",
    },
    config: {
      l1ChainId: 31337,
      targetChainId: 31338,
      l1WormholeChainId: L1_WORMHOLE_CHAIN_ID,
      targetWormholeChainId: TARGET_WORMHOLE_CHAIN_ID,
    },
  };

  // ============================================================================
  // Phase 1: Deploy Wormhole Mocks
  // ============================================================================
  console.log("\n" + "=".repeat(80));
  console.log("PHASE 1: Deploying Wormhole Mock Contracts");
  console.log("=".repeat(80));

  // Step 1: Deploy MockWormholeCore on L1
  console.log("\n[1/7] Deploying MockWormholeCore on L1...");
  addresses.l1.wormholeCore = deployContract(
    "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
    [L1_WORMHOLE_CHAIN_ID.toString()],
    L1_RPC,
    "l1"
  );

  // Step 2: Deploy MockWormholeTokenBridge on L1
  console.log("\n[2/7] Deploying MockWormholeTokenBridge on L1...");
  addresses.l1.wormholeTokenBridge = deployContract(
    "contracts/mocks/MockWormholeTokenBridge.sol:MockWormholeTokenBridge",
    [],
    L1_RPC,
    "l1"
  );

  // Step 3: Deploy MockWormholeRelayer on L1
  console.log("\n[3/7] Deploying MockWormholeRelayer on L1...");
  addresses.l1.wormholeRelayer = deployContract(
    "contracts/mocks/MockWormholeRelayer.sol:MockWormholeRelayer",
    [addresses.l1.wormholeCore],
    L1_RPC,
    "l1"
  );

  // Step 4: Deploy MockWormholeCore on target chain
  console.log("\n[4/7] Deploying MockWormholeCore on Target...");
  addresses.target.wormholeCore = deployContract(
    "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
    [TARGET_WORMHOLE_CHAIN_ID.toString()],
    TARGET_RPC,
    "target"
  );

  // ============================================================================
  // Phase 2: Deploy Mock Tokens
  // ============================================================================
  console.log("\n" + "=".repeat(80));
  console.log("PHASE 2: Deploying Mock ERC20 Tokens");
  console.log("=".repeat(80));

  // Note: Using OpenZeppelin's ERC20 mock or a simple implementation
  // For now, we'll skip this and use a placeholder. In production, deploy a MockERC20
  console.log("\n[5/7] Deploying Mock USDC on L1...");
  console.log("  (Skipped - will use existing token or deploy in separate script)");
  addresses.l1.mockToken = "0x0000000000000000000000000000000000000000"; // Placeholder

  console.log("\n[6/7] Deploying Mock USDC on Target...");
  console.log("  (Skipped - will use existing token or deploy in separate script)");
  addresses.target.mockToken = "0x0000000000000000000000000000000000000000"; // Placeholder

  // ============================================================================
  // Phase 3: Deploy Portal and Executor
  // ============================================================================
  console.log("\n" + "=".repeat(80));
  console.log("PHASE 3: Deploying Portal and Executor Contracts");
  console.log("=".repeat(80));

  // Step 7: Deploy AztecAavePortalL1
  console.log("\n[7/7] Deploying AztecAavePortalL1 on L1...");

  // For now, we'll use placeholder addresses for Aztec contracts
  // These will be updated once Aztec contracts are deployed
  const targetExecutorPlaceholder = "0x" + "0".repeat(64); // bytes32 placeholder

  addresses.l1.aztecAavePortal = deployContract(
    "contracts/AztecAavePortalL1.sol:AztecAavePortalL1",
    [
      PLACEHOLDER_AZTEC_OUTBOX,
      PLACEHOLDER_AZTEC_INBOX,
      PLACEHOLDER_TOKEN_PORTAL,
      addresses.l1.wormholeTokenBridge,
      addresses.l1.wormholeRelayer,
      PLACEHOLDER_L2_CONTRACT,
      TARGET_WORMHOLE_CHAIN_ID.toString(),
      targetExecutorPlaceholder,
    ],
    L1_RPC,
    "l1"
  );

  // Step 8: Deploy AaveExecutorTarget (if contract exists)
  console.log("\n[8/8] Deploying AaveExecutorTarget on Target...");
  console.log("  (Skipped - contract implementation pending)");
  addresses.target.aaveExecutor = "0x0000000000000000000000000000000000000000"; // Placeholder

  // ============================================================================
  // Save Deployment Addresses
  // ============================================================================
  const outputPath = join(__dirname, "../.deployments.local.json");
  writeFileSync(outputPath, JSON.stringify(addresses, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("Deployment Complete!");
  console.log("=".repeat(80));
  console.log("\nDeployed Addresses:");
  console.log("\nL1 (Ethereum):");
  console.log(`  WormholeCore:        ${addresses.l1.wormholeCore}`);
  console.log(`  WormholeTokenBridge: ${addresses.l1.wormholeTokenBridge}`);
  console.log(`  WormholeRelayer:     ${addresses.l1.wormholeRelayer}`);
  console.log(`  AztecAavePortal:     ${addresses.l1.aztecAavePortal}`);
  console.log("\nTarget (Arbitrum):");
  console.log(`  WormholeCore:        ${addresses.target.wormholeCore}`);
  console.log(`  AaveExecutor:        ${addresses.target.aaveExecutor} (placeholder)`);
  console.log(`\nAddresses saved to: ${outputPath}`);
  console.log("\nNext steps:");
  console.log("  1. Deploy Aztec L2 contracts");
  console.log("  2. Update portal with actual Aztec addresses");
  console.log("  3. Deploy AaveExecutorTarget");
  console.log("  4. Run E2E tests with 'make e2e'");
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
