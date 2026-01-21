/**
 * L2 Position Query Service
 *
 * Queries user positions directly from the L2 Aztec contract.
 * Positions are stored as private notes encrypted for the owner.
 * Only the owner can decrypt and view their own positions.
 */

import type { PublicClient, Transport, Chain } from "viem";
import type { AzguardWallet } from "../wallet/aztec.js";
import type { AaveWrapperContract } from "./contract.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Position data returned from L2 contract
 */
export interface L2Position {
  /** Unique intent identifier (nonce field in the note) */
  intentId: string;
  /** Asset identifier */
  assetId: string;
  /** Number of shares as bigint */
  shares: bigint;
  /** Position status (0=PendingDeposit, 1=Active, 2=PendingWithdraw) */
  status: number;
  /** Aave market identifier (0 if not used) */
  aaveMarketId: string;
  /** Deadline timestamp for pending deposits (0 if not pending or already finalized) */
  deadline: bigint;
  /** Net amount for pending deposit refunds (0 if not pending or already finalized) */
  netAmount: bigint;
}

/**
 * Result of querying L2 positions
 */
export interface L2PositionsResult {
  /** Array of positions found */
  positions: L2Position[];
  /** Whether the query was successful */
  success: boolean;
  /** Error message if query failed */
  error?: string;
}

// =============================================================================
// Position Status Mapping (matches contract constants)
// =============================================================================

/**
 * Position status values from L2 contract
 * These match PositionStatus in position_receipt.nr
 */
export const L2PositionStatus = {
  PendingDeposit: 0,
  Active: 1,
  PendingWithdraw: 2,
} as const;

// =============================================================================
// Position Query Functions
// =============================================================================

/**
 * Query all positions for a user from the L2 contract.
 *
 * This calls the `get_positions` utility function on the contract,
 * which reads the user's private notes from the PXE.
 *
 * @param contract - AaveWrapper contract instance
 * @param wallet - Connected Azguard wallet
 * @param ownerAddress - L2 address of the position owner
 * @returns Array of positions
 *
 * @example
 * ```ts
 * const { wallet, address } = await connectAztecWallet();
 * const { contract } = await loadContractWithAzguard(wallet, contractAddress);
 * const result = await queryL2Positions(contract, wallet, address);
 * if (result.success) {
 *   console.log('Found positions:', result.positions);
 * }
 * ```
 */
export async function queryL2Positions(
  contract: AaveWrapperContract,
  _wallet: AzguardWallet,
  ownerAddress: string
): Promise<L2PositionsResult> {
  console.log("[queryL2Positions] Starting query for owner:", ownerAddress);
  try {
    // Import AztecAddress for type conversion
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const owner = AztecAddress.fromString(ownerAddress);
    console.log("[queryL2Positions] Calling get_positions on contract...");

    // Call the get_positions utility function
    // Utility functions are simulated (not sent as transactions)
    // Note: Pass empty options object to avoid "authWitnesses" error in SDK
    const result = await (contract.methods as any).get_positions(owner).simulate({});
    console.log("[queryL2Positions] Raw result:", result);

    // Parse the BoundedVec result into Position array
    // BoundedVec has { storage: Note[], len: number } structure
    const positions: L2Position[] = [];

    // Handle the result based on its structure
    const boundedVec = result as { storage?: unknown[]; len?: number | bigint };

    if (boundedVec?.storage && boundedVec.len !== undefined) {
      // BoundedVec structure: use len to know how many valid items
      const validCount = Number(boundedVec.len);

      for (let i = 0; i < validCount; i++) {
        const note = boundedVec.storage[i];
        if (note) {
          console.log(
            `[queryL2Positions] Raw note ${i}:`,
            JSON.stringify(note, (_, v) => (typeof v === "bigint" ? v.toString() : v))
          );
          const parsed = parsePositionNote(note);
          console.log(`[queryL2Positions] Parsed position ${i}:`, {
            intentId: parsed.intentId,
            status: parsed.status,
            shares: parsed.shares.toString(),
          });
          positions.push(parsed);
        }
      }
    } else if (Array.isArray(result)) {
      // Fallback: if it's just an array, filter out empty notes
      for (const note of result) {
        const parsed = parsePositionNote(note);
        // Skip empty notes (nonce = 0x0 means uninitialized)
        if (parsed.intentId !== "0x0" && parsed.shares > 0n) {
          positions.push(parsed);
        }
      }
    }

    // For pending deposits, fetch deadline and netAmount from public storage
    const enrichedPositions = await Promise.all(
      positions.map(async (pos) => {
        if (pos.status === L2PositionStatus.PendingDeposit) {
          const [deadline, netAmount] = await Promise.all([
            queryIntentDeadline(contract, pos.intentId),
            queryIntentNetAmount(contract, pos.intentId),
          ]);
          return { ...pos, deadline, netAmount };
        }
        return pos;
      })
    );

    console.log("[queryL2Positions] Successfully queried", enrichedPositions.length, "positions");
    return {
      positions: enrichedPositions,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error querying positions";
    console.error("[queryL2Positions] Error:", errorMessage, error);
    return {
      positions: [],
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Query the public status of an intent from L2.
 *
 * @param contract - AaveWrapper contract instance
 * @param intentId - Intent ID to query
 * @returns Intent status code
 */
export async function queryIntentStatus(
  contract: AaveWrapperContract,
  intentId: string
): Promise<number> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const intentIdField = Fr.fromString(intentId);

    const result = await (contract.methods as any).get_intent_status(intentIdField).simulate({});
    return Number(result);
  } catch (error) {
    console.warn("Failed to query intent status:", error);
    return 0; // Unknown status
  }
}

/**
 * Check if an intent has been consumed on L2.
 *
 * @param contract - AaveWrapper contract instance
 * @param intentId - Intent ID to check
 * @returns True if consumed
 */
export async function isIntentConsumed(
  contract: AaveWrapperContract,
  intentId: string
): Promise<boolean> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const intentIdField = Fr.fromString(intentId);

    const result = await (contract.methods as any).is_intent_consumed(intentIdField).simulate({});
    return Boolean(result);
  } catch (error) {
    console.warn("Failed to check intent consumed:", error);
    return false;
  }
}

/**
 * Query the deadline for a pending deposit intent.
 * This reads from the public intent_deadlines mapping.
 *
 * @param contract - AaveWrapper contract instance
 * @param intentId - Intent ID to query
 * @returns Deadline timestamp as bigint (0 if not found or not pending)
 */
export async function queryIntentDeadline(
  contract: AaveWrapperContract,
  intentId: string
): Promise<bigint> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const intentIdField = Fr.fromString(intentId);

    // Read from public storage using storageRead
    // intent_deadlines is a Map<Field, PublicMutable<u64>>
    const result = await (contract.methods as any).get_intent_deadline(intentIdField).simulate({});
    return BigInt(result);
  } catch (error) {
    // If no getter exists, deadline is not available
    console.warn("Failed to query intent deadline:", error);
    return 0n;
  }
}

/**
 * Query the net amount for a pending deposit intent.
 * This reads from the public intent_net_amounts mapping.
 *
 * @param contract - AaveWrapper contract instance
 * @param intentId - Intent ID to query
 * @returns Net amount as bigint (0 if not found or not pending)
 */
export async function queryIntentNetAmount(
  contract: AaveWrapperContract,
  intentId: string
): Promise<bigint> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const intentIdField = Fr.fromString(intentId);

    // Read from public storage using storageRead
    // intent_net_amounts is a Map<Field, PublicMutable<u128>>
    const result = await (contract.methods as any)
      .get_intent_net_amount(intentIdField)
      .simulate({});
    return BigInt(result);
  } catch (error) {
    // If no getter exists, net amount is not available
    console.warn("Failed to query intent net amount:", error);
    return 0n;
  }
}

// =============================================================================
// Pending Deposit Query (for stuck deposits recovery)
// =============================================================================

/**
 * Pending deposit info from public L2 storage.
 * This data exists even if finalize_deposit failed.
 */
export interface PendingDepositInfo {
  intentId: string;
  status: number;
  deadline: bigint;
  netAmount: bigint;
  owner: string;
  isConsumed: boolean;
  canCancel: boolean;
  timeUntilCancellable: number; // seconds, negative if already cancellable
}

/**
 * Query all public data for a pending deposit intent.
 * Use this to recover stuck deposits where finalize_deposit failed.
 *
 * @param contract - AaveWrapper contract instance
 * @param intentId - Intent ID to query
 * @param currentTimestamp - Current L1 timestamp for cancel eligibility check
 * @returns Pending deposit info or null if not found
 *
 * @example
 * ```ts
 * const info = await queryPendingDeposit(contract, "0x123...", currentL1Time);
 * if (info && info.canCancel) {
 *   console.log(`Can cancel! Net amount: ${info.netAmount}`);
 * }
 * ```
 */
export async function queryPendingDeposit(
  contract: AaveWrapperContract,
  intentId: string,
  currentTimestamp: bigint
): Promise<PendingDepositInfo | null> {
  try {
    const [status, deadline, netAmount, isConsumed] = await Promise.all([
      queryIntentStatus(contract, intentId),
      queryIntentDeadline(contract, intentId),
      queryIntentNetAmount(contract, intentId),
      isIntentConsumed(contract, intentId),
    ]);

    // Also query owner
    let owner = "";
    try {
      const { Fr } = await import("@aztec/aztec.js/fields");
      const intentIdField = Fr.fromString(intentId);
      const ownerResult = await (contract.methods as any)
        .get_intent_owner(intentIdField)
        .simulate({});
      owner = ownerResult?.toString?.() ?? "";
    } catch {
      // Owner query may fail
    }

    // Check if this looks like a valid pending deposit
    // Status 1 = PENDING_DEPOSIT
    if (status === 0 && deadline === 0n && netAmount === 0n) {
      return null; // Intent not found
    }

    const timeUntilCancellable = Number(deadline - currentTimestamp);
    const canCancel =
      status === L2PositionStatus.PendingDeposit && !isConsumed && timeUntilCancellable < 0;

    return {
      intentId,
      status,
      deadline,
      netAmount,
      owner,
      isConsumed,
      canCancel,
      timeUntilCancellable,
    };
  } catch (error) {
    console.error("Failed to query pending deposit:", error);
    return null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a PositionReceiptNote from the contract into an L2Position.
 *
 * The note structure matches PositionReceiptNote in position_receipt.nr:
 * - owner: AztecAddress
 * - nonce: Field (used as intentId)
 * - asset_id: Field
 * - shares: u128
 * - aave_market_id: Field
 * - status: u8
 */
function parsePositionNote(note: unknown): L2Position {
  // Handle different possible note structures from aztec.js
  const noteObj = note as Record<string, unknown>;

  // Extract fields - they may be in different formats
  // Note: owner field exists but not used in the return type (intentId serves as identifier)
  const nonce = noteObj.nonce;
  const assetId = noteObj.asset_id ?? noteObj.assetId;
  const shares = noteObj.shares;
  const aaveMarketId = noteObj.aave_market_id ?? noteObj.aaveMarketId;
  const status = noteObj.status;

  // Convert to standard format
  // Note: deadline and netAmount are not in the note - they're in public storage
  // and will be populated separately for pending deposits
  return {
    intentId: fieldToHexString(nonce),
    assetId: fieldToHexString(assetId),
    shares: fieldToBigInt(shares),
    status: Number(fieldToBigInt(status)),
    aaveMarketId: fieldToHexString(aaveMarketId),
    deadline: 0n,
    netAmount: 0n,
  };
}

/**
 * Convert a field value to hex string.
 */
function fieldToHexString(value: unknown): string {
  if (!value) return "0x0";

  // Handle Fr objects
  if (typeof value === "object" && value !== null) {
    const obj = value as { toString?: () => string; toBigInt?: () => bigint };
    if (typeof obj.toString === "function") {
      return obj.toString();
    }
    if (typeof obj.toBigInt === "function") {
      return `0x${obj.toBigInt().toString(16)}`;
    }
  }

  // Handle bigint
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`;
  }

  // Handle string
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : `0x${value}`;
  }

  // Handle number
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }

  return "0x0";
}

/**
 * Convert a field value to bigint.
 */
function fieldToBigInt(value: unknown): bigint {
  if (!value) return 0n;

  // Handle Fr objects
  if (typeof value === "object" && value !== null) {
    const obj = value as { toBigInt?: () => bigint };
    if (typeof obj.toBigInt === "function") {
      return obj.toBigInt();
    }
  }

  // Handle bigint
  if (typeof value === "bigint") {
    return value;
  }

  // Handle string
  if (typeof value === "string") {
    return BigInt(value);
  }

  // Handle number
  if (typeof value === "number") {
    return BigInt(value);
  }

  return 0n;
}

// =============================================================================
// Intent Scanner - Find user's pending deposits from L1 events
// =============================================================================

/**
 * ABI for DepositExecuted event from AztecAavePortalL1
 */
const DEPOSIT_EXECUTED_ABI = [
  {
    type: "event",
    name: "DepositExecuted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * Found intent from scanning
 */
export interface FoundIntent {
  intentId: string;
  asset: string;
  amount: bigint;
  shares: bigint;
  blockNumber: bigint;
}

/**
 * Result of scanning for user intents
 */
export interface ScanIntentsResult {
  /** Intents found that belong to the user */
  intents: FoundIntent[];
  /** Total events scanned */
  totalScanned: number;
  /** Whether scan was successful */
  success: boolean;
  /** Error message if scan failed */
  error?: string;
}

/**
 * Scan L1 events to find deposit intents that belong to a specific user.
 *
 * This function:
 * 1. Queries DepositExecuted events from the L1 portal contract
 * 2. For each intent, queries L2 to check if the owner matches the user
 * 3. Returns intents that belong to the user
 *
 * @param publicClient - L1 public client
 * @param portalAddress - L1 portal contract address
 * @param contract - L2 AaveWrapper contract
 * @param userL2Address - User's L2 address to match against
 * @param fromBlock - Block to start scanning from (default: last 10000 blocks)
 * @returns Found intents belonging to the user
 *
 * @example
 * ```ts
 * const result = await scanUserIntentsFromL1(
 *   publicClient,
 *   portalAddress,
 *   contract,
 *   userL2Address
 * );
 * console.log('Found intents:', result.intents);
 * ```
 */
export async function scanUserIntentsFromL1(
  publicClient: PublicClient<Transport, Chain>,
  portalAddress: `0x${string}`,
  contract: AaveWrapperContract,
  userL2Address: string,
  fromBlock?: bigint
): Promise<ScanIntentsResult> {
  console.log("[scanUserIntentsFromL1] Starting scan for user:", userL2Address);
  console.log("[scanUserIntentsFromL1] Portal address:", portalAddress);

  try {
    // Get current block number
    const currentBlock = await publicClient.getBlockNumber();
    const startBlock = fromBlock ?? (currentBlock > 10000n ? currentBlock - 10000n : 0n);

    console.log(`[scanUserIntentsFromL1] Scanning blocks ${startBlock} to ${currentBlock}`);

    // Query DepositExecuted events
    const logs = await publicClient.getLogs({
      address: portalAddress,
      event: DEPOSIT_EXECUTED_ABI[0],
      fromBlock: startBlock,
      toBlock: currentBlock,
    });

    console.log(`[scanUserIntentsFromL1] Found ${logs.length} DepositExecuted events`);

    const foundIntents: FoundIntent[] = [];

    // Check each intent's owner on L2
    for (const log of logs) {
      const intentId = log.args.intentId;
      if (!intentId) continue;

      console.log(`[scanUserIntentsFromL1] Checking intent: ${intentId}`);

      try {
        // Query the owner from L2
        const { Fr } = await import("@aztec/aztec.js/fields");
        const intentIdField = Fr.fromString(intentId);

        const ownerResult = await (contract.methods as any)
          .get_intent_owner(intentIdField)
          .simulate({});

        const ownerStr = ownerResult?.toString?.() ?? "";
        console.log(
          `[scanUserIntentsFromL1] Intent ${intentId.slice(0, 10)}... owner: ${ownerStr.slice(0, 20)}...`
        );

        // Check if owner matches user
        if (ownerStr.toLowerCase() === userL2Address.toLowerCase()) {
          console.log(`[scanUserIntentsFromL1] MATCH! Intent belongs to user`);
          foundIntents.push({
            intentId,
            asset: log.args.asset ?? "",
            amount: log.args.amount ?? 0n,
            shares: log.args.shares ?? 0n,
            blockNumber: log.blockNumber,
          });
        }
      } catch (error) {
        // Intent might not exist on L2 or query failed
        console.warn(`[scanUserIntentsFromL1] Failed to query owner for ${intentId}:`, error);
      }
    }

    console.log(`[scanUserIntentsFromL1] Found ${foundIntents.length} intents belonging to user`);

    return {
      intents: foundIntents,
      totalScanned: logs.length,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error scanning intents";
    console.error("[scanUserIntentsFromL1] Error:", errorMessage);
    return {
      intents: [],
      totalScanned: 0,
      success: false,
      error: errorMessage,
    };
  }
}
