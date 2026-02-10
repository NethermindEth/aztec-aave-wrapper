/**
 * Deploy contracts to Aztec Devnet + Ethereum Sepolia
 *
 * Deploys the Aztec Aave Wrapper system to public testnets:
 *
 * L1 (Ethereum Sepolia):
 *   - MockERC20 (USDC) - Test token
 *   - MockLendingPool - Simulates Aave V3
 *   - TokenFaucet - Distributes test tokens
 *   - TokenPortal (bridges USDC between L1 and L2)
 *   - AztecAavePortalL1 (executes Aave operations)
 *
 * L2 (Aztec Devnet):
 *   - BridgedToken (L2 USDC representation)
 *   - AaveWrapper (privacy-preserving Aave interface)
 *
 * Prerequisites:
 *   - Copy .env.devnet.example to .env.devnet and configure
 *   - Deployer wallet must have Sepolia ETH
 *   - All contracts built (make build)
 *
 * Usage:
 *   bun run scripts/deploy-devnet.ts
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

// Load environment variables from .env.devnet
const envPath = join(__dirname, "../.env.devnet");
if (!existsSync(envPath)) {
  console.error("✗ Missing .env.devnet file");
  console.error("  Copy .env.devnet.example to .env.devnet and configure it");
  process.exit(1);
}
config({ path: envPath });

// =============================================================================
// Configuration from Environment
// =============================================================================

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "https://devnet-6.aztec-labs.com";
const L1_RPC_URL = process.env.L1_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// Aztec L1 contracts (pre-deployed by Aztec team on Sepolia)
const AZTEC_INBOX = process.env.AZTEC_INBOX || "0x8ea98d35d7712ca236ac7a2b2f47d9fb5c9154e8";
const AZTEC_OUTBOX = process.env.AZTEC_OUTBOX || "0x6628f5648dcee4ee4c3262ed35a995039cadb669";

// Sponsored FPC for L2 fee payment
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS ||
  "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

const L1_CHAIN_ID = 11155111; // Sepolia

// Faucet configuration
const FAUCET_DRIP_AMOUNT = "1000000000"; // 1000 USDC (6 decimals)
const FAUCET_COOLDOWN = "3600"; // 1 hour

// =============================================================================
// Validation
// =============================================================================

if (!DEPLOYER_PRIVATE_KEY) {
  console.error("✗ DEPLOYER_PRIVATE_KEY not set in .env.devnet");
  console.error("  Add your Sepolia deployer private key (with testnet ETH)");
  process.exit(1);
}

// Derive deployer address from private key
function getDeployerAddress(): string {
  try {
    const output = execSync(
      `cast wallet address ${DEPLOYER_PRIVATE_KEY}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return output.trim();
  } catch (error) {
    console.error("✗ Failed to derive deployer address from private key");
    process.exit(1);
  }
}

// =============================================================================
// Types
// =============================================================================

interface DeploymentAddresses {
  l1: {
    mockUsdc: string;
    mockLendingPool: string;
    faucet: string;
    tokenPortal: string;
    portal: string;
    aztecOutbox: string;
    aztecInbox: string;
  };
  l2: {
    bridgedToken: string;
    aaveWrapper: string;
  };
  config: {
    l1ChainId: number;
    network: string;
    deployedAt: string;
    deployer: string;
  };
}

// =============================================================================
// Forge Deployment Helper
// =============================================================================

function deployWithForge(
  contractPath: string,
  constructorArgs: string[],
  rpcUrl: string,
  workDir: string,
  maxRetries: number = 3
): string {
  const contractName = contractPath.split(":")[1] || contractPath;
  console.log(`  Deploying ${contractName}...`);

  const argsArray = [
    "create",
    contractPath,
    "--rpc-url", rpcUrl,
    "--private-key", DEPLOYER_PRIVATE_KEY!,
    "--broadcast",
    "--json",
    "--legacy", // Use legacy transactions for broader compatibility
  ];
  if (constructorArgs.length > 0) {
    argsArray.push("--constructor-args", ...constructorArgs);
  }
  const cmd = `cd ${workDir} && forge ${argsArray.join(" ")} 2>&1`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Increased timeout to 5 minutes for slow testnets
      const output = execSync(cmd, { encoding: "utf-8", timeout: 300000 });

      // Check for compilation errors first
      if (output.includes("error[")) {
        const errorMatch = output.match(/error\[.*?\]:(.*?)(?=\n|$)/i);
        throw new Error(errorMatch ? errorMatch[1].trim() : "Compilation error");
      }

      // Parse JSON output from forge
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
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if it's a timeout or network error (retryable)
      const isRetryable = lastError.message.includes("ETIMEDOUT") ||
                          lastError.message.includes("ECONNRESET") ||
                          lastError.message.includes("network") ||
                          lastError.message.includes("timeout");

      if (isRetryable && attempt < maxRetries) {
        console.log(`    ⚠ Attempt ${attempt}/${maxRetries} failed (timeout), retrying...`);
        // Wait before retry (exponential backoff)
        execSync(`sleep ${attempt * 5}`, { encoding: "utf-8" });
        continue;
      }

      if (error instanceof SyntaxError) {
        console.error(`    ✗ Failed to parse JSON output`);
      } else {
        console.error(`    ✗ Failed after ${attempt} attempts:`, lastError.message);
      }
      throw lastError;
    }
  }

  throw lastError || new Error("Deployment failed");
}

// =============================================================================
// Service Health Checks
// =============================================================================

function checkL1Connection(): boolean {
  try {
    const output = execSync(
      `cast chain-id --rpc-url ${L1_RPC_URL}`,
      { encoding: "utf-8", stdio: "pipe", timeout: 10000 }
    );
    const chainId = parseInt(output.trim());
    if (chainId !== L1_CHAIN_ID) {
      console.error(`  ✗ Wrong chain ID: ${chainId} (expected ${L1_CHAIN_ID})`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function checkAztecConnection(): boolean {
  try {
    execSync(`curl -sf ${AZTEC_NODE_URL}/status`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

function checkDeployerBalance(): string {
  try {
    const address = getDeployerAddress();
    const output = execSync(
      `cast balance ${address} --rpc-url ${L1_RPC_URL} --ether`,
      { encoding: "utf-8", stdio: "pipe", timeout: 10000 }
    );
    return output.trim();
  } catch {
    return "0";
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
  console.log("\n  Deploying L2 contracts on Aztec Devnet...");
  console.log("  (Using aztec-wallet CLI for server-side proving)");

  // Use ${aztecWalletCmd} CLI instead of TypeScript SDK to avoid local proving
  const aztecDir = join(__dirname, "../aztec");
  const bridgedTokenArtifact = join(aztecDir, "target/bridged_token-BridgedToken.json");
  const aaveWrapperArtifact = join(aztecDir, "target/aave_wrapper-AaveWrapper.json");

  // Check artifacts exist
  if (!existsSync(bridgedTokenArtifact)) {
    throw new Error(`BridgedToken artifact not found at ${bridgedTokenArtifact}. Run 'make build-l2' first.`);
  }
  if (!existsSync(aaveWrapperArtifact)) {
    throw new Error(`AaveWrapper artifact not found at ${aaveWrapperArtifact}. Run 'make build-l2' first.`);
  }

  // Find aztec-wallet binary (npm package has missing shebang, so we need to run with node)
  let aztecWalletCmd: string;
  try {
    const walletPath = execSync("which aztec-wallet", { encoding: "utf-8" }).trim();
    aztecWalletCmd = `node ${walletPath}`;
  } catch {
    throw new Error("aztec-wallet not found. Install with: npm install -g @aztec/cli-wallet@3.0.0-devnet.6-patch.1");
  }

  const paymentMethod = `method=fpc-sponsored,fpc=${SPONSORED_FPC_ADDRESS}`;

  // Step 1: Register FPC contract
  console.log("  Registering Sponsored FPC...");
  try {
    execSync(
      `${aztecWalletCmd} register-contract --node-url ${AZTEC_NODE_URL} --alias sponsoredfpc ${SPONSORED_FPC_ADDRESS} SponsoredFPC --salt 0`,
      { encoding: "utf-8", stdio: "pipe", timeout: 60000 }
    );
    console.log(`    ✓ Sponsored FPC registered`);
  } catch (e) {
    // May already be registered, continue
    console.log(`    ✓ Sponsored FPC (already registered or skipped)`);
  }

  // Step 2: Create admin account
  console.log("  Creating admin account...");
  let adminAddress: string;
  try {
    const accountOutput = execSync(
      `${aztecWalletCmd} create-account --node-url ${AZTEC_NODE_URL} --alias aave-admin --payment "${paymentMethod}"`,
      { encoding: "utf-8", stdio: "pipe", timeout: 300000 }
    );
    // Extract address from output
    const addressMatch = accountOutput.match(/Address:\s*(0x[a-fA-F0-9]{64})/);
    if (addressMatch) {
      adminAddress = addressMatch[1];
    } else {
      throw new Error("Could not extract admin address from output: " + accountOutput);
    }
    console.log(`    ✓ Admin account: ${adminAddress}`);
  } catch (e: any) {
    // Check if account already exists (existing nullifier error)
    if (e.message?.includes("Existing nullifier") || e.stdout?.includes("Existing nullifier")) {
      console.log(`    ✓ Admin account already exists`);
      // Get the address from wallet
      const getAddrOutput = execSync(
        `${aztecWalletCmd} get-alias accounts:aave-admin --node-url ${AZTEC_NODE_URL}`,
        { encoding: "utf-8", stdio: "pipe", timeout: 30000 }
      );
      const addrMatch = getAddrOutput.match(/0x[a-fA-F0-9]{64}/);
      if (addrMatch) {
        adminAddress = addrMatch[0];
      } else {
        throw new Error("Could not get existing admin address");
      }
    } else {
      throw e;
    }
  }

  // Helper to pad Ethereum address (20 bytes) to Field (32 bytes)
  const padEthAddress = (addr: string): string => {
    const cleaned = addr.toLowerCase().replace("0x", "");
    return "0x" + cleaned.padStart(64, "0");
  };

  // Step 3: Deploy BridgedToken
  console.log("  Deploying BridgedToken...");
  // Constructor: admin, portal_address, name, symbol, decimals
  // name and symbol are Field types (packed strings)
  const tokenName = "1431520323"; // "USDC" packed as field
  const tokenSymbol = "1431520323"; // "USDC" packed as field
  const paddedTokenPortal = padEthAddress(tokenPortalAddress);
  const deployBridgedTokenCmd = [
    `${aztecWalletCmd} deploy`,
    `--node-url ${AZTEC_NODE_URL}`,
    "--from accounts:aave-admin",
    `--payment "${paymentMethod}"`,
    "--alias bridged-token",
    `"${bridgedTokenArtifact}"`,
    `--args accounts:aave-admin ${paddedTokenPortal} ${tokenName} ${tokenSymbol} 6`,
    "--no-wait"
  ].join(" ");

  let bridgedTokenAddress: string;
  try {
    const deployOutput = execSync(deployBridgedTokenCmd, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 300000,
    });
    const addrMatch = deployOutput.match(/Contract deployed at\s*(0x[a-fA-F0-9]{64})/);
    if (addrMatch) {
      bridgedTokenAddress = addrMatch[1];
    } else {
      // Try to get from alias
      console.log("    Waiting for deployment to complete...");
      await new Promise(resolve => setTimeout(resolve, 30000));
      const getOutput = execSync(
        `${aztecWalletCmd} get-alias contracts:bridged-token --node-url ${AZTEC_NODE_URL}`,
        { encoding: "utf-8", stdio: "pipe", timeout: 30000 }
      );
      const match = getOutput.match(/0x[a-fA-F0-9]{64}/);
      if (match) {
        bridgedTokenAddress = match[0];
      } else {
        throw new Error("Could not get BridgedToken address");
      }
    }
    console.log(`    ✓ BridgedToken: ${bridgedTokenAddress}`);
  } catch (e: any) {
    throw new Error(`BridgedToken deployment failed: ${e.message}`);
  }

  // Wait for BridgedToken to be mined
  console.log("  Waiting for BridgedToken to be mined...");
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Step 4: Deploy AaveWrapper
  console.log("  Deploying AaveWrapper...");
  // Constructor: admin, portal_address, bridged_token, fee_treasury
  const paddedPortal = padEthAddress(portalAddress);
  const deployAaveWrapperCmd = [
    `${aztecWalletCmd} deploy`,
    `--node-url ${AZTEC_NODE_URL}`,
    "--from accounts:aave-admin",
    `--payment "${paymentMethod}"`,
    "--alias aave-wrapper",
    `"${aaveWrapperArtifact}"`,
    `--args accounts:aave-admin ${paddedPortal} ${bridgedTokenAddress} accounts:aave-admin`,
    "--no-wait"
  ].join(" ");

  let aaveWrapperAddress: string;
  try {
    const deployOutput = execSync(deployAaveWrapperCmd, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 300000,
    });
    const addrMatch = deployOutput.match(/Contract deployed at\s*(0x[a-fA-F0-9]{64})/);
    if (addrMatch) {
      aaveWrapperAddress = addrMatch[1];
    } else {
      console.log("    Waiting for deployment to complete...");
      await new Promise(resolve => setTimeout(resolve, 30000));
      const getOutput = execSync(
        `${aztecWalletCmd} get-alias contracts:aave-wrapper --node-url ${AZTEC_NODE_URL}`,
        { encoding: "utf-8", stdio: "pipe", timeout: 30000 }
      );
      const match = getOutput.match(/0x[a-fA-F0-9]{64}/);
      if (match) {
        aaveWrapperAddress = match[0];
      } else {
        throw new Error("Could not get AaveWrapper address");
      }
    }
    console.log(`    ✓ AaveWrapper: ${aaveWrapperAddress}`);
  } catch (e: any) {
    throw new Error(`AaveWrapper deployment failed: ${e.message}`);
  }

  // Wait for AaveWrapper to be mined
  console.log("  Waiting for AaveWrapper to be mined...");
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Step 5: Configure BridgedToken - set AaveWrapper as minter
  console.log("  Configuring BridgedToken minter...");
  try {
    execSync(
      `${aztecWalletCmd} send set_minter --node-url ${AZTEC_NODE_URL} --from accounts:aave-admin --payment "${paymentMethod}" --contract-address contracts:bridged-token --args ${aaveWrapperAddress}`,
      { encoding: "utf-8", stdio: "pipe", timeout: 300000 }
    );
    console.log(`    ✓ Minter set to AaveWrapper`);
  } catch (e: any) {
    console.log(`    ⚠ set_minter may have failed: ${e.message}`);
  }

  // Step 6: Authorize AaveWrapper as burner
  console.log("  Authorizing AaveWrapper as burner...");
  try {
    execSync(
      `${aztecWalletCmd} send authorize_burner --node-url ${AZTEC_NODE_URL} --from accounts:aave-admin --payment "${paymentMethod}" --contract-address contracts:bridged-token --args ${aaveWrapperAddress} true`,
      { encoding: "utf-8", stdio: "pipe", timeout: 300000 }
    );
    console.log(`    ✓ AaveWrapper authorized as burner`);
  } catch (e: any) {
    console.log(`    ⚠ authorize_burner may have failed: ${e.message}`);
  }

  return {
    bridgedToken: bridgedTokenAddress!,
    aaveWrapper: aaveWrapperAddress!,
  };
}

// =============================================================================
// Main Deployment
// =============================================================================

async function main() {
  console.log("═".repeat(70));
  console.log("  AZTEC AAVE WRAPPER - DEVNET DEPLOYMENT");
  console.log("═".repeat(70));
  console.log("\nNetwork: Aztec Devnet + Ethereum Sepolia");

  const deployerAddress = getDeployerAddress();

  // ---------------------------------------------------------------------------
  // Health Checks
  // ---------------------------------------------------------------------------
  console.log("\n[1/4] Checking connections...");

  const l1Connected = checkL1Connection();
  const aztecConnected = checkAztecConnection();
  const deployerBalance = checkDeployerBalance();

  console.log(`  Sepolia RPC: ${l1Connected ? "✓ Connected" : "✗ Failed"}`);
  console.log(`  Aztec Devnet: ${aztecConnected ? "✓ Connected" : "✗ Failed"}`);
  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  Balance: ${deployerBalance} ETH`);

  if (!l1Connected) {
    console.error("\n✗ Cannot connect to Sepolia. Check L1_RPC_URL in .env.devnet");
    process.exit(1);
  }

  if (!aztecConnected) {
    console.error("\n✗ Cannot connect to Aztec Devnet. Check AZTEC_NODE_URL in .env.devnet");
    process.exit(1);
  }

  if (parseFloat(deployerBalance) < 0.01) {
    console.error("\n✗ Insufficient Sepolia ETH. Get testnet ETH from https://sepoliafaucet.com");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Check for existing partial deployment (resume capability)
  // ---------------------------------------------------------------------------
  const deploymentsPath = join(__dirname, "../.deployments.devnet.json");
  let existingDeployment: Partial<DeploymentAddresses> | null = null;

  if (existsSync(deploymentsPath)) {
    try {
      existingDeployment = JSON.parse(readFileSync(deploymentsPath, "utf-8"));
      console.log("\n  Found existing deployment, will resume...");
    } catch {
      existingDeployment = null;
    }
  }

  // Initialize addresses from existing deployment (if any) to preserve resume state
  const addresses: DeploymentAddresses = {
    l1: {
      mockUsdc: existingDeployment?.l1?.mockUsdc || "",
      mockLendingPool: existingDeployment?.l1?.mockLendingPool || "",
      faucet: existingDeployment?.l1?.faucet || "",
      tokenPortal: existingDeployment?.l1?.tokenPortal || "",
      portal: existingDeployment?.l1?.portal || "",
      aztecOutbox: AZTEC_OUTBOX,
      aztecInbox: AZTEC_INBOX,
    },
    l2: {
      bridgedToken: existingDeployment?.l2?.bridgedToken || "",
      aaveWrapper: existingDeployment?.l2?.aaveWrapper || "",
    },
    config: {
      l1ChainId: L1_CHAIN_ID,
      network: "devnet",
      deployedAt: existingDeployment?.config?.deployedAt || new Date().toISOString(),
      deployer: deployerAddress,
    },
  };
  // Copy mockAToken from existing deployment if present
  if ((existingDeployment as any)?.l1?.mockAToken) {
    (addresses.l1 as any).mockAToken = (existingDeployment as any).l1.mockAToken;
  }

  // ---------------------------------------------------------------------------
  // L1 Contract Deployments
  // ---------------------------------------------------------------------------
  console.log("\n[2/4] Deploying L1 contracts on Sepolia...");

  // Helper to check if contract already deployed
  const isDeployed = (addr: string | undefined): addr is string =>
    !!addr && addr !== "" && !addr.startsWith("0x00000000");

  // Deploy MockERC20 for USDC (6 decimals)
  if (isDeployed(existingDeployment?.l1?.mockUsdc)) {
    addresses.l1.mockUsdc = existingDeployment.l1.mockUsdc;
    console.log(`  MockUSDC: ✓ Already deployed at ${addresses.l1.mockUsdc}`);
  } else {
    addresses.l1.mockUsdc = deployWithForge(
      "contracts/mocks/MockERC20.sol:MockERC20",
      ['"Mock USDC"', '"USDC"', "6"],
      L1_RPC_URL,
      "eth"
    );
  }

  // Deploy TokenFaucet for distributing test tokens
  if (isDeployed(existingDeployment?.l1?.faucet)) {
    addresses.l1.faucet = existingDeployment.l1.faucet;
    console.log(`  TokenFaucet: ✓ Already deployed at ${addresses.l1.faucet}`);
  } else {
    addresses.l1.faucet = deployWithForge(
      "contracts/mocks/TokenFaucet.sol:TokenFaucet",
      [addresses.l1.mockUsdc, FAUCET_DRIP_AMOUNT, FAUCET_COOLDOWN],
      L1_RPC_URL,
      "eth"
    );
  }

  // Deploy MockLendingPool
  if (isDeployed(existingDeployment?.l1?.mockLendingPool)) {
    addresses.l1.mockLendingPool = existingDeployment.l1.mockLendingPool;
    console.log(`  MockLendingPool: ✓ Already deployed at ${addresses.l1.mockLendingPool}`);
  } else {
    addresses.l1.mockLendingPool = deployWithForge(
      "contracts/mocks/MockLendingPool.sol:MockLendingPool",
      [],
      L1_RPC_URL,
      "eth"
    );
  }

  // Deploy mock aToken for USDC and configure lending pool
  // We need to track aToken separately for resume
  let mockAToken: string;
  const aTokenConfigKey = "mockAToken";
  const existingAToken = (existingDeployment as any)?.l1?.[aTokenConfigKey];

  if (isDeployed(existingAToken)) {
    mockAToken = existingAToken;
    console.log(`  MockAToken: ✓ Already deployed at ${mockAToken}`);
  } else {
    console.log("\n  Deploying mock aToken...");
    mockAToken = deployWithForge(
      "contracts/mocks/MockERC20.sol:MockERC20",
      ['"Mock aUSDC"', '"aUSDC"', "6"],
      L1_RPC_URL,
      "eth"
    );

    // Configure the lending pool to return aToken address for USDC
    console.log("\n  Configuring MockLendingPool aToken...");
    const configureATokenCmd = [
      "cast send",
      addresses.l1.mockLendingPool,
      '"setATokenAddress(address,address)"',
      addresses.l1.mockUsdc,
      mockAToken,
      "--rpc-url", L1_RPC_URL,
      "--private-key", DEPLOYER_PRIVATE_KEY!,
      "--legacy",
    ].join(" ");
    execSync(configureATokenCmd, { encoding: "utf-8", stdio: "pipe", timeout: 120000 });
    console.log(`    ✓ aToken configured: ${mockAToken.slice(0, 10)}...`);
  }

  // Save aToken to addresses for resume capability
  (addresses.l1 as any).mockAToken = mockAToken;

  // Save partial progress after each major step
  const saveProgress = () => {
    writeFileSync(deploymentsPath, JSON.stringify(addresses, null, 2) + "\n");
  };
  saveProgress();

  // L2 contract address placeholder (will be updated after L2 deployment)
  const l2BridgePlaceholder = "0x" + "00".repeat(32);

  // Deploy TokenPortal for L1<->L2 token bridging
  if (isDeployed(existingDeployment?.l1?.tokenPortal)) {
    addresses.l1.tokenPortal = existingDeployment.l1.tokenPortal;
    console.log(`  TokenPortal: ✓ Already deployed at ${addresses.l1.tokenPortal}`);
  } else {
    addresses.l1.tokenPortal = deployWithForge(
      "contracts/TokenPortal.sol:TokenPortal",
      [
        addresses.l1.mockUsdc,     // underlying token (our mock USDC)
        AZTEC_INBOX,               // Aztec inbox for L1->L2 messages
        AZTEC_OUTBOX,              // Aztec outbox for L2->L1 messages
        l2BridgePlaceholder,       // L2 bridge address (placeholder)
        "0x0000000000000000000000000000000000000000", // No authorized withdrawer initially
        deployerAddress,           // Initial owner
      ],
      L1_RPC_URL,
      "eth"
    );
    saveProgress();
  }

  // L2 contract address placeholder
  const l2ContractPlaceholder = "0x" + "00".repeat(32);

  // Deploy AztecAavePortalL1
  if (isDeployed(existingDeployment?.l1?.portal)) {
    addresses.l1.portal = existingDeployment.l1.portal;
    console.log(`  AztecAavePortal: ✓ Already deployed at ${addresses.l1.portal}`);
  } else {
    addresses.l1.portal = deployWithForge(
      "contracts/AztecAavePortalL1.sol:AztecAavePortalL1",
      [
        AZTEC_OUTBOX,
        AZTEC_INBOX,
        addresses.l1.tokenPortal,
        addresses.l1.mockLendingPool,
        l2ContractPlaceholder,
        deployerAddress,
      ],
      L1_RPC_URL,
      "eth"
    );
    saveProgress();
  }

  // Authorize the portal to withdraw from TokenPortal (skip if resuming with both already deployed)
  const portalAlreadyConfigured = isDeployed(existingDeployment?.l1?.portal) &&
                                   isDeployed(existingDeployment?.l1?.tokenPortal);
  if (!portalAlreadyConfigured) {
    console.log("\n  Configuring TokenPortal authorized withdrawer...");
    const setAuthorizedWithdrawerCmd = [
      "cast send",
      addresses.l1.tokenPortal,
      '"setAuthorizedWithdrawer(address,bool)"',
      addresses.l1.portal,
      "true",
      "--rpc-url", L1_RPC_URL,
      "--private-key", DEPLOYER_PRIVATE_KEY!,
      "--legacy",
    ].join(" ");
    execSync(setAuthorizedWithdrawerCmd, { encoding: "utf-8", stdio: "pipe", timeout: 300000 });
    console.log(`    ✓ Portal authorized: ${addresses.l1.portal.slice(0, 10)}...`);
    saveProgress();
  }

  // ---------------------------------------------------------------------------
  // L2 Contract Deployments
  // ---------------------------------------------------------------------------
  console.log("\n[3/4] Deploying L2 contracts on Aztec Devnet...");

  try {
    const l2Result = await deployL2Contracts(addresses.l1.portal, addresses.l1.tokenPortal);
    addresses.l2.bridgedToken = l2Result.bridgedToken;
    addresses.l2.aaveWrapper = l2Result.aaveWrapper;

    // Save L2 addresses immediately so they're not lost if L1 updates fail
    saveProgress();
    console.log("    ✓ L2 addresses saved to deployment file");

    // Update L1 portal with the actual L2 contract address
    console.log("\n  Updating L1 portal with L2 contract address...");
    const updateL2AddressCmd = [
      "cast send",
      addresses.l1.portal,
      '"setL2ContractAddress(bytes32)"',
      addresses.l2.aaveWrapper,
      "--rpc-url", L1_RPC_URL,
      "--private-key", DEPLOYER_PRIVATE_KEY!,
      "--legacy",
      "--gas-price", "50gwei",
    ].join(" ");
    execSync(updateL2AddressCmd, { encoding: "utf-8", stdio: "pipe", timeout: 120000 });
    console.log(`    ✓ L2 address set: ${addresses.l2.aaveWrapper.slice(0, 18)}...`);

    // Update TokenPortal with the actual L2 BridgedToken address
    console.log("\n  Updating TokenPortal with L2 BridgedToken address...");
    const setL2BridgeCmd = [
      "cast send",
      addresses.l1.tokenPortal,
      '"setL2Bridge(bytes32)"',
      addresses.l2.bridgedToken,
      "--rpc-url", L1_RPC_URL,
      "--private-key", DEPLOYER_PRIVATE_KEY!,
      "--legacy",
      "--gas-price", "50gwei",
    ].join(" ");
    execSync(setL2BridgeCmd, { encoding: "utf-8", stdio: "pipe", timeout: 120000 });
    console.log(`    ✓ L2 bridge set: ${addresses.l2.bridgedToken.slice(0, 18)}...`);
  } catch (error) {
    console.error("\n✗ L2 deployment failed:", error instanceof Error ? error.message : error);
    console.log("\nL1 contracts were deployed successfully. You can retry L2 deployment later.");
    console.log("L1 Portal:", addresses.l1.portal);
    console.log("L1 TokenPortal:", addresses.l1.tokenPortal);
    if (addresses.l2.bridgedToken) console.log("L2 BridgedToken:", addresses.l2.bridgedToken);
    if (addresses.l2.aaveWrapper) console.log("L2 AaveWrapper:", addresses.l2.aaveWrapper);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Save Addresses
  // ---------------------------------------------------------------------------
  console.log("\n[4/4] Saving deployment addresses...");

  writeFileSync(deploymentsPath, JSON.stringify(addresses, null, 2) + "\n");
  console.log(`  Saved: ${deploymentsPath}`);

  // Copy to frontend public folder
  const frontendPublicPath = join(__dirname, "../frontend/public/.deployments.devnet.json");
  writeFileSync(frontendPublicPath, JSON.stringify(addresses, null, 2) + "\n");
  console.log(`  Created: ${frontendPublicPath}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(70));

  console.log("\nL1 Contracts (Sepolia):");
  console.log(`  MockUSDC:              ${addresses.l1.mockUsdc}`);
  console.log(`  MockLendingPool:       ${addresses.l1.mockLendingPool}`);
  console.log(`  TokenFaucet:           ${addresses.l1.faucet}`);
  console.log(`  TokenPortal:           ${addresses.l1.tokenPortal}`);
  console.log(`  AztecAavePortal:       ${addresses.l1.portal}`);

  console.log("\nL2 Contracts (Aztec Devnet):");
  console.log(`  BridgedToken (USDC):   ${addresses.l2.bridgedToken}`);
  console.log(`  AaveWrapper:           ${addresses.l2.aaveWrapper}`);

  console.log("\nExplorer Links:");
  console.log(`  L1 Portal: https://sepolia.etherscan.io/address/${addresses.l1.portal}`);
  console.log(`  L1 Faucet: https://sepolia.etherscan.io/address/${addresses.l1.faucet}`);
  console.log(`  L2 Wrapper: https://devnet.aztecscan.xyz/contracts/${addresses.l2.aaveWrapper}`);

  console.log("\nNext steps:");
  console.log("  1. Get test USDC from faucet: cast send " + addresses.l1.faucet + ' "drip()" --rpc-url ' + L1_RPC_URL);
  console.log("  2. Bridge USDC to L2 via TokenPortal");
  console.log("  3. Use AaveWrapper to deposit into Aave with privacy");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n✗ Deployment failed:", error);
    process.exit(1);
  });
