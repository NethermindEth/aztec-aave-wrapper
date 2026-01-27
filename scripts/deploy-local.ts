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
 * L2 (Aztec Sandbox port 8080):
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
const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

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
    tokenPortal: string;
    portal: string;
    /** Real Aztec outbox address from sandbox for L2→L1 message consumption */
    aztecOutbox: string;
    /** Real Aztec inbox address from sandbox for L1→L2 messages */
    aztecInbox: string;
    /** TokenFaucet for distributing test tokens */
    faucet: string;
  };
  l2: {
    bridgedToken: string;
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
// Token Minting Helper
// =============================================================================

function mintTokens(
  tokenAddress: string,
  recipient: string,
  amount: string,
  rpcUrl: string
): void {
  console.log(`  Minting ${amount} tokens to ${recipient.slice(0, 10)}...`);

  try {
    // Use cast to call mint(address,uint256) on the token contract
    const cmd = [
      "cast send",
      tokenAddress,
      '"mint(address,uint256)"',
      recipient,
      amount,
      "--rpc-url", rpcUrl,
      "--private-key", DEPLOYER_PRIVATE_KEY,
    ].join(" ");

    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    console.log(`    ✓ Minted ${Number(amount) / 1_000_000} USDC`);
  } catch (error) {
    console.error(`    ✗ Mint failed:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

// =============================================================================
// Lending Pool Configuration Helper
// =============================================================================

function configureAToken(
  lendingPoolAddress: string,
  assetAddress: string,
  aTokenAddress: string,
  rpcUrl: string
): void {
  console.log(`  Configuring aToken for ${assetAddress.slice(0, 10)}...`);

  try {
    // Use cast to call setATokenAddress(address,address) on the lending pool
    const cmd = [
      "cast send",
      lendingPoolAddress,
      '"setATokenAddress(address,address)"',
      assetAddress,
      aTokenAddress,
      "--rpc-url", rpcUrl,
      "--private-key", DEPLOYER_PRIVATE_KEY,
    ].join(" ");

    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    console.log(`    ✓ aToken configured: ${aTokenAddress.slice(0, 10)}...`);
  } catch (error) {
    console.error(`    ✗ Config failed:`, error instanceof Error ? error.message : error);
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
// Aztec Sandbox L1 Contract Addresses
// =============================================================================

interface SandboxL1Addresses {
  inboxAddress: string;
  outboxAddress: string;
  registryAddress: string;
}

function fetchSandboxL1Addresses(): SandboxL1Addresses {
  console.log("  Fetching Aztec sandbox L1 contract addresses...");

  try {
    const output = execSync(
      `curl -sf -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"node_getL1ContractAddresses","params":[],"id":1}' ${PXE_URL}`,
      { encoding: "utf-8", stdio: "pipe" }
    );

    const response = JSON.parse(output);
    if (!response.result) {
      throw new Error("No result in sandbox response");
    }

    const { inboxAddress, outboxAddress, registryAddress } = response.result;

    if (!inboxAddress || !outboxAddress) {
      throw new Error("Missing inbox or outbox address from sandbox");
    }

    console.log(`    ✓ Inbox: ${inboxAddress}`);
    console.log(`    ✓ Outbox: ${outboxAddress}`);

    return { inboxAddress, outboxAddress, registryAddress };
  } catch (error) {
    console.error("    ✗ Failed to fetch sandbox addresses:", error instanceof Error ? error.message : error);
    throw error;
  }
}

// =============================================================================
// Aztec L2 Deployment
// =============================================================================

interface L2DeployResult {
  bridgedToken: string;
  aaveWrapper: string;
}

async function deployL2Contracts(portalAddress: string, tokenPortalAddress: string): Promise<L2DeployResult> {
  console.log("\n  Deploying L2 contracts on Aztec...");

  // Use the generated TypeScript contract wrapper for deployment
  // Script runs from e2e directory where @aztec packages are installed
  // Following pattern from: https://docs.aztec.network/developers/docs/tutorials/js_tutorials/aztecjs-getting-started
  const deployScript = `
    import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
    import { TestWallet } from "@aztec/test-wallet/server";
    import { getInitialTestAccountsData } from "@aztec/accounts/testing";
    import { AaveWrapperContract } from "./src/generated/AaveWrapper";
    import { BridgedTokenContract } from "./src/generated/BridgedToken";
    import { EthAddress } from "@aztec/foundation/eth-address";
    import { Fr } from "@aztec/aztec.js/fields";

    // Helper to convert string to Field (packed bytes)
    function stringToField(str: string): Fr {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(str);
      let value = 0n;
      for (let i = 0; i < bytes.length && i < 31; i++) {
        value = (value << 8n) | BigInt(bytes[i]);
      }
      return new Fr(value);
    }

    async function deploy() {
      const node = createAztecNodeClient("${PXE_URL}");
      await waitForNode(node);

      // Create wallet and first test account (admin)
      const wallet = await TestWallet.create(node);
      const [alice] = await getInitialTestAccountsData();
      const account = await wallet.createSchnorrAccount(alice.secret, alice.salt);
      const adminAddress = account.address;

      // Step 1: Deploy BridgedToken (L2 USDC representation)
      console.error("  Deploying BridgedToken...");
      const tokenPortalEthAddress = EthAddress.fromString("${tokenPortalAddress}");
      const tokenName = stringToField("USDC");
      const tokenSymbol = stringToField("USDC");
      const tokenDecimals = 6;

      const bridgedToken = await BridgedTokenContract.deploy(
        wallet,
        adminAddress,
        tokenPortalEthAddress,
        tokenName,
        tokenSymbol,
        tokenDecimals
      )
        .send({ from: adminAddress })
        .deployed();
      console.error("    ✓ BridgedToken: " + bridgedToken.address.toString());

      // Step 2: Deploy AaveWrapper with real BridgedToken address
      console.error("  Deploying AaveWrapper...");
      const portalEthAddress = EthAddress.fromString("${portalAddress}");
      const feeTreasury = adminAddress; // Use admin as fee treasury for local dev

      const aaveWrapper = await AaveWrapperContract.deploy(
        wallet,
        adminAddress,
        portalEthAddress,
        bridgedToken.address,
        feeTreasury
      )
        .send({ from: adminAddress })
        .deployed();
      console.error("    ✓ AaveWrapper: " + aaveWrapper.address.toString());

      // Step 3: Configure BridgedToken - set AaveWrapper as minter
      console.error("  Configuring BridgedToken minter...");
      await bridgedToken.methods.set_minter(aaveWrapper.address)
        .send({ from: adminAddress })
        .wait();
      console.error("    ✓ Minter set to AaveWrapper");

      // Step 4: Authorize AaveWrapper as a burner
      console.error("  Authorizing AaveWrapper as burner...");
      await bridgedToken.methods.authorize_burner(aaveWrapper.address, true)
        .send({ from: adminAddress })
        .wait();
      console.error("    ✓ AaveWrapper authorized as burner");

      // Output addresses as JSON for parsing
      console.log(JSON.stringify({
        bridgedToken: bridgedToken.address.toString(),
        aaveWrapper: aaveWrapper.address.toString()
      }));
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

    // Extract the JSON from output (last line)
    const lines = output.trim().split("\n");
    const jsonLine = lines[lines.length - 1];

    let result: L2DeployResult;
    try {
      result = JSON.parse(jsonLine) as L2DeployResult;
    } catch {
      throw new Error(`Invalid L2 deployment output: ${output}`);
    }

    if (!result.bridgedToken || !result.aaveWrapper) {
      throw new Error(`Missing addresses in L2 deployment output: ${jsonLine}`);
    }

    // Cleanup temp file
    execSync(`rm -f ${tempScriptPath}`);

    return result;
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

  if (!pxeRunning) {
    console.error("\n✗ Aztec sandbox must be running to fetch L1 contract addresses. Start with: make devnet-up");
    process.exit(1);
  }

  const addresses: DeploymentAddresses = {
    l1: {
      mockUsdc: "",
      mockLendingPool: "",
      tokenPortal: "",
      portal: "",
      aztecOutbox: "",
      aztecInbox: "",
      faucet: "",
    },
    l2: {
      aaveWrapper: "",
      bridgedToken: "",
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
    "eth"
  );

  // Deploy TokenFaucet for distributing test tokens
  // Drip amount: 1000 USDC (6 decimals = 1000 * 10^6)
  // Cooldown: 1 hour (3600 seconds)
  const FAUCET_DRIP_AMOUNT = "1000000000"; // 1000 USDC
  const FAUCET_COOLDOWN = "3600"; // 1 hour
  addresses.l1.faucet = deployWithForge(
    "contracts/mocks/TokenFaucet.sol:TokenFaucet",
    [addresses.l1.mockUsdc, FAUCET_DRIP_AMOUNT, FAUCET_COOLDOWN],
    L1_RPC,
    "eth"
  );

  // Deploy MockLendingPool
  addresses.l1.mockLendingPool = deployWithForge(
    "contracts/mocks/MockLendingPool.sol:MockLendingPool",
    [],
    L1_RPC,
    "eth"
  );

  // Deploy mock aToken for USDC (same decimals as USDC)
  // In a real Aave setup, aTokens are minted by the pool on supply
  console.log("\n  Deploying mock aToken...");
  const mockAToken = deployWithForge(
    "contracts/mocks/MockERC20.sol:MockERC20",
    ['"Mock aUSDC"', '"aUSDC"', "6"],
    L1_RPC,
    "eth"
  );

  // Configure the lending pool to return aToken address for USDC
  configureAToken(addresses.l1.mockLendingPool, addresses.l1.mockUsdc, mockAToken, L1_RPC);

  // ---------------------------------------------------------------------------
  // Get Aztec Sandbox L1 Addresses (for reference)
  // ---------------------------------------------------------------------------
  console.log("\n  Getting Aztec sandbox L1 addresses...");

  // Fetch real addresses from Aztec sandbox
  const sandboxAddresses = fetchSandboxL1Addresses();

  // Use the REAL Aztec outbox and inbox from the sandbox
  // This enables proper L2→L1 message proving and consumption
  console.log("\n  Using real Aztec messaging contracts...");
  const aztecOutbox = sandboxAddresses.outboxAddress;
  const aztecInbox = sandboxAddresses.inboxAddress;
  addresses.l1.aztecOutbox = aztecOutbox;
  addresses.l1.aztecInbox = aztecInbox;
  console.log(`    ✓ Outbox: ${aztecOutbox}`);
  console.log(`    ✓ Inbox: ${aztecInbox}`);

  // Deploy TokenPortal for L1<->L2 token bridging
  // TokenPortal locks USDC on L1 when depositing to L2 and releases when withdrawing
  // Note: We deploy without authorized withdrawer initially, then add the portal after deployment
  const l2BridgePlaceholder = "0x" + "00".repeat(32); // L2 bridge address (will be configured later)
  addresses.l1.tokenPortal = deployWithForge(
    "contracts/TokenPortal.sol:TokenPortal",
    [
      addresses.l1.mockUsdc,        // underlying token
      aztecInbox,                    // Aztec inbox for L1->L2 messages
      aztecOutbox,                   // Aztec outbox for L2->L1 messages
      l2BridgePlaceholder,           // L2 bridge address (placeholder)
      "0x0000000000000000000000000000000000000000", // No authorized withdrawer initially
      DEPLOYER_ADDRESS,              // Initial owner
    ],
    L1_RPC,
    "eth"
  );

  // ---------------------------------------------------------------------------
  // Deploy AztecAavePortalL1
  // ---------------------------------------------------------------------------

  // L2 contract address placeholder (will be updated after L2 deployment)
  const l2ContractPlaceholder = "0x" + "00".repeat(32);

  addresses.l1.portal = deployWithForge(
    "contracts/AztecAavePortalL1.sol:AztecAavePortalL1",
    [
      aztecOutbox,
      aztecInbox,
      addresses.l1.tokenPortal,
      addresses.l1.mockLendingPool,
      l2ContractPlaceholder,
      DEPLOYER_ADDRESS,
    ],
    L1_RPC,
    "eth"
  );

  // Authorize the portal to withdraw from TokenPortal
  // This is done after portal deployment since we needed the portal address
  console.log("\n  Configuring TokenPortal authorized withdrawer...");
  const setAuthorizedWithdrawerCmd = [
    "cast send",
    addresses.l1.tokenPortal,
    '"setAuthorizedWithdrawer(address,bool)"',
    addresses.l1.portal,
    "true",
    "--rpc-url", L1_RPC,
    "--private-key", DEPLOYER_PRIVATE_KEY,
  ].join(" ");
  execSync(setAuthorizedWithdrawerCmd, { encoding: "utf-8", stdio: "pipe" });
  console.log(`    ✓ Portal authorized: ${addresses.l1.portal.slice(0, 10)}...`);

  // ---------------------------------------------------------------------------
  // Deploy L2 Contracts (BridgedToken + AaveWrapper)
  // ---------------------------------------------------------------------------
  console.log("\n[3/3] Deploying L2 contracts...");

  const zeroAddress = "0x0000000000000000000000000000000000000000000000000000000000000000";

  if (pxeRunning) {
    try {
      const l2Result = await deployL2Contracts(addresses.l1.portal, addresses.l1.tokenPortal);
      addresses.l2.bridgedToken = l2Result.bridgedToken;
      addresses.l2.aaveWrapper = l2Result.aaveWrapper;

      // Update L1 portal with the actual L2 contract address
      // This is required because L1 portal was deployed first with a placeholder address
      console.log("\n  Updating L1 portal with L2 contract address...");
      const updateL2AddressCmd = [
        "cast send",
        addresses.l1.portal,
        '"setL2ContractAddress(bytes32)"',
        addresses.l2.aaveWrapper,
        "--rpc-url", L1_RPC,
        "--private-key", DEPLOYER_PRIVATE_KEY,
      ].join(" ");
      execSync(updateL2AddressCmd, { encoding: "utf-8", stdio: "pipe" });
      console.log(`    ✓ L2 address set: ${addresses.l2.aaveWrapper.slice(0, 18)}...`);

      // Update TokenPortal with the actual L2 BridgedToken address
      // This is required because TokenPortal was deployed first with a placeholder l2Bridge
      console.log("\n  Updating TokenPortal with L2 BridgedToken address...");
      const setL2BridgeCmd = [
        "cast send",
        addresses.l1.tokenPortal,
        '"setL2Bridge(bytes32)"',
        addresses.l2.bridgedToken,
        "--rpc-url", L1_RPC,
        "--private-key", DEPLOYER_PRIVATE_KEY,
      ].join(" ");
      execSync(setL2BridgeCmd, { encoding: "utf-8", stdio: "pipe" });
      console.log(`    ✓ L2 bridge set: ${addresses.l2.bridgedToken.slice(0, 18)}...`);
    } catch (error) {
      console.log(
        "    ⚠ L2 deployment failed (e2e tests will deploy):",
        error instanceof Error ? error.message : error
      );
      addresses.l2.bridgedToken = zeroAddress;
      addresses.l2.aaveWrapper = zeroAddress;
    }
  } else {
    console.log("    ⚠ PXE not running - e2e tests will deploy the contract");
    addresses.l2.bridgedToken = zeroAddress;
    addresses.l2.aaveWrapper = zeroAddress;
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

  // Copy to frontend public folder (served by vite dev server)
  const frontendPublicPath = join(__dirname, "../frontend/public/.deployments.local.json");
  writeFileSync(frontendPublicPath, JSON.stringify(addresses, null, 2) + "\n");
  console.log(`  Created: ${frontendPublicPath}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(70));

  console.log("\nL1 Contracts (Anvil :8545):");
  console.log(`  MockUSDC:              ${addresses.l1.mockUsdc}`);
  console.log(`  TokenFaucet:           ${addresses.l1.faucet}`);
  console.log(`  MockLendingPool:       ${addresses.l1.mockLendingPool}`);
  console.log(`  TokenPortal:           ${addresses.l1.tokenPortal}`);
  console.log(`  AztecAavePortal:       ${addresses.l1.portal}`);

  console.log("\nL2 Contracts (Aztec :8080):");
  console.log(`  BridgedToken (USDC): ${addresses.l2.bridgedToken || "(not deployed)"}`);
  console.log(`  AaveWrapper:         ${addresses.l2.aaveWrapper || "(not deployed)"}`);

  console.log("\nNext steps:");
  console.log("  1. Run E2E tests: make e2e");
  console.log("  2. Start frontend: cd frontend && bun run dev");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n✗ Deployment failed:", error);
    process.exit(1);
  });
