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
import { getSponsoredFeePaymentMethod } from "./operations.js";
import type { AzguardWallet } from "../wallet/aztec.js";
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
  console.log("[loadBridgedTokenWithAzguard] START");

  try {
    // Dynamically import the generated contract and AztecAddress
    console.log("[loadBridgedTokenWithAzguard] Importing BridgedTokenContract...");
    const { BridgedTokenContract, BridgedTokenContractArtifact } = await import(
      "@generated/BridgedToken"
    );
    console.log("[loadBridgedTokenWithAzguard] Importing AztecAddress...");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");

    // Parse the contract address string
    console.log("[loadBridgedTokenWithAzguard] Parsing address...");
    const contractAddress = AztecAddress.fromString(contractAddressString);

    // Register the contract artifact with the wallet
    logInfo("Registering BridgedToken contract artifact with wallet...");
    console.log("[loadBridgedTokenWithAzguard] Calling getContractMetadata...");

    // Fetch the actual contract instance from the network via the wallet
    const contractMetadata = await wallet.getContractMetadata(contractAddress);
    console.log("[loadBridgedTokenWithAzguard] Got contractMetadata:", !!contractMetadata);

    if (!contractMetadata.contractInstance) {
      throw new Error(
        `BridgedToken contract not found at address ${contractAddressString}. Make sure contracts are deployed.`
      );
    }

    // Register with wallet: instance first, then artifact
    // Use a timeout to prevent hanging if the wallet is slow
    console.log("[loadBridgedTokenWithAzguard] Calling registerContract...");
    try {
      const registerPromise = wallet.registerContract(
        contractMetadata.contractInstance,
        BridgedTokenContractArtifact as Parameters<typeof wallet.registerContract>[1]
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("registerContract timed out after 5s")), 5000)
      );
      await Promise.race([registerPromise, timeoutPromise]);
      console.log("[loadBridgedTokenWithAzguard] registerContract done");
    } catch (regError) {
      // If registration fails/times out, try to continue anyway
      // The contract might already be registered from a previous operation
      console.warn("[loadBridgedTokenWithAzguard] registerContract failed/timed out:", regError);
      console.log("[loadBridgedTokenWithAzguard] Continuing without registration...");
    }

    // Load the contract with Azguard wallet
    console.log("[loadBridgedTokenWithAzguard] Creating contract instance...");
    const contract = BridgedTokenContract.at(
      contractAddress,
      wallet as unknown as Parameters<typeof BridgedTokenContract.at>[1]
    );

    logSuccess(`BridgedToken contract loaded at ${contractAddress.toString()}`);
    console.log("[loadBridgedTokenWithAzguard] SUCCESS");

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

  // Detailed debug logging
  console.log("[claimPrivate DEBUG] Parameters:");
  console.log("[claimPrivate DEBUG]   amount:", params.amount?.toString());
  console.log("[claimPrivate DEBUG]   secret (type):", typeof params.secret);
  console.log("[claimPrivate DEBUG]   secret (hex):", "0x" + params.secret?.toString(16));
  console.log("[claimPrivate DEBUG]   messageLeafIndex:", params.messageLeafIndex?.toString());
  console.log("[claimPrivate DEBUG]   from:", from?.toString());
  console.log("[claimPrivate DEBUG]   contract address (BridgedToken):", contract?.address?.toString());

  // Verify secret hash computation using the same function as bridge.ts
  try {
    const { computeSecretHashFromValue } = await import("./crypto.js");
    const computedHash = await computeSecretHashFromValue(params.secret);
    console.log("[claimPrivate DEBUG] Computed secretHash from poseidon2Hash([secret]):", computedHash.toString());
    console.log("[claimPrivate DEBUG] Expected: Should match what was sent to L1 in DepositToAztecPrivate event");
  } catch (e) {
    console.log("[claimPrivate DEBUG] Could not compute secretHash for verification:", e);
  }

  // Query the portal_address stored in BridgedToken
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;
    if (typeof methods.portal_address === "function") {
      const portalAddress = await methods.portal_address().simulate();
      console.log("[claimPrivate DEBUG] BridgedToken.portal_address():", portalAddress?.toString());
      console.log("[claimPrivate DEBUG] IMPORTANT: This must match the L1 TokenPortal address that sent the deposit!");
    } else {
      console.log("[claimPrivate DEBUG] portal_address() method not found on contract");
    }
  } catch (e) {
    console.log("[claimPrivate DEBUG] Could not query portal_address:", e);
  }

  // Compute what the content hash should be (to match L1)
  try {
    const { computeSecretHashFromValue } = await import("./crypto.js");
    const secretHash = await computeSecretHashFromValue(params.secret);

    // Replicate L2's content hash computation:
    // sha256_to_field(amount as 32 bytes || secretHash as 32 bytes)
    console.log("[claimPrivate DEBUG] Computing expected content hash...");
    console.log("[claimPrivate DEBUG]   amount for content:", params.amount?.toString());
    console.log("[claimPrivate DEBUG]   secretHash for content:", secretHash.toString());

    // Compute the exact bytes that L1 and L2 would use
    // L1: abi.encodePacked(uint256 amount, bytes32 secretHash) = 64 bytes
    const amountHex = params.amount.toString(16).padStart(64, '0');
    const secretHashHex = secretHash.toString().slice(2).padStart(64, '0'); // remove 0x prefix
    const combinedHex = amountHex + secretHashHex;
    console.log("[claimPrivate DEBUG]   amount as 32 bytes (hex):", "0x" + amountHex);
    console.log("[claimPrivate DEBUG]   secretHash as 32 bytes (hex):", "0x" + secretHashHex);
    console.log("[claimPrivate DEBUG]   combined 64 bytes (hex):", "0x" + combinedHex);

    // Compute sha256 of the combined bytes
    const combinedBytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      combinedBytes[i] = parseInt(combinedHex.slice(i * 2, i * 2 + 2), 16);
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', combinedBytes);
    const hashArray = new Uint8Array(hashBuffer);
    const sha256Hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log("[claimPrivate DEBUG]   sha256(combined):", "0x" + sha256Hex);

    // sha256ToField truncates to 31 bytes and prepends 0x00
    const sha256ToFieldHex = "00" + sha256Hex.slice(0, 62);
    console.log("[claimPrivate DEBUG]   sha256ToField (L1):", "0x" + sha256ToFieldHex);
    console.log("[claimPrivate DEBUG]   (This is the expected content hash)");
  } catch (e) {
    console.log("[claimPrivate DEBUG] Could not compute content hash preview:", e);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    console.log("[claimPrivate DEBUG] Calling claim_private with:");
    console.log("[claimPrivate DEBUG]   - amount:", params.amount);
    console.log("[claimPrivate DEBUG]   - secret:", params.secret);
    console.log("[claimPrivate DEBUG]   - messageLeafIndex:", params.messageLeafIndex);

    // Call claim_private which consumes the L1->L2 message and mints tokens
    const call = methods.claim_private(params.amount, params.secret, params.messageLeafIndex);

    // Get the sponsored fee payment method
    const paymentMethod = await getSponsoredFeePaymentMethod();

    // Execute the transaction
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
  console.log("[getBalance] Starting balance query for:", owner?.toString?.());
  console.log("[getBalance] Contract address:", contract?.address?.toString?.());

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = contract.methods as any;

    console.log("[getBalance] Calling balance_of_private...");

    // balance_of_private is an unconstrained (view) function
    // Try calling without options first, then with empty options if that fails
    let balance;
    try {
      balance = await methods.balance_of_private(owner).simulate();
    } catch (simError) {
      console.log("[getBalance] simulate() failed, trying with empty options:", simError);
      // Try with explicit empty options
      balance = await methods.balance_of_private(owner).simulate({});
    }

    console.log("[getBalance] Raw balance result:", balance);

    // Convert to bigint (result may be Fr or number)
    const balanceBigInt = BigInt(balance?.toString?.() ?? balance ?? 0);

    console.log("[getBalance] Converted balance:", balanceBigInt.toString());
    logInfo(`Balance: ${balanceBigInt}`);

    return balanceBigInt;
  } catch (error) {
    console.error("[getBalance] FAILED with error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to get balance: ${errorMessage}`);
    // Return 0 on error (common for empty/new accounts)
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
