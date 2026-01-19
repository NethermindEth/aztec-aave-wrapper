/**
 * L2 Position Query Service
 *
 * Queries user positions directly from the L2 Aztec contract.
 * Positions are stored as private notes encrypted for the owner.
 * Only the owner can decrypt and view their own positions.
 */

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
  try {
    // Import AztecAddress for type conversion
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const owner = AztecAddress.fromString(ownerAddress);

    // Call the get_positions utility function
    // Utility functions are simulated (not sent as transactions)
    // Note: Pass empty options object to avoid "authWitnesses" error in SDK
    const result = await (contract.methods as any).get_positions(owner).simulate({});

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
          positions.push(parsePositionNote(note));
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

    return {
      positions: enrichedPositions,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error querying positions";
    console.warn("Failed to query L2 positions:", errorMessage);
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
    const result = await (contract.methods as any).get_intent_net_amount(intentIdField).simulate({});
    return BigInt(result);
  } catch (error) {
    // If no getter exists, net amount is not available
    console.warn("Failed to query intent net amount:", error);
    return 0n;
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
