/**
 * L2 BridgedToken Service
 *
 * Provides functions to interact with the BridgedToken contract on Aztec L2.
 * BridgedToken represents bridged assets (e.g., USDC) on L2 with private balances.
 *
 * Key operations:
 * - claim_private: Claim bridged tokens on L2 (called after L1 deposit to TokenPortal)
 * - getBalance: Get private token balance for an address
 * - transfer: Transfer tokens privately between L2 addresses
 */

import { logError, logInfo, logSuccess } from "../../store/logger.js";
import { getCurrentNetwork } from "../network.js";
import type { AzguardWallet } from "../wallet/aztec.js";
import type { DevWallet } from "../wallet/devWallet.js";
import { getSponsoredFeePaymentMethod } from "./operations.js";
import type { AztecAddress } from "./wallet.js";

// =============================================================================
// Types
// =============================================================================

/**
 * BridgedToken contract type
 * Import the actual class from the generated code for proper typing
 */
export type BridgedTokenContract = import("@generated/BridgedToken").BridgedTokenContract;

/**
 * Parameters for claiming bridged tokens on L2
 */
export interface ClaimPrivateParams {
  /** Amount to claim (in token's smallest unit, must match L1 deposit) */
  amount: bigint;
  /** Secret that hashes to the secretHash used in L1 deposit */
  secret: bigint;
  /** Index of the L1->L2 message in the message tree */
  messageLeafIndex: bigint;
}

/**
 * Result of contract loading
 */
export interface BridgedTokenLoadResult {
  /** Loaded BridgedToken contract instance */
  contract: BridgedTokenContract;
  /** L2 address of the contract */
  address: AztecAddress;
}

/**
 * Result of a claim operation
 */
export interface ClaimResult {
  /** Transaction hash */
  txHash: string;
}

/**
 * Result of a transfer operation
 */
export interface TransferResult {
  /** Transaction hash */
  txHash: string;
}

// =============================================================================
// Contract Loading
// =============================================================================

/**
 * Load the BridgedToken contract with an Azguard wallet.
 *
 * This function connects to an already-deployed BridgedToken contract using
 * the Azguard browser wallet for signing transactions.
 *
 * @param wallet - Connected Azguard wallet instance
 * @param contractAddressString - L2 address of the deployed BridgedToken contract
 * @returns Contract instance and its address
 *
 * @example
 * ```ts
 * const { wallet } = await connectAztecWallet();
 * const deployments = await fetchDeploymentAddresses();
 * const { contract, address } = await loadBridgedTokenWithAzguard(
 *   wallet,
 *   deployments.l2.bridgedToken
 * );
 *
 * // Now use contract.methods for operations
 * const balance = await contract.methods.balance_of_private(userAddress).simulate();
 * ```
 */
export async function loadBridgedTokenWithAzguard(
  wallet: AzguardWallet,
  contractAddressString: string
): Promise<BridgedTokenLoadResult> {
  logInfo(`Loading BridgedToken contract at ${contractAddressString.slice(0, 16)}...`);

  try {
    const { BridgedTokenContract, BridgedTokenContractArtifact } = await import(
      "@generated/BridgedToken"
    );
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { createAztecNodeClient } = await import("@aztec/aztec.js/node");

    const contractAddress = AztecAddress.fromString(contractAddressString);
    logInfo("Checking if BridgedToken is registered with wallet...");

    const contractMetadata = await wallet.getContractMetadata(contractAddress);
    let contractInstance = contractMetadata.contractInstance;

    // If not found in wallet's PXE, fetch from node directly
    if (!contractInstance) {
      logInfo("BridgedToken not in wallet PXE, fetching from node...");
      const network = getCurrentNetwork();
      const node = createAztecNodeClient(network.l2.pxeUrl);
      const fetchedInstance = await node.getContract(contractAddress);

      if (!fetchedInstance) {
        throw new Error(
          `BridgedToken contract not found at address ${contractAddressString}. Make sure contracts are deployed.`
        );
      }
      contractInstance = fetchedInstance;
    }

    logInfo("Registering BridgedToken contract artifact with wallet...");
    try {
      const registerPromise = wallet.registerContract(
        contractInstance,
        BridgedTokenContractArtifact as Parameters<typeof wallet.registerContract>[1]
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("registerContract timed out after 5s")), 5000)
      );
      await Promise.race([registerPromise, timeoutPromise]);
    } catch {
      // Continue anyway - contract might already be registered
    }

    const contract = BridgedTokenContract.at(
      contractAddress,
      wallet as unknown as Parameters<typeof BridgedTokenContract.at>[1]
    );

    logSuccess(`BridgedToken contract loaded at ${contractAddress.toString()}`);

    return {
      contract,
      address: contractAddress,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error loading contract";
    logError(`Failed to load BridgedToken contract: ${errorMessage}`);
    throw error;
  }
}

/**
 * Load the BridgedToken contract with a DevWallet.
 *
 * Similar to loadBridgedTokenWithAzguard but uses the DevWallet's underlying
 * AccountWallet directly for Contract.at(), bypassing the Azguard extension.
 *
 * @param wallet - Connected DevWallet instance
 * @param contractAddressString - L2 address of the deployed BridgedToken contract
 * @returns Contract instance and its address
 */
export async function loadBridgedTokenWithDevWallet(
  wallet: DevWallet,
  contractAddressString: string
): Promise<BridgedTokenLoadResult> {
  logInfo(`[DevWallet] Loading BridgedToken contract at ${contractAddressString.slice(0, 16)}...`);

  try {
    const { BridgedTokenContract, BridgedTokenContractArtifact } = await import(
      "@generated/BridgedToken"
    );
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { createAztecNodeClient } = await import("@aztec/aztec.js/node");

    const contractAddress = AztecAddress.fromString(contractAddressString);

    logInfo("[DevWallet] Checking if BridgedToken is registered with PXE...");
    const contractMetadata = await wallet.getContractMetadata(contractAddress);

    let contractInstance = contractMetadata.contractInstance;

    if (!contractInstance) {
      logInfo("[DevWallet] BridgedToken not in PXE, fetching from node...");
      const network = getCurrentNetwork();
      const node = createAztecNodeClient(network.l2.pxeUrl);
      const fetchedInstance = await node.getContract(contractAddress);

      if (!fetchedInstance) {
        throw new Error(
          `BridgedToken contract not found at address ${contractAddressString}. Make sure contracts are deployed.`
        );
      }
      contractInstance = fetchedInstance;
    }

    logInfo("[DevWallet] Registering BridgedToken contract artifact with PXE...");
    await wallet.registerContract(contractInstance, BridgedTokenContractArtifact);

    const underlyingWallet = wallet.getUnderlyingWallet();
    const contract = BridgedTokenContract.at(contractAddress, underlyingWallet);

    logSuccess(`[DevWallet] BridgedToken contract loaded at ${contractAddressString}`);

    return {
      contract,
      address: contractAddress,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error loading contract";
    logError(`[DevWallet] Failed to load BridgedToken contract: ${errorMessage}`);
    throw error;
  }
}

// =============================================================================
// Token Operations
// =============================================================================

/**
 * Claim bridged tokens on L2 by consuming the L1->L2 message.
 *
 * This function is called by users who bridged tokens from L1 via TokenPortal.
 * It consumes the L1->L2 message (proving the secret) and mints tokens to the caller.
 *
 * The secret must hash (via poseidon2) to the secretHash that was used in the
 * L1 depositToAztecPrivate call. Only the secret holder can claim the tokens.
 *
 * @param contract - BridgedToken contract instance
 * @param params - Claim parameters including amount, secret, and message index
 * @param from - Sender address (will receive the tokens)
 * @returns Transaction hash
 *
 * @example
 * ```ts
 * const { txHash } = await claimPrivate(contract, {
 *   amount: 1_000_000n, // 1 USDC (must match L1 deposit)
 *   secret: secretFromL1Deposit, // Secret used in L1 deposit
 *   messageLeafIndex: messageIndex, // From L1 deposit event
 * }, userAddress);
 * ```
 */
export async function claimPrivate(
  contract: BridgedTokenContract,
  params: ClaimPrivateParams,
  from: AztecAddress
): Promise<ClaimResult> {
  logInfo("Claiming bridged tokens via claim_private...");
  logInfo(`  amount: ${params.amount}`);
  logInfo(`  messageLeafIndex: ${params.messageLeafIndex}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.claim_private(params.amount, params.secret, params.messageLeafIndex);
    const paymentMethod = await getSponsoredFeePaymentMethod();

    logInfo("Sending claim transaction to wallet for approval...");
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Tokens claimed, tx: ${tx.txHash?.toString()}`);

    return {
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Claim failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Get the private token balance for an address.
 *
 * This is an unconstrained (view) function that queries the user's private
 * token notes from the PXE. Only the owner can decrypt and view their balance.
 *
 * @param contract - BridgedToken contract instance
 * @param owner - Address to check balance for
 * @returns Balance in token's smallest unit (e.g., 1_000_000 = 1 USDC)
 *
 * @example
 * ```ts
 * const balance = await getBalance(contract, userAddress);
 * console.log(`Balance: ${balance / 1_000_000n} USDC`);
 * ```
 */
export async function getBalance(
  contract: BridgedTokenContract,
  owner: AztecAddress
): Promise<bigint> {
  logInfo(`Getting private balance for ${owner?.toString?.().slice(0, 16)}...`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    let balance: unknown;
    try {
      balance = await methods.balance_of_private(owner).simulate();
    } catch {
      balance = await methods.balance_of_private(owner).simulate({});
    }

    const balanceStr =
      (balance as { toString?: () => string })?.toString?.() ?? String(balance ?? 0);
    const balanceBigInt = BigInt(balanceStr);

    logInfo(`Balance: ${balanceBigInt}`);
    return balanceBigInt;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to get balance: ${errorMessage}`);
    return 0n;
  }
}

/**
 * Transfer tokens privately to another L2 address.
 *
 * This function transfers tokens from the caller's private balance to another
 * L2 address. The entire transfer is private - no public state is modified.
 *
 * @param contract - BridgedToken contract instance
 * @param to - Recipient's L2 address
 * @param amount - Amount to transfer
 * @param from - Sender address (must own the tokens)
 * @returns Transaction hash
 *
 * @example
 * ```ts
 * const { txHash } = await transfer(
 *   contract,
 *   recipientAddress,
 *   1_000_000n, // 1 USDC
 *   senderAddress
 * );
 * ```
 */
export async function transfer(
  contract: BridgedTokenContract,
  to: AztecAddress,
  amount: bigint,
  from: AztecAddress
): Promise<TransferResult> {
  logInfo("Transferring tokens privately...");
  logInfo(`  to: ${to?.toString?.() ?? to}`);
  logInfo(`  amount: ${amount}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    const call = methods.transfer(to, amount);

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction
    logInfo("Sending transfer transaction to wallet for approval...");
    const tx = await call.send({ from, fee: { paymentMethod } }).wait();

    logSuccess(`Transfer complete, tx: ${tx.txHash?.toString()}`);

    return {
      txHash: tx.txHash?.toString() ?? "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Transfer failed: ${errorMessage}`);
    throw error;
  }
}

// =============================================================================
// Token Metadata
// =============================================================================

/**
 * Get the token name.
 *
 * @param contract - BridgedToken contract instance
 * @returns Token name as a string
 */
export async function getName(contract: BridgedTokenContract): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    const nameField = await methods.name().simulate();
    // Name is stored as a Field (BigInt representation of short string)
    return fieldToString(BigInt(nameField?.toString?.() ?? nameField ?? 0));
  } catch (error) {
    logError(`Failed to get token name: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

/**
 * Get the token symbol.
 *
 * @param contract - BridgedToken contract instance
 * @returns Token symbol as a string
 */
export async function getSymbol(contract: BridgedTokenContract): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    const symbolField = await methods.symbol().simulate();
    // Symbol is stored as a Field (BigInt representation of short string)
    return fieldToString(BigInt(symbolField?.toString?.() ?? symbolField ?? 0));
  } catch (error) {
    logError(
      `Failed to get token symbol: ${error instanceof Error ? error.message : String(error)}`
    );
    return "";
  }
}

/**
 * Get the token decimals.
 *
 * @param contract - BridgedToken contract instance
 * @returns Number of decimals (e.g., 6 for USDC)
 */
export async function getDecimals(contract: BridgedTokenContract): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    const decimals = await methods.decimals().simulate();
    return Number(decimals?.toString?.() ?? decimals ?? 0);
  } catch (error) {
    logError(
      `Failed to get token decimals: ${error instanceof Error ? error.message : String(error)}`
    );
    return 0;
  }
}

/**
 * Get the total supply of the token.
 *
 * @param contract - BridgedToken contract instance
 * @returns Total supply in token's smallest unit
 */
export async function getTotalSupply(contract: BridgedTokenContract): Promise<bigint> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    const totalSupply = await methods.total_supply().simulate();
    return BigInt(totalSupply?.toString?.() ?? totalSupply ?? 0);
  } catch (error) {
    logError(
      `Failed to get total supply: ${error instanceof Error ? error.message : String(error)}`
    );
    return 0n;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert a Field (BigInt) to a string.
 * Fields store short strings as their UTF-8 byte representation as a BigInt.
 *
 * @param field - Field value as BigInt
 * @returns Decoded string
 */
function fieldToString(field: bigint): string {
  if (field === 0n) return "";

  const bytes: number[] = [];
  let remaining = field;

  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0xffn));
    remaining >>= 8n;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Generate a random Fr value for note randomness.
 *
 * @returns Random Fr value
 *
 * @example
 * ```ts
 * const randomness = await generateRandomness();
 * await claimPrivate(contract, { to, amount, randomness }, from);
 * ```
 */
export async function generateRandomness(): Promise<unknown> {
  const { Fr } = await import("@aztec/aztec.js/fields");
  return Fr.random();
}
