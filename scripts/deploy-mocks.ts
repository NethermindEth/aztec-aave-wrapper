/**
 * Deploy Wormhole mock contracts for local testing
 *
 * This script deploys mock Wormhole contracts to local devnet chains:
 * - MockWormholeTokenBridge and MockWormholeRelayer on L1 (anvil-l1)
 * - MockWormholeCore on target chain (anvil-target)
 *
 * Usage:
 *   bun run scripts/deploy-mocks.ts
 *
 * Prerequisites:
 *   - Local devnet running (docker compose up)
 *   - L1 contracts built (cd l1 && forge build)
 *   - Target contracts built (cd target && forge build)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

// Chain configurations
const L1_RPC = process.env.L1_RPC || "http://localhost:8545";
const TARGET_RPC = process.env.TARGET_RPC || "http://localhost:8546";

// Anvil default account (for testing only - has 10000 ETH on anvil)
const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Wormhole chain IDs (these are standard Wormhole chain IDs)
const L1_CHAIN_ID = 2; // Ethereum
const TARGET_CHAIN_ID = 23; // Arbitrum

interface DeploymentAddresses {
  l1: {
    wormholeTokenBridge: string;
    wormholeRelayer: string;
    wormholeCore: string;
  };
  target: {
    wormholeCore: string;
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
 * Main deployment function
 */
async function main() {
  console.log("=".repeat(80));
  console.log("Deploying Wormhole Mock Contracts for Local Testing");
  console.log("=".repeat(80));

  const addresses: DeploymentAddresses = {
    l1: {
      wormholeTokenBridge: "",
      wormholeRelayer: "",
      wormholeCore: "",
    },
    target: {
      wormholeCore: "",
    },
  };

  // Step 1: Deploy MockWormholeCore on L1 (needed by relayer)
  console.log("\n[1/4] Deploying MockWormholeCore on L1...");
  addresses.l1.wormholeCore = deployContract(
    "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
    [L1_CHAIN_ID.toString()],
    L1_RPC,
    "l1"
  );

  // Step 2: Deploy MockWormholeTokenBridge on L1
  console.log("\n[2/4] Deploying MockWormholeTokenBridge on L1...");
  addresses.l1.wormholeTokenBridge = deployContract(
    "contracts/mocks/MockWormholeTokenBridge.sol:MockWormholeTokenBridge",
    [],
    L1_RPC,
    "l1"
  );

  // Step 3: Deploy MockWormholeRelayer on L1
  console.log("\n[3/4] Deploying MockWormholeRelayer on L1...");
  addresses.l1.wormholeRelayer = deployContract(
    "contracts/mocks/MockWormholeRelayer.sol:MockWormholeRelayer",
    [addresses.l1.wormholeCore],
    L1_RPC,
    "l1"
  );

  // Step 4: Deploy MockWormholeCore on target chain
  console.log("\n[4/4] Deploying MockWormholeCore on Target...");
  addresses.target.wormholeCore = deployContract(
    "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
    [TARGET_CHAIN_ID.toString()],
    TARGET_RPC,
    "target"
  );

  // Save deployment addresses to file
  const outputPath = join(__dirname, "../.wormhole-mocks.json");
  writeFileSync(outputPath, JSON.stringify(addresses, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("Deployment Complete!");
  console.log("=".repeat(80));
  console.log("\nDeployed Addresses:");
  console.log("\nL1 (Ethereum):");
  console.log(`  WormholeCore:        ${addresses.l1.wormholeCore}`);
  console.log(`  WormholeTokenBridge: ${addresses.l1.wormholeTokenBridge}`);
  console.log(`  WormholeRelayer:     ${addresses.l1.wormholeRelayer}`);
  console.log("\nTarget (Arbitrum):");
  console.log(`  WormholeCore:        ${addresses.target.wormholeCore}`);
  console.log(`\nAddresses saved to: ${outputPath}`);
  console.log("\nNext steps:");
  console.log("  1. Use these addresses when deploying AztecAavePortalL1");
  console.log("  2. Use target WormholeCore when deploying AaveExecutorTarget");
  console.log("  3. Import addresses in tests from .wormhole-mocks.json");
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
