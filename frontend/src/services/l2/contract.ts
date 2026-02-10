/**
 * L2 Contract Service for Azguard Wallet
 *
 * Loads AaveWrapper contract with an Azguard wallet for user-initiated transactions.
 * Unlike deploy.ts which uses TestWallet for deployment, this service is designed
 * for production use with Azguard browser wallet.
 */

import { logError, logInfo, logSuccess } from "../../store/logger.js";
import { getCurrentNetwork } from "../network.js";
import type { AzguardWallet } from "../wallet/aztec.js";
import type { DevWallet } from "../wallet/devWallet.js";
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
    const { AaveWrapperContract, AaveWrapperContractArtifact } = await import(
      "@generated/AaveWrapper"
    );
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { createAztecNodeClient } = await import("@aztec/aztec.js/node");

    // Parse the contract address string
    const contractAddress = AztecAddress.fromString(contractAddressString);

    // Check if contract is registered with wallet's PXE
    logInfo("Checking if AaveWrapper is registered with wallet...");
    const contractMetadata = await wallet.getContractMetadata(contractAddress);
    let contractInstance = contractMetadata.contractInstance;

    // If not found in wallet's PXE, fetch from node directly
    if (!contractInstance) {
      logInfo("AaveWrapper not in wallet PXE, fetching from node...");
      const network = getCurrentNetwork();
      const node = createAztecNodeClient(network.l2.pxeUrl);
      const fetchedInstance = await node.getContract(contractAddress);

      if (!fetchedInstance) {
        throw new Error(
          `Contract not found at address ${contractAddressString}. Make sure contracts are deployed.`
        );
      }
      contractInstance = fetchedInstance;
    }

    // Register with wallet: instance first, then artifact
    logInfo("Registering contract artifact with wallet...");
    await wallet.registerContract(
      contractInstance,
      AaveWrapperContractArtifact as Parameters<typeof wallet.registerContract>[1]
    );

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

// =============================================================================
// Dev Wallet Contract Loading
// =============================================================================

/**
 * Load the AaveWrapper contract with a DevWallet.
 *
 * Similar to loadContractWithAzguard but uses the DevWallet's underlying
 * AccountWallet directly for Contract.at(), bypassing the Azguard extension.
 *
 * @param wallet - Connected DevWallet instance
 * @param contractAddressString - L2 address of the deployed AaveWrapper contract
 * @returns Contract instance and its address
 */
export async function loadContractWithDevWallet(
  wallet: DevWallet,
  contractAddressString: string
): Promise<ContractLoadResult> {
  logInfo(`[DevWallet] Loading AaveWrapper contract at ${contractAddressString.slice(0, 16)}...`);

  try {
    const { AaveWrapperContract, AaveWrapperContractArtifact } = await import(
      "@generated/AaveWrapper"
    );
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { createAztecNodeClient } = await import("@aztec/aztec.js/node");

    const contractAddress = AztecAddress.fromString(contractAddressString);

    // First try to get contract metadata from PXE (in case already registered)
    logInfo("[DevWallet] Checking if contract is registered with PXE...");
    const contractMetadata = await wallet.getContractMetadata(contractAddress);

    let contractInstance = contractMetadata.contractInstance;

    // If not found in PXE, fetch from node directly
    if (!contractInstance) {
      logInfo("[DevWallet] Contract not in PXE, fetching from node...");
      const network = getCurrentNetwork();
      const node = createAztecNodeClient(network.l2.pxeUrl);
      contractInstance = await node.getContract(contractAddress);

      if (!contractInstance) {
        throw new Error(
          `Contract not found at address ${contractAddressString}. Make sure contracts are deployed.`
        );
      }
    }

    // Register contract with PXE
    logInfo("[DevWallet] Registering contract artifact with PXE...");
    await wallet.registerContract(contractInstance, AaveWrapperContractArtifact);

    // Use the underlying AccountWallet for Contract.at()
    const underlyingWallet = wallet.getUnderlyingWallet();
    const contract = AaveWrapperContract.at(contractAddress, underlyingWallet);

    logSuccess(`[DevWallet] AaveWrapper contract loaded at ${contractAddress.toString()}`);

    return {
      contract,
      address: contractAddress,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error loading contract";
    logError(`[DevWallet] Failed to load AaveWrapper contract: ${errorMessage}`);
    throw error;
  }
}
