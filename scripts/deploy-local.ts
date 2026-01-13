/**
 * Deploy all contracts to local devnet
 *
 * Deploys the complete Aztec Aave Wrapper system:
 *
 * L1 (Anvil port 8545):
 *   - MockWormholeCore
 *   - MockWormholeTokenBridge
 *   - MockWormholeRelayer
 *   - MockERC20 (USDC)
 *   - AztecAavePortalL1
 *
 * Target (Anvil port 8546):
 *   - MockWormholeCore
 *   - MockLendingPool
 *   - MockERC20 (USDC)
 *   - AaveExecutorTarget
 *
 * L2 (Aztec Sandbox port 8081):
 *   - AaveWrapper contract
 *
 * Usage:
 *   bun run scripts/deploy-local.ts
 *
 * Prerequisites:
 *   - Local devnet running (make devnet-up)
 *   - All contracts built (make build)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

// =============================================================================
// Configuration
// =============================================================================

const L1_RPC = process.env.L1_RPC || "http://localhost:8545";
const TARGET_RPC = process.env.TARGET_RPC || "http://localhost:8546";
const PXE_URL = process.env.PXE_URL || "http://localhost:8081";

// Anvil default deployer account (DO NOT use in production!)
const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Wormhole chain IDs (standard Wormhole IDs)
const L1_WORMHOLE_CHAIN_ID = 2; // Ethereum
const TARGET_WORMHOLE_CHAIN_ID = 23; // Arbitrum

// Native chain IDs
const L1_CHAIN_ID = 31337;
const TARGET_CHAIN_ID = 31338;

// =============================================================================
// Types
// =============================================================================

interface DeploymentAddresses {
  l1: {
    wormholeCore: string;
    wormholeTokenBridge: string;
    wormholeRelayer: string;
    mockUsdc: string;
    portal: string;
  };
  target: {
    wormholeCore: string;
    mockLendingPool: string;
    mockUsdc: string;
    executor: string;
  };
  l2: {
    aaveWrapper: string;
  };
  config: {
    l1ChainId: number;
    targetChainId: number;
    l1WormholeChainId: number;
    targetWormholeChainId: number;
    deployedAt: string;
  };
}

// =============================================================================
// Forge Deployment Helper
// =============================================================================

function deployWithForge(
  contractPath: string,
  constructorArgs: string[],
  rpcUrl: string,
  workDir: string
): string {
  console.log(`  Deploying ${contractPath.split(":")[1] || contractPath}...`);

  const args =
    constructorArgs.length > 0
      ? `--constructor-args ${constructorArgs.join(" ")}`
      : "";

  // --broadcast is required for forge create to actually send the transaction
  const argsArray = [
    "create",
    contractPath,
    "--rpc-url", rpcUrl,
    "--private-key", DEPLOYER_PRIVATE_KEY,
    "--broadcast",
    "--json",
  ];
  if (constructorArgs.length > 0) {
    argsArray.push("--constructor-args", ...constructorArgs);
  }
  const cmd = `cd ${workDir} && forge ${argsArray.join(" ")} 2>&1`;

  try {
    const output = execSync(cmd, { encoding: "utf-8" });

    // Check for compilation errors first
    if (output.includes("error[")) {
      const errorMatch = output.match(/error\[.*?\]:(.*?)(?=\n|$)/i);
      throw new Error(errorMatch ? errorMatch[1].trim() : "Compilation error");
    }

    // Parse JSON output from forge - may be multi-line pretty printed
    // Look for a JSON object containing deployedTo
    const jsonMatch = output.match(/\{[\s\S]*?"deployedTo"[\s\S]*?\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.deployedTo) {
        console.log(`    ✓ ${result.deployedTo}`);
        return result.deployedTo;
      }
    }

    throw new Error(`No deployment output found. Raw output:\n${output.slice(0, 500)}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`    ✗ Failed to parse JSON output`);
    } else {
      console.error(`    ✗ Failed:`, error instanceof Error ? error.message : error);
    }
    throw error;
  }
}

// =============================================================================
// Service Health Checks
// =============================================================================

function checkL1Running(): boolean {
  try {
    execSync(
      `curl -sf ${L1_RPC} -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

function checkTargetRunning(): boolean {
  try {
    execSync(
      `curl -sf ${TARGET_RPC} -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

function checkPxeRunning(): boolean {
  try {
    execSync(`curl -sf ${PXE_URL}/status`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Aztec L2 Deployment
// =============================================================================

async function deployL2Contract(portalAddress: string): Promise<string> {
  console.log("\n  Deploying AaveWrapper on Aztec L2...");

  // Use the generated TypeScript contract wrapper for deployment
  // Script runs from e2e directory where @aztec packages are installed
  // Following pattern from: https://docs.aztec.network/developers/docs/tutorials/js_tutorials/aztecjs-getting-started
  const deployScript = `
    import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
    import { TestWallet } from "@aztec/test-wallet/server";
    import { getInitialTestAccountsData } from "@aztec/accounts/testing";
    import { AaveWrapperContract } from "./src/generated/AaveWrapper";
    import { EthAddress } from "@aztec/foundation/eth-address";

    async function deploy() {
      const node = createAztecNodeClient("${PXE_URL}");
      await waitForNode(node);

      // Create wallet and first test account (admin)
      const wallet = await TestWallet.create(node);
      const [alice] = await getInitialTestAccountsData();
      const account = await wallet.createSchnorrAccount(alice.secret, alice.salt);
      const adminAddress = account.address;

      // Deploy AaveWrapper
      const portalEthAddress = EthAddress.fromString("${portalAddress}");
      const contract = await AaveWrapperContract.deploy(wallet, adminAddress, portalEthAddress)
        .send({ from: adminAddress })
        .deployed();

      console.log(contract.address.toString());
    }

    deploy().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  `;

  // Write temporary deploy script to e2e directory where @aztec packages are installed
  const e2eDir = join(__dirname, "../e2e");
  const tempScriptPath = join(e2eDir, ".temp-deploy-l2.ts");
  writeFileSync(tempScriptPath, deployScript);

  try {
    const output = execSync(`cd ${e2eDir} && bun run ${tempScriptPath}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Extract the address from output (last line)
    const lines = output.trim().split("\n");
    const address = lines[lines.length - 1];

    if (!address || !address.startsWith("0x")) {
      throw new Error(`Invalid L2 address output: ${output}`);
    }

    console.log(`    ✓ ${address}`);

    // Cleanup temp file
    execSync(`rm -f ${tempScriptPath}`);

    return address;
  } catch (error) {
    // Cleanup temp file on error
    execSync(`rm -f ${tempScriptPath}`);
    console.error(
      `    ✗ Failed:`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

// =============================================================================
// Address File Updates
// =============================================================================

function updateAddressesJson(addresses: DeploymentAddresses): void {
  const addressesPath = join(__dirname, "../e2e/src/config/addresses.json");

  const addressesJson = {
    local: {
      l2: {
        aaveWrapper: addresses.l2.aaveWrapper,
      },
      l1: {
        portal: addresses.l1.portal,
        tokenPortal: "0x0000000000000000000000000000000000000000", // Not used in mock mode
      },
      target: {
        executor: addresses.target.executor,
        aavePool: addresses.target.mockLendingPool,
      },
      wormhole: {
        bridge: addresses.l1.wormholeTokenBridge,
        relayer: addresses.l1.wormholeRelayer,
      },
    },
    testnet: {
      l2: {
        aaveWrapper:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      l1: {
        portal: "0x0000000000000000000000000000000000000000",
        tokenPortal: "0x0000000000000000000000000000000000000000",
      },
      target: {
        executor: "0x0000000000000000000000000000000000000000",
        aavePool: "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
      },
      wormhole: {
        bridge: "0xC7A204bDBFe983FCD8d8E61D02b475D4073fF97e",
        relayer: "0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470",
      },
    },
  };

  writeFileSync(addressesPath, JSON.stringify(addressesJson, null, 2) + "\n");
  console.log(`  Updated: ${addressesPath}`);
}

// =============================================================================
// Main Deployment
// =============================================================================

async function main() {
  console.log("═".repeat(70));
  console.log("  AZTEC AAVE WRAPPER - LOCAL DEPLOYMENT");
  console.log("═".repeat(70));

  // ---------------------------------------------------------------------------
  // Health Checks
  // ---------------------------------------------------------------------------
  console.log("\n[1/6] Checking services...");

  const l1Running = checkL1Running();
  const targetRunning = checkTargetRunning();
  const pxeRunning = checkPxeRunning();

  console.log(`  L1 Anvil (${L1_RPC}): ${l1Running ? "✓ Running" : "✗ Not running"}`);
  console.log(`  Target Anvil (${TARGET_RPC}): ${targetRunning ? "✓ Running" : "⚠ Not running (optional for MVP)"}`);
  console.log(`  Aztec PXE (${PXE_URL}): ${pxeRunning ? "✓ Running" : "✗ Not running"}`);

  if (!l1Running) {
    console.error("\n✗ L1 chain must be running. Start with: make devnet-up");
    process.exit(1);
  }

  // Note: Target chain is optional for MVP mode (see docs/MVP_RESEARCH.md)
  // When target is not running, target contracts will be skipped

  const addresses: DeploymentAddresses = {
    l1: {
      wormholeCore: "",
      wormholeTokenBridge: "",
      wormholeRelayer: "",
      mockUsdc: "",
      portal: "",
    },
    target: {
      wormholeCore: "",
      mockLendingPool: "",
      mockUsdc: "",
      executor: "",
    },
    l2: {
      aaveWrapper: "",
    },
    config: {
      l1ChainId: L1_CHAIN_ID,
      targetChainId: TARGET_CHAIN_ID,
      l1WormholeChainId: L1_WORMHOLE_CHAIN_ID,
      targetWormholeChainId: TARGET_WORMHOLE_CHAIN_ID,
      deployedAt: new Date().toISOString(),
    },
  };

  // ---------------------------------------------------------------------------
  // L1 Mock Deployments
  // ---------------------------------------------------------------------------
  console.log("\n[2/6] Deploying L1 mock contracts...");

  addresses.l1.wormholeCore = deployWithForge(
    "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
    [L1_WORMHOLE_CHAIN_ID.toString()],
    L1_RPC,
    "l1"
  );

  addresses.l1.wormholeTokenBridge = deployWithForge(
    "contracts/mocks/MockWormholeTokenBridge.sol:MockWormholeTokenBridge",
    [],
    L1_RPC,
    "l1"
  );

  addresses.l1.wormholeRelayer = deployWithForge(
    "contracts/mocks/MockWormholeRelayer.sol:MockWormholeRelayer",
    [addresses.l1.wormholeCore],
    L1_RPC,
    "l1"
  );

  // Deploy MockERC20 for USDC (6 decimals)
  addresses.l1.mockUsdc = deployWithForge(
    "contracts/mocks/MockERC20.sol:MockERC20",
    ['"Mock USDC"', '"USDC"', "6"],
    L1_RPC,
    "l1"
  );

  // ---------------------------------------------------------------------------
  // Target Mock Deployments (optional - skipped if anvil-target not running)
  // ---------------------------------------------------------------------------
  if (targetRunning) {
    console.log("\n[3/6] Deploying Target mock contracts...");

    addresses.target.wormholeCore = deployWithForge(
      "contracts/mocks/MockWormholeCore.sol:MockWormholeCore",
      [TARGET_WORMHOLE_CHAIN_ID.toString()],
      TARGET_RPC,
      "target"
    );

    addresses.target.mockLendingPool = deployWithForge(
      "contracts/mocks/MockLendingPool.sol:MockLendingPool",
      [],
      TARGET_RPC,
      "target"
    );

    addresses.target.mockUsdc = deployWithForge(
      "contracts/mocks/MockERC20.sol:MockERC20",
      ['"Mock USDC"', '"USDC"', "6"],
      TARGET_RPC,
      "target"
    );

    // ---------------------------------------------------------------------------
    // Deploy AaveExecutorTarget
    // ---------------------------------------------------------------------------
    console.log("\n[4/6] Deploying AaveExecutorTarget...");

    // L1 portal address as bytes32 (will be updated after portal deployment)
    const l1PortalPlaceholder = "0x" + "00".repeat(32);

    addresses.target.executor = deployWithForge(
      "contracts/AaveExecutorTarget.sol:AaveExecutorTarget",
      [
        addresses.target.mockLendingPool,
        addresses.target.wormholeCore,
        l1PortalPlaceholder,
        L1_WORMHOLE_CHAIN_ID.toString(),
      ],
      TARGET_RPC,
      "target"
    );
  } else {
    console.log("\n[3/6] Skipping Target mock contracts (anvil-target not running)");
    console.log("\n[4/6] Skipping AaveExecutorTarget (anvil-target not running)");
    // Set placeholder addresses for target contracts
    addresses.target.wormholeCore = "0x0000000000000000000000000000000000000000";
    addresses.target.mockLendingPool = "0x0000000000000000000000000000000000000000";
    addresses.target.mockUsdc = "0x0000000000000000000000000000000000000000";
    addresses.target.executor = "0x0000000000000000000000000000000000000000";
  }

  // ---------------------------------------------------------------------------
  // Deploy AztecAavePortalL1
  // ---------------------------------------------------------------------------
  console.log("\n[5/6] Deploying AztecAavePortalL1...");

  // For local dev, use placeholder addresses for Aztec inbox/outbox
  // These would come from the Aztec sandbox in a real deployment
  const aztecOutbox = "0x0000000000000000000000000000000000000001";
  const aztecInbox = "0x0000000000000000000000000000000000000002";
  const tokenPortal = "0x0000000000000000000000000000000000000003";

  // L2 contract address placeholder (will be updated after L2 deployment)
  const l2ContractPlaceholder = "0x" + "00".repeat(32);

  // Target executor as bytes32 (pad address to 32 bytes)
  const targetExecutorBytes32 =
    "0x000000000000000000000000" + addresses.target.executor.slice(2);

  addresses.l1.portal = deployWithForge(
    "contracts/AztecAavePortalL1.sol:AztecAavePortalL1",
    [
      aztecOutbox,
      aztecInbox,
      tokenPortal,
      addresses.l1.wormholeTokenBridge,
      addresses.l1.wormholeRelayer,
      l2ContractPlaceholder,
      TARGET_WORMHOLE_CHAIN_ID.toString(),
      targetExecutorBytes32,
      DEPLOYER_ADDRESS,
    ],
    L1_RPC,
    "l1"
  );

  // ---------------------------------------------------------------------------
  // Deploy L2 AaveWrapper
  // ---------------------------------------------------------------------------
  console.log("\n[6/6] Deploying L2 AaveWrapper...");

  if (pxeRunning) {
    try {
      addresses.l2.aaveWrapper = await deployL2Contract(addresses.l1.portal);
    } catch (error) {
      console.log(
        "    ⚠ L2 deployment failed (e2e tests will deploy):",
        error instanceof Error ? error.message : error
      );
      addresses.l2.aaveWrapper =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    }
  } else {
    console.log("    ⚠ PXE not running - e2e tests will deploy the contract");
    addresses.l2.aaveWrapper =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  // ---------------------------------------------------------------------------
  // Save Addresses
  // ---------------------------------------------------------------------------
  console.log("\n" + "─".repeat(70));
  console.log("Saving deployment addresses...");

  // Save full deployment info
  const deploymentsPath = join(__dirname, "../.deployments.local.json");
  writeFileSync(deploymentsPath, JSON.stringify(addresses, null, 2) + "\n");
  console.log(`  Created: ${deploymentsPath}`);

  // Update e2e addresses.json
  updateAddressesJson(addresses);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(70));

  console.log("\nL1 Contracts (Anvil :8545):");
  console.log(`  WormholeCore:        ${addresses.l1.wormholeCore}`);
  console.log(`  WormholeTokenBridge: ${addresses.l1.wormholeTokenBridge}`);
  console.log(`  WormholeRelayer:     ${addresses.l1.wormholeRelayer}`);
  console.log(`  MockUSDC:            ${addresses.l1.mockUsdc}`);
  console.log(`  AztecAavePortal:     ${addresses.l1.portal}`);

  if (targetRunning) {
    console.log("\nTarget Contracts (Anvil :8546):");
    console.log(`  WormholeCore:        ${addresses.target.wormholeCore}`);
    console.log(`  MockLendingPool:     ${addresses.target.mockLendingPool}`);
    console.log(`  MockUSDC:            ${addresses.target.mockUsdc}`);
    console.log(`  AaveExecutor:        ${addresses.target.executor}`);
  } else {
    console.log("\nTarget Contracts: SKIPPED (MVP mode - see docs/MVP_RESEARCH.md)");
  }

  console.log("\nL2 Contracts (Aztec :8081):");
  console.log(`  AaveWrapper:         ${addresses.l2.aaveWrapper || "(not deployed)"}`);

  console.log("\nNext steps:");
  console.log("  1. Run E2E tests: make e2e");
  console.log("  2. Mint test tokens: bun run scripts/mint-tokens.ts");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n✗ Deployment failed:", error);
    process.exit(1);
  });
