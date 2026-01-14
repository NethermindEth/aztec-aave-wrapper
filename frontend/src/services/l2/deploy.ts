/**
 * L2 Contract Deployment Service
 *
 * Deploys AaveWrapper contract to Aztec L2.
 * Matches the pattern from e2e/scripts/full-flow.ts:440-463.
 */

import { logError, logInfo, logSuccess } from "../../store/logger.js";
import type { AztecAddress, TestWallet } from "./wallet.js";

// =============================================================================
// Types
// =============================================================================

/**
 * EthAddress type from Aztec foundation
 */
export type EthAddress = InstanceType<typeof import("@aztec/foundation/eth-address").EthAddress>;

/**
 * L2 contract deployment configuration
 */
export interface L2DeploymentConfig {
  /** L1 portal contract address (Ethereum address) */
  portalAddress: string;
}

/**
 * Result of L2 contract deployment
 */
export interface L2DeploymentResult {
  /** Deployed AaveWrapper contract instance */
  contract: AaveWrapperContract;
  /** L2 address of the deployed contract */
  address: AztecAddress;
}

/**
 * AaveWrapper contract type (inferred from generated code)
 */
export type AaveWrapperContract = Awaited<
  ReturnType<
    Awaited<
      ReturnType<typeof import("@generated/AaveWrapper").AaveWrapperContract.deploy>
    >["deployed"]
  >
>;

// =============================================================================
// Contract Deployment
// =============================================================================

/**
 * Deploy the AaveWrapper L2 contract.
 *
 * This matches the e2e pattern:
 * ```ts
 * const { AaveWrapperContract } = await import("../src/generated/AaveWrapper");
 * const { EthAddress } = await import("@aztec/foundation/eth-address");
 *
 * const portalEthAddress = EthAddress.fromString(portalAddress);
 *
 * const deployedContract = await AaveWrapperContract.deploy(
 *   wallet,
 *   walletAddress,
 *   portalEthAddress
 * )
 *   .send({ from: walletAddress })
 *   .deployed();
 * ```
 *
 * @param wallet - Test wallet for deployment
 * @param walletAddress - L2 address of the wallet (becomes admin)
 * @param config - Deployment configuration with portal address
 * @returns Deployed contract and its address
 *
 * @example
 * ```ts
 * const { wallet, address } = await createTestWallet(node);
 * const { contract, address: contractAddress } = await deployL2Contract(
 *   wallet,
 *   address,
 *   { portalAddress: "0x..." }
 * );
 * console.log('Contract deployed at:', contractAddress.toString());
 * ```
 */
export async function deployL2Contract(
  wallet: TestWallet,
  walletAddress: AztecAddress,
  config: L2DeploymentConfig
): Promise<L2DeploymentResult> {
  logInfo("Deploying AaveWrapper L2 contract...");

  // Dynamically import the generated contract and EthAddress
  const { AaveWrapperContract } = await import("@generated/AaveWrapper");
  const { EthAddress } = await import("@aztec/foundation/eth-address");

  // Convert portal address string to EthAddress
  const portalEthAddress = EthAddress.fromString(config.portalAddress);

  try {
    // Deploy the contract
    const deployedContract = await AaveWrapperContract.deploy(
      wallet,
      walletAddress,
      portalEthAddress
    )
      .send({ from: walletAddress })
      .deployed();

    logSuccess(`AaveWrapper deployed at ${deployedContract.address.toString()}`);

    return {
      contract: deployedContract,
      address: deployedContract.address,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown deployment error";
    logError(`AaveWrapper deployment failed: ${errorMessage}`);
    throw error;
  }
}

// =============================================================================
// Contract Loading
// =============================================================================

/**
 * Load an existing AaveWrapper contract instance.
 *
 * Use this when the contract is already deployed and you need to interact with it.
 *
 * @param wallet - Wallet for interacting with the contract
 * @param contractAddress - L2 address of the deployed contract
 * @returns Contract instance
 *
 * @example
 * ```ts
 * const contract = await loadL2Contract(wallet, existingAddress);
 * const status = await contract.methods.get_intent_status(intentId).view();
 * ```
 */
export async function loadL2Contract(
  wallet: TestWallet,
  contractAddress: AztecAddress
): Promise<AaveWrapperContract> {
  const { AaveWrapperContract } = await import("@generated/AaveWrapper");
  return AaveWrapperContract.at(contractAddress, wallet) as AaveWrapperContract;
}

// =============================================================================
// Artifact Utilities
// =============================================================================

/**
 * Get the AaveWrapper contract artifact.
 *
 * Useful for inspecting the contract ABI or computing addresses.
 *
 * @returns Contract artifact
 */
export async function getL2ContractArtifact() {
  const { AaveWrapperContractArtifact } = await import("@generated/AaveWrapper");
  return AaveWrapperContractArtifact;
}
