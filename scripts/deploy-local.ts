/**
 * Deploy all contracts to local devnet
 *
 * Deploys the complete Aztec Aave Wrapper system:
 *
 * L1 (Anvil port 8545):
 *   - MockERC20 (USDC)
 *   - MockLendingPool
 *   - AztecAavePortalL1
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
const PXE_URL = process.env.PXE_URL || "http://localhost:8081";

// Anvil default deployer account (DO NOT use in production!)
const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Native chain IDs
const L1_CHAIN_ID = 31337;

// =============================================================================
// Types
// =============================================================================

interface DeploymentAddresses {
  l1: {
    mockUsdc: string;
    mockLendingPool: string;
    portal: string;
  };
  l2: {
    aaveWrapper: string;
  };
  config: {
    l1ChainId: number;
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
        mockUsdc: addresses.l1.mockUsdc,
        mockLendingPool: addresses.l1.mockLendingPool,
      },
    },
    testnet: {
      l2: {
        aaveWrapper:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      l1: {
        portal: "0x0000000000000000000000000000000000000000",
        mockUsdc: "0x0000000000000000000000000000000000000000",
        mockLendingPool: "0x0000000000000000000000000000000000000000",
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
  console.log("\n[1/3] Checking services...");

  const l1Running = checkL1Running();
  const pxeRunning = checkPxeRunning();

  console.log(`  L1 Anvil (${L1_RPC}): ${l1Running ? "✓ Running" : "✗ Not running"}`);
  console.log(`  Aztec PXE (${PXE_URL}): ${pxeRunning ? "✓ Running" : "✗ Not running"}`);

  if (!l1Running) {
    console.error("\n✗ L1 chain must be running. Start with: make devnet-up");
    process.exit(1);
  }

  const addresses: DeploymentAddresses = {
    l1: {
      mockUsdc: "",
      mockLendingPool: "",
      portal: "",
    },
    l2: {
      aaveWrapper: "",
    },
    config: {
      l1ChainId: L1_CHAIN_ID,
      deployedAt: new Date().toISOString(),
    },
  };

  // ---------------------------------------------------------------------------
  // L1 Mock Deployments
  // ---------------------------------------------------------------------------
  console.log("\n[2/3] Deploying L1 contracts...");

  // Deploy MockERC20 for USDC (6 decimals)
  addresses.l1.mockUsdc = deployWithForge(
    "contracts/mocks/MockERC20.sol:MockERC20",
    ['"Mock USDC"', '"USDC"', "6"],
    L1_RPC,
    "l1"
  );

  // Deploy MockLendingPool
  addresses.l1.mockLendingPool = deployWithForge(
    "contracts/mocks/MockLendingPool.sol:MockLendingPool",
    [],
    L1_RPC,
    "l1"
  );

  // ---------------------------------------------------------------------------
  // Deploy AztecAavePortalL1
  // ---------------------------------------------------------------------------

  // For local dev, use placeholder addresses for Aztec inbox/outbox
  // These would come from the Aztec sandbox in a real deployment
  const aztecOutbox = "0x0000000000000000000000000000000000000001";
  const aztecInbox = "0x0000000000000000000000000000000000000002";
  const tokenPortal = "0x0000000000000000000000000000000000000003";

  // L2 contract address placeholder (will be updated after L2 deployment)
  const l2ContractPlaceholder = "0x" + "00".repeat(32);

  addresses.l1.portal = deployWithForge(
    "contracts/AztecAavePortalL1.sol:AztecAavePortalL1",
    [
      aztecOutbox,
      aztecInbox,
      tokenPortal,
      addresses.l1.mockLendingPool,
      l2ContractPlaceholder,
      DEPLOYER_ADDRESS,
    ],
    L1_RPC,
    "l1"
  );

  // ---------------------------------------------------------------------------
  // Deploy L2 AaveWrapper
  // ---------------------------------------------------------------------------
  console.log("\n[3/3] Deploying L2 AaveWrapper...");

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
  console.log(`  MockUSDC:              ${addresses.l1.mockUsdc}`);
  console.log(`  MockLendingPool:       ${addresses.l1.mockLendingPool}`);
  console.log(`  AztecAavePortal:       ${addresses.l1.portal}`);

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
