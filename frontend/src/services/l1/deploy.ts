/**
 * L1 Contract Deployment Service
 *
 * Deploys mock contracts for local development, matching the pattern
 * from e2e/scripts/full-flow.ts:221-330.
 *
 * This service handles deployment of:
 * - MockERC20 (USDC and aToken)
 * - MockTokenPortal
 * - MockAaveLendingPool
 * - AztecAavePortalL1
 *
 * IMPORTANT: Uses the REAL Aztec inbox and outbox from the sandbox for
 * L1↔L2 messaging. Mock contracts do NOT work for cross-chain messaging.
 */

import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  pad,
  type Transport,
  type WalletClient,
} from "viem";
import { logError, logInfo, logSuccess } from "../../store/logger.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Contract artifact structure (ABI + bytecode)
 */
export interface ContractArtifact {
  abi: Abi;
  bytecode: Hex;
}

/**
 * All required artifacts for L1 deployment
 */
export interface L1DeploymentArtifacts {
  mockERC20: ContractArtifact;
  mockTokenPortal: ContractArtifact;
  mockAaveLendingPool: ContractArtifact;
  aztecAavePortalL1: ContractArtifact;
}

/**
 * Deployed L1 contract addresses
 * Matches L1Addresses interface from e2e/scripts/full-flow.ts:74-83
 */
export interface L1Addresses {
  portal: Address;
  mockUsdc: Address;
  mockAToken: Address;
  mockLendingPool: Address;
  /** Real Aztec outbox address from sandbox (required for L2→L1 messaging) */
  aztecOutbox: Address;
  /** Real Aztec inbox address from sandbox (required for L1→L2 messaging) */
  aztecInbox: Address;
  mockTokenPortal: Address;
}

/**
 * Real Aztec L1 contract addresses from the sandbox.
 * Required for proper L1↔L2 messaging.
 */
export interface AztecL1Addresses {
  /** Aztec inbox address for L1→L2 messages (REQUIRED) */
  inboxAddress: Address;
  /** Aztec outbox address for L2→L1 messages (REQUIRED) */
  outboxAddress: Address;
  /** Aztec registry address */
  registryAddress?: Address;
}

/**
 * Deployment configuration
 */
export interface L1DeploymentConfig {
  /** L2 contract address (will be padded to bytes32) */
  l2ContractAddress: Hex;
  /** Owner/admin address for portal */
  ownerAddress: Address;
  /** Real Aztec L1 addresses from sandbox (REQUIRED for L1→L2 messaging) */
  aztecL1Addresses: AztecL1Addresses;
}

/**
 * Result of a single contract deployment
 */
interface DeploymentResult {
  address: Address;
  txHash: Hex;
}

// =============================================================================
// Single Contract Deployment
// =============================================================================

/**
 * Deploy a single contract and wait for the transaction receipt.
 *
 * @param publicClient - Viem public client for waiting on receipts
 * @param walletClient - Viem wallet client with account for deployment
 * @param artifact - Contract artifact with ABI and bytecode
 * @param args - Constructor arguments
 * @param name - Contract name for logging
 * @returns Deployed contract address
 * @throws Error if deployment fails or receipt is null
 */
async function deployContract(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  artifact: ContractArtifact,
  args: readonly unknown[],
  name: string
): Promise<DeploymentResult> {
  logInfo(`Deploying ${name}...`);

  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (!receipt.contractAddress) {
    const errorMsg = `${name} deployment failed: no contract address in receipt`;
    logError(errorMsg);
    throw new Error(errorMsg);
  }

  logSuccess(`${name} deployed at ${receipt.contractAddress}`);

  return {
    address: receipt.contractAddress,
    txHash,
  };
}

// =============================================================================
// Mock Token Deployment
// =============================================================================

/**
 * Deploy MockERC20 token with specified name, symbol, and decimals.
 */
async function deployMockERC20(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  artifact: ContractArtifact,
  name: string,
  symbol: string,
  decimals: number
): Promise<DeploymentResult> {
  return deployContract(
    publicClient,
    walletClient,
    artifact,
    [name, symbol, decimals],
    `MockERC20 (${symbol})`
  );
}

// =============================================================================
// Main Deployment Function
// =============================================================================

/**
 * Deploy all L1 contracts for local development.
 *
 * Deployment order:
 * 1. MockERC20 (USDC)
 * 2. MockERC20 (aUSDC/aToken)
 * 3. MockTokenPortal
 * 4. MockAaveLendingPool (needs USDC + aToken addresses)
 * 5. AztecAavePortalL1 (uses REAL inbox and outbox from sandbox)
 *
 * @param publicClient - Viem public client
 * @param walletClient - Viem wallet client with deployer account
 * @param artifacts - Pre-loaded contract artifacts
 * @param config - Deployment configuration (MUST include aztecL1Addresses)
 * @returns All deployed contract addresses
 *
 * @example
 * ```ts
 * const addresses = await deployL1Contracts(
 *   publicClient,
 *   deployerWallet,
 *   artifacts,
 *   {
 *     l2ContractAddress: l2Address,
 *     ownerAddress: deployerAddress,
 *     aztecL1Addresses: { inboxAddress: realInboxFromSandbox },
 *   }
 * );
 * ```
 */
export async function deployL1Contracts(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  artifacts: L1DeploymentArtifacts,
  config: L1DeploymentConfig
): Promise<L1Addresses> {
  logInfo("Starting L1 contract deployment...");

  // Validate required real inbox and outbox addresses
  if (!config.aztecL1Addresses?.inboxAddress) {
    throw new Error(
      "Real Aztec inbox address is required. " +
        "Fetch it from node.getNodeInfo().l1ContractAddresses.inboxAddress"
    );
  }
  if (!config.aztecL1Addresses?.outboxAddress) {
    throw new Error(
      "Real Aztec outbox address is required. " +
        "Fetch it from node.getNodeInfo().l1ContractAddresses.outboxAddress"
    );
  }

  const aztecInbox = config.aztecL1Addresses.inboxAddress;
  const aztecOutbox = config.aztecL1Addresses.outboxAddress;
  logInfo(`Using real Aztec inbox: ${aztecInbox}`);
  logInfo(`Using real Aztec outbox: ${aztecOutbox}`);

  // 1. Deploy MockERC20 (USDC)
  const { address: mockUsdc } = await deployMockERC20(
    publicClient,
    walletClient,
    artifacts.mockERC20,
    "Mock USDC",
    "USDC",
    6
  );

  // 2. Deploy MockERC20 (aToken)
  const { address: mockAToken } = await deployMockERC20(
    publicClient,
    walletClient,
    artifacts.mockERC20,
    "Aave Mock USDC",
    "aUSDC",
    6
  );

  // 3. Deploy MockTokenPortal
  const { address: mockTokenPortal } = await deployContract(
    publicClient,
    walletClient,
    artifacts.mockTokenPortal,
    [],
    "MockTokenPortal"
  );

  // 4. Deploy MockAaveLendingPool
  const { address: mockLendingPool } = await deployContract(
    publicClient,
    walletClient,
    artifacts.mockAaveLendingPool,
    [mockUsdc, mockAToken],
    "MockAaveLendingPool"
  );

  // 5. Deploy AztecAavePortalL1
  // Pad L2 address to bytes32 as required by the portal constructor
  const l2AddressBytes32 = pad(config.l2ContractAddress, { size: 32 });

  const { address: portal } = await deployContract(
    publicClient,
    walletClient,
    artifacts.aztecAavePortalL1,
    [
      aztecOutbox, // REAL Aztec outbox - required for L2→L1 messaging
      aztecInbox, // REAL Aztec inbox - required for L1→L2 messaging
      mockTokenPortal,
      mockLendingPool,
      l2AddressBytes32,
      config.ownerAddress,
    ],
    "AztecAavePortalL1"
  );

  logSuccess("All L1 contracts deployed successfully");

  return {
    portal,
    mockUsdc,
    mockAToken,
    mockLendingPool,
    aztecOutbox,
    aztecInbox,
    mockTokenPortal,
  };
}

// =============================================================================
// Artifact Loading Helpers
// =============================================================================

/**
 * Extract bytecode from Foundry artifact format.
 * Foundry stores bytecode in artifact.bytecode.object
 */
export function extractBytecode(artifact: { bytecode: { object: string } }): Hex {
  const bytecode = artifact.bytecode.object;
  // Ensure it has 0x prefix
  return (bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`) as Hex;
}

/**
 * Create a ContractArtifact from a raw Foundry artifact JSON.
 *
 * @param rawArtifact - Parsed JSON from Foundry compilation output
 * @returns ContractArtifact ready for deployment
 *
 * @example
 * ```ts
 * const artifact = createArtifact(await fetchArtifact("MockERC20"));
 * ```
 */
export function createArtifact(rawArtifact: {
  abi: Abi;
  bytecode: { object: string };
}): ContractArtifact {
  return {
    abi: rawArtifact.abi,
    bytecode: extractBytecode(rawArtifact),
  };
}

// =============================================================================
// Artifact Fetching (for browser environments)
// =============================================================================

/**
 * Artifact path configuration for fetching from a server.
 * Maps contract names to their artifact file paths.
 */
export const ARTIFACT_PATHS = {
  mockERC20: "MockERC20.sol/MockERC20.json",
  mockTokenPortal: "Portal.t.sol/MockTokenPortal.json",
  mockAaveLendingPool: "Portal.t.sol/MockAaveLendingPool.json",
  aztecAavePortalL1: "AztecAavePortalL1.sol/AztecAavePortalL1.json",
} as const;

/**
 * Fetch a contract artifact from a base URL.
 * Useful for browser environments where artifacts are served statically.
 *
 * @param baseUrl - Base URL where artifacts are hosted (e.g., "/artifacts")
 * @param artifactPath - Path to the artifact file
 * @returns Parsed artifact ready for deployment
 *
 * @example
 * ```ts
 * const artifact = await fetchArtifact(
 *   "/artifacts",
 *   ARTIFACT_PATHS.mockERC20
 * );
 * ```
 */
export async function fetchArtifact(
  baseUrl: string,
  artifactPath: string
): Promise<ContractArtifact> {
  const url = `${baseUrl}/${artifactPath}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch artifact from ${url}: ${response.statusText}`);
  }

  const rawArtifact = await response.json();
  return createArtifact(rawArtifact);
}

/**
 * Fetch all required artifacts for L1 deployment.
 *
 * @param baseUrl - Base URL where artifacts are hosted
 * @returns All artifacts needed for deployL1Contracts
 *
 * @example
 * ```ts
 * const artifacts = await fetchAllArtifacts("/artifacts");
 * const addresses = await deployL1Contracts(client, wallet, artifacts, config);
 * ```
 */
export async function fetchAllArtifacts(baseUrl: string): Promise<L1DeploymentArtifacts> {
  const [mockERC20, mockTokenPortal, mockAaveLendingPool, aztecAavePortalL1] = await Promise.all([
    fetchArtifact(baseUrl, ARTIFACT_PATHS.mockERC20),
    fetchArtifact(baseUrl, ARTIFACT_PATHS.mockTokenPortal),
    fetchArtifact(baseUrl, ARTIFACT_PATHS.mockAaveLendingPool),
    fetchArtifact(baseUrl, ARTIFACT_PATHS.aztecAavePortalL1),
  ]);

  return {
    mockERC20,
    mockTokenPortal,
    mockAaveLendingPool,
    aztecAavePortalL1,
  };
}
