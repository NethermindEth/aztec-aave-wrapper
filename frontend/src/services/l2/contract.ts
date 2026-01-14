/**
 * L2 Contract Service for Azguard Wallet
 *
 * Loads AaveWrapper contract with an Azguard wallet for user-initiated transactions.
 * Unlike deploy.ts which uses TestWallet for deployment, this service is designed
 * for production use with Azguard browser wallet.
 */

import { logError, logInfo, logSuccess } from "../../store/logger.js";
import type { AzguardWallet } from "../wallet/aztec.js";
import type { AaveWrapperContract } from "./deploy.js";
import type { AztecAddress } from "./wallet.js";

// Re-export types for convenience
export type { AaveWrapperContract, AztecAddress };

/**
 * Result of loading the contract with Azguard wallet
 */
export interface ContractLoadResult {
  /** Loaded AaveWrapper contract instance */
  contract: AaveWrapperContract;
  /** L2 address of the contract */
  address: AztecAddress;
}

// =============================================================================
// Contract Loading
// =============================================================================

/**
 * Load the AaveWrapper contract with an Azguard wallet.
 *
 * This function connects to an already-deployed AaveWrapper contract using
 * the Azguard browser wallet for signing transactions. It's the production
 * equivalent of loadL2Contract in deploy.ts.
 *
 * @param wallet - Connected Azguard wallet instance
 * @param contractAddressString - L2 address of the deployed AaveWrapper contract
 * @returns Contract instance and its address
 *
 * @example
 * ```ts
 * const { wallet } = await connectAztecWallet();
 * const deployments = await fetchDeploymentAddresses();
 * const { contract, address } = await loadContractWithAzguard(
 *   wallet,
 *   deployments.l2.aaveWrapper
 * );
 *
 * // Now use contract.methods for operations
 * const intentId = await contract.methods.request_deposit(...).simulate({ from: userAddress });
 * ```
 */
export async function loadContractWithAzguard(
  wallet: AzguardWallet,
  contractAddressString: string
): Promise<ContractLoadResult> {
  logInfo(`Loading AaveWrapper contract at ${contractAddressString.slice(0, 16)}...`);

  try {
    // Dynamically import the generated contract and AztecAddress
    const { AaveWrapperContract } = await import("@generated/AaveWrapper");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");

    // Parse the contract address string
    const contractAddress = AztecAddress.fromString(contractAddressString);

    // Load the contract with Azguard wallet.
    // Note: We use `as unknown as` cast because AzguardWallet from @azguardwallet/aztec-wallet
    // implements the Wallet interface but TypeScript cannot verify structural compatibility
    // between the external wallet type and the SDK's Wallet type at compile time.
    const contract = AaveWrapperContract.at(
      contractAddress,
      wallet as unknown as Parameters<typeof AaveWrapperContract.at>[1]
    );

    logSuccess(`AaveWrapper contract loaded at ${contractAddress.toString()}`);

    return {
      contract,
      address: contractAddress,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error loading contract";
    logError(`Failed to load AaveWrapper contract: ${errorMessage}`);
    throw error;
  }
}

// =============================================================================
// Artifact Utilities
// =============================================================================

/**
 * Get the AaveWrapper contract artifact.
 *
 * Useful for inspecting the contract ABI or computing addresses.
 * Same as deploy.ts but exported here for convenience.
 *
 * @returns Contract artifact
 */
export async function getContractArtifact() {
  const { AaveWrapperContractArtifact } = await import("@generated/AaveWrapper");
  return AaveWrapperContractArtifact;
}
