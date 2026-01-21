/**
 * Contract Deployment Orchestrator
 *
 * Coordinates L1 and L2 contract deployment with correct ordering.
 *
 * DEPLOYMENT ORDER (critical for cross-chain messaging to work):
 * 1. Deploy L1 contracts first with placeholder L2 address
 * 2. Deploy L2 contract with actual L1 portal address
 * 3. Update L1 portal's L2 contract reference
 *
 * This order ensures the L2 contract has the correct portal address,
 * which is required for consume_l1_to_l2_message to work correctly.
 * The L1 portal has a setL2ContractAddress function that allows updating
 * the L2 reference after deployment.
 */

import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";

// L1 Services
import {
  deployL1Contracts,
  type AztecL1Addresses,
  type L1Addresses,
  type L1DeploymentArtifacts,
} from "../services/l1/deploy.js";

// L2 Services
import { createL2NodeClient, type AztecNodeClient } from "../services/l2/client.js";
import { type AaveWrapperContract, deployL2Contract } from "../services/l2/deploy.js";
import type { AztecAddress, TestWallet } from "../services/l2/wallet.js";

// Store
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Placeholder L2 address used during L1 deployment.
 * The L1 portal's setL2ContractAddress function is used after L2 deployment
 * to update this reference.
 */
export const PLACEHOLDER_L2_ADDRESS: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

// =============================================================================
// Aztec L1 Address Fetching
// =============================================================================

/**
 * Fetch real Aztec L1 contract addresses from the sandbox/node.
 *
 * IMPORTANT: These addresses are required for L1→L2 messaging to work.
 * The portal must use the REAL Aztec inbox, not a mock.
 *
 * @param node - Connected Aztec node client (optional, will create one if not provided)
 * @returns Real Aztec L1 addresses including inbox
 *
 * @example
 * ```ts
 * const aztecL1Addresses = await fetchAztecL1Addresses();
 * console.log('Real inbox:', aztecL1Addresses.inboxAddress);
 * ```
 */
export async function fetchAztecL1Addresses(node?: AztecNodeClient): Promise<AztecL1Addresses> {
  logInfo("Fetching real Aztec L1 contract addresses from sandbox...");

  const aztecNode = node ?? (await createL2NodeClient());
  const nodeInfo = await aztecNode.getNodeInfo();

  const l1Addresses = nodeInfo.l1ContractAddresses;

  if (!l1Addresses?.inboxAddress) {
    throw new Error(
      "Failed to fetch Aztec inbox address from node. " + "Make sure the Aztec sandbox is running."
    );
  }
  if (!l1Addresses?.outboxAddress) {
    throw new Error(
      "Failed to fetch Aztec outbox address from node. " + "Make sure the Aztec sandbox is running."
    );
  }

  const aztecL1Addresses: AztecL1Addresses = {
    inboxAddress: l1Addresses.inboxAddress.toString() as Address,
    outboxAddress: l1Addresses.outboxAddress.toString() as Address,
    registryAddress: l1Addresses.registryAddress?.toString() as Address | undefined,
  };

  logSuccess(`Real Aztec inbox: ${aztecL1Addresses.inboxAddress}`);
  logSuccess(`Real Aztec outbox: ${aztecL1Addresses.outboxAddress}`);

  return aztecL1Addresses;
}

// =============================================================================
// Types
// =============================================================================

/**
 * L1 deployment context
 */
export interface L1DeploymentContext {
  /** Public client for reading chain state */
  publicClient: PublicClient<Transport, Chain>;
  /** Wallet client with deployer account */
  deployerWallet: WalletClient<Transport, Chain, Account>;
  /** Contract artifacts for deployment */
  artifacts: L1DeploymentArtifacts;
  /** Real Aztec L1 addresses (REQUIRED for L1→L2 messaging) */
  aztecL1Addresses: AztecL1Addresses;
}

/**
 * L2 deployment context
 */
export interface L2DeploymentContext {
  /** Test wallet for deployment */
  wallet: TestWallet;
  /** Wallet address (becomes contract admin) */
  walletAddress: AztecAddress;
  /** L2 bridged token contract address */
  bridgedTokenAddress: AztecAddress;
  /** L2 fee treasury address */
  feeTreasuryAddress: AztecAddress;
}

/**
 * Result of full deployment orchestration
 */
export interface DeploymentResult {
  /** L2 AaveWrapper contract instance */
  l2Contract: AaveWrapperContract;
  /** L2 contract address */
  l2Address: AztecAddress;
  /** All L1 contract addresses */
  l1Addresses: L1Addresses;
}

/**
 * Deployment error with context
 */
export class DeploymentError extends Error {
  constructor(
    public readonly step: "L2" | "L1",
    public readonly cause: unknown
  ) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(`Deployment failed at ${step}: ${message}`);
    this.name = "DeploymentError";
  }
}

// =============================================================================
// Deployment Steps
// =============================================================================

/**
 * Deploy L1 contracts with placeholder L2 address.
 *
 * This is step 1 of the deployment process. L1 contracts are deployed first
 * so we can use the portal address when deploying L2.
 *
 * Uses the REAL Aztec inbox address from the sandbox for proper L1→L2 messaging.
 *
 * @param context - L1 deployment context (must include aztecL1Addresses)
 * @returns All deployed L1 addresses
 */
async function deployL1WithPlaceholder(context: L1DeploymentContext): Promise<L1Addresses> {
  logSection("L1", "Deploying portal and mock contracts with placeholder L2 address");
  logInfo(`Placeholder L2: ${PLACEHOLDER_L2_ADDRESS.slice(0, 20)}...`);
  logInfo(`Using real Aztec inbox: ${context.aztecL1Addresses.inboxAddress}`);

  const ownerAddress = context.deployerWallet.account.address;

  const addresses = await deployL1Contracts(
    context.publicClient,
    context.deployerWallet,
    context.artifacts,
    {
      l2ContractAddress: PLACEHOLDER_L2_ADDRESS,
      ownerAddress,
      aztecL1Addresses: context.aztecL1Addresses,
    }
  );

  logSuccess(`Portal deployed at ${addresses.portal}`);
  logSuccess(`MockUSDC deployed at ${addresses.mockUsdc}`);
  logSuccess(`MockAToken deployed at ${addresses.mockAToken}`);
  logSuccess(`Real Aztec inbox: ${addresses.aztecInbox}`);

  return addresses;
}

/**
 * Deploy L2 contract with the actual L1 portal address.
 *
 * This is step 2 of the deployment process. Now that we have the L1
 * portal address, we can deploy the L2 contract with the correct reference.
 *
 * @param context - L2 deployment context
 * @param portalAddress - L1 portal address to reference in L2 contract
 * @returns Deployed contract and address
 */
async function deployL2WithPortalAddress(
  context: L2DeploymentContext,
  portalAddress: Address
): Promise<{ contract: AaveWrapperContract; address: AztecAddress }> {
  logSection("L2", "Deploying AaveWrapper with actual portal address");
  logInfo(`Portal address: ${portalAddress}`);

  const result = await deployL2Contract(context.wallet, context.walletAddress, {
    portalAddress: portalAddress,
    bridgedTokenAddress: context.bridgedTokenAddress,
    feeTreasuryAddress: context.feeTreasuryAddress,
  });

  logSuccess(`L2 contract deployed at ${result.address.toString()}`);

  return {
    contract: result.contract,
    address: result.address,
  };
}

/**
 * Update L1 portal's L2 contract reference.
 *
 * This is step 3 of the deployment process. After both contracts are deployed,
 * we update the L1 portal to reference the actual L2 contract address.
 *
 * @param context - L1 deployment context
 * @param portalAddress - L1 portal address
 * @param l2Address - Actual L2 contract address
 */
async function updateL1PortalL2Reference(
  context: L1DeploymentContext,
  portalAddress: Address,
  l2Address: AztecAddress
): Promise<void> {
  logSection("L1", "Updating portal's L2 contract reference");

  const l2AddressHex = l2Address.toString() as Hex;
  logInfo(`Setting L2 contract address: ${l2AddressHex.slice(0, 20)}...`);

  const PORTAL_ABI = [
    {
      type: "function",
      name: "setL2ContractAddress",
      inputs: [{ name: "_l2ContractAddress", type: "bytes32" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ] as const;

  const txHash = await context.deployerWallet.writeContract({
    address: portalAddress,
    abi: PORTAL_ABI,
    functionName: "setL2ContractAddress",
    args: [l2AddressHex],
  });

  await context.publicClient.waitForTransactionReceipt({ hash: txHash });
  logSuccess("L1 portal's L2 reference updated");
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Deploy all contracts in the correct order.
 *
 * This orchestrates the full deployment process:
 * 1. Deploy L1 contracts with placeholder L2 address
 * 2. Deploy L2 contract with actual L1 portal address
 * 3. Update L1 portal's L2 contract reference
 *
 * This order ensures the L2 contract has the correct portal address,
 * which is required for cross-chain messaging to work correctly.
 *
 * @param l1Context - L1 deployment context with clients and artifacts
 * @param l2Context - L2 deployment context with wallet
 * @returns All deployed contracts and addresses
 * @throws DeploymentError if any step fails
 *
 * @example
 * ```ts
 * // First, fetch real Aztec L1 addresses from the sandbox
 * const aztecL1Addresses = await fetchAztecL1Addresses();
 *
 * const result = await deployAllContracts(
 *   {
 *     publicClient,
 *     deployerWallet,
 *     artifacts: await fetchAllArtifacts("/artifacts"),
 *     aztecL1Addresses, // Required for L1→L2 messaging
 *   },
 *   {
 *     wallet,
 *     walletAddress,
 *   }
 * );
 *
 * console.log(`L2 Address: ${result.l2Address.toString()}`);
 * console.log(`L1 Portal: ${result.l1Addresses.portal}`);
 * ```
 */
export async function deployAllContracts(
  l1Context: L1DeploymentContext,
  l2Context: L2DeploymentContext
): Promise<DeploymentResult> {
  const totalSteps = 3;

  logSection("Deploy", "Starting contract deployment orchestration");

  try {
    // Step 1: Deploy L1 contracts with placeholder L2 address
    logStep(1, totalSteps, "Deploy L1 portal and mock contracts");

    const l1Addresses = await deployL1WithPlaceholder(l1Context);

    // Step 2: Deploy L2 contract with actual portal address
    logStep(2, totalSteps, "Deploy L2 AaveWrapper with actual portal address");

    const { contract: l2Contract, address: l2Address } = await deployL2WithPortalAddress(
      l2Context,
      l1Addresses.portal
    );

    // Step 3: Update L1 portal's L2 reference
    logStep(3, totalSteps, "Update L1 portal's L2 contract reference");

    await updateL1PortalL2Reference(l1Context, l1Addresses.portal, l2Address);

    // Log summary
    logSection("Deploy", "All contracts deployed successfully");
    logInfo(`L2 AaveWrapper: ${l2Address.toString()}`);
    logInfo(`L1 Portal: ${l1Addresses.portal}`);
    logInfo(`L1 MockUSDC: ${l1Addresses.mockUsdc}`);
    logInfo(`L1 MockAToken: ${l1Addresses.mockAToken}`);
    logInfo(`L1 MockLendingPool: ${l1Addresses.mockLendingPool}`);
    logInfo(`L1 Aztec Inbox (real): ${l1Addresses.aztecInbox}`);
    logInfo(`L1 Aztec Outbox (real): ${l1Addresses.aztecOutbox}`);

    logSuccess("Deployment complete!");

    return {
      l2Contract,
      l2Address,
      l1Addresses,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError(`Deployment failed: ${message}`);

    // Determine which step failed based on error message
    const step = message.includes("L2") || message.includes("AaveWrapper") ? "L2" : "L1";

    throw new DeploymentError(step, error);
  }
}

/**
 * Deploy contracts with retry logic for transient failures.
 *
 * @param l1Context - L1 deployment context
 * @param l2Context - L2 deployment context
 * @param maxRetries - Maximum retry attempts (default: 2)
 * @returns Deployment result
 */
export async function deployAllContractsWithRetry(
  l1Context: L1DeploymentContext,
  l2Context: L2DeploymentContext,
  maxRetries = 2
): Promise<DeploymentResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logInfo(`Deployment attempt ${attempt}/${maxRetries}`);
      return await deployAllContracts(l1Context, l2Context);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logError(`Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
        logInfo(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Deployment failed after retries");
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Verify that deployed contracts are accessible.
 *
 * Performs basic health checks on deployed contracts:
 * - L1 portal is callable
 * - L1 mock tokens are accessible
 *
 * @param publicClient - L1 public client
 * @param l1Addresses - Deployed L1 addresses
 * @returns True if all checks pass
 */
export async function verifyDeployment(
  publicClient: PublicClient<Transport, Chain>,
  l1Addresses: L1Addresses
): Promise<boolean> {
  logSection("Verify", "Checking deployed contracts...");

  try {
    // Check that contract code exists at portal address
    const portalCode = await publicClient.getCode({
      address: l1Addresses.portal,
    });

    if (!portalCode || portalCode === "0x") {
      logError("Portal contract has no code");
      return false;
    }

    // Check mock token code
    const usdcCode = await publicClient.getCode({
      address: l1Addresses.mockUsdc,
    });

    if (!usdcCode || usdcCode === "0x") {
      logError("MockUSDC contract has no code");
      return false;
    }

    logSuccess("All contracts verified successfully");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError(`Verification failed: ${message}`);
    return false;
  }
}
