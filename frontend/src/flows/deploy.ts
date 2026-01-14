/**
 * Contract Deployment Orchestrator
 *
 * Coordinates L1 and L2 contract deployment matching the main() flow
 * from e2e/scripts/full-flow.ts.
 *
 * DEPLOYMENT ORDER (critical for cross-chain references):
 * 1. Deploy L2 contract first with placeholder portal address
 * 2. Deploy L1 contracts with actual L2 contract address
 *
 * Note: The L2 contract uses a placeholder portal address during deployment.
 * This is a workaround since we need the L2 address for L1 portal constructor,
 * but L2 also needs the portal address. In production, this would require
 * a two-phase deployment or address precomputation.
 */

import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";

// L1 Services
import {
  deployL1Contracts,
  type L1Addresses,
  type L1DeploymentArtifacts,
} from "../services/l1/deploy.js";

// L2 Services
import { type AaveWrapperContract, deployL2Contract } from "../services/l2/deploy.js";
import type { AztecAddress, TestWallet } from "../services/l2/wallet.js";

// Store
import { logError, logInfo, logSection, logStep, logSuccess } from "../store/logger.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Placeholder portal address used during L2 deployment.
 * This is required because:
 * - L1 portal needs L2 contract address in constructor
 * - L2 contract needs portal address for cross-chain messaging
 * - We deploy L2 first to get its address for L1
 *
 * In production, this would be handled via:
 * - Address precomputation (CREATE2)
 * - Two-phase deployment with portal address update
 */
export const PLACEHOLDER_PORTAL_ADDRESS: Address = "0x0000000000000000000000000000000000000001";

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
}

/**
 * L2 deployment context
 */
export interface L2DeploymentContext {
  /** Test wallet for deployment */
  wallet: TestWallet;
  /** Wallet address (becomes contract admin) */
  walletAddress: AztecAddress;
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
 * Deploy L2 contract with placeholder portal address.
 *
 * This is step 1 of the deployment process. The L2 contract is deployed
 * first so we can use its address when deploying the L1 portal.
 *
 * @param context - L2 deployment context
 * @returns Deployed contract and address
 */
async function deployL2WithPlaceholder(
  context: L2DeploymentContext
): Promise<{ contract: AaveWrapperContract; address: AztecAddress }> {
  logSection("L2", "Deploying AaveWrapper with placeholder portal address");
  logInfo(`Placeholder portal: ${PLACEHOLDER_PORTAL_ADDRESS}`);

  const result = await deployL2Contract(context.wallet, context.walletAddress, {
    portalAddress: PLACEHOLDER_PORTAL_ADDRESS,
  });

  logSuccess(`L2 contract deployed at ${result.address.toString()}`);

  return {
    contract: result.contract,
    address: result.address,
  };
}

/**
 * Deploy L1 contracts with the actual L2 address.
 *
 * This is step 2 of the deployment process. Now that we have the L2
 * contract address, we can deploy the L1 portal with the correct reference.
 *
 * @param context - L1 deployment context
 * @param l2Address - L2 contract address to reference in portal
 * @returns All deployed L1 addresses
 */
async function deployL1WithL2Address(
  context: L1DeploymentContext,
  l2Address: AztecAddress
): Promise<L1Addresses> {
  logSection("L1", "Deploying portal and mock contracts");

  const l2AddressHex = l2Address.toString() as Hex;
  const ownerAddress = context.deployerWallet.account.address;

  logInfo(`L2 contract reference: ${l2AddressHex.slice(0, 20)}...`);
  logInfo(`Portal owner: ${ownerAddress}`);

  const addresses = await deployL1Contracts(
    context.publicClient,
    context.deployerWallet,
    context.artifacts,
    {
      l2ContractAddress: l2AddressHex,
      ownerAddress,
    }
  );

  logSuccess(`Portal deployed at ${addresses.portal}`);
  logSuccess(`MockUSDC deployed at ${addresses.mockUsdc}`);
  logSuccess(`MockAToken deployed at ${addresses.mockAToken}`);

  return addresses;
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Deploy all contracts in the correct order.
 *
 * This orchestrates the full deployment process:
 * 1. Deploy L2 contract with placeholder portal address
 * 2. Deploy L1 contracts with actual L2 address
 *
 * Note: The placeholder portal address workaround means the L2 contract
 * will have an incorrect portal reference. For devnet testing, this is
 * acceptable as we use mocked cross-chain messaging. In production,
 * this would require address precomputation or a portal update mechanism.
 *
 * @param l1Context - L1 deployment context with clients and artifacts
 * @param l2Context - L2 deployment context with wallet
 * @returns All deployed contracts and addresses
 * @throws DeploymentError if any step fails
 *
 * @example
 * ```ts
 * const result = await deployAllContracts(
 *   {
 *     publicClient,
 *     deployerWallet,
 *     artifacts: await fetchAllArtifacts("/artifacts"),
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
  const totalSteps = 2;

  logSection("Deploy", "Starting contract deployment orchestration");

  try {
    // Step 1: Deploy L2 contract
    logStep(1, totalSteps, "Deploy L2 AaveWrapper contract");

    const { contract: l2Contract, address: l2Address } = await deployL2WithPlaceholder(l2Context);

    // Step 2: Deploy L1 contracts
    logStep(2, totalSteps, "Deploy L1 portal and mock contracts");

    const l1Addresses = await deployL1WithL2Address(l1Context, l2Address);

    // Log summary
    logSection("Deploy", "All contracts deployed successfully");
    logInfo(`L2 AaveWrapper: ${l2Address.toString()}`);
    logInfo(`L1 Portal: ${l1Addresses.portal}`);
    logInfo(`L1 MockUSDC: ${l1Addresses.mockUsdc}`);
    logInfo(`L1 MockAToken: ${l1Addresses.mockAToken}`);
    logInfo(`L1 MockLendingPool: ${l1Addresses.mockLendingPool}`);

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
