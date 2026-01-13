/**
 * Aztec PXE Interaction Helpers
 *
 * Provides utilities for interacting with the Aztec Private Execution Environment:
 * - Account management
 * - Contract interaction helpers
 * - Note querying and verification
 * - L1↔L2 message handling
 *
 * Usage:
 *   import { AztecHelper } from './utils/aztec';
 *   const helper = new AztecHelper(pxe);
 *   const notes = await helper.getPositionNotes(contract, owner);
 */

import type { TestConfig } from "../config";

// =============================================================================
// Type Definitions (3.0.0 SDK uses subpath exports)
// =============================================================================

type AztecNode = import("@aztec/stdlib/interfaces/client").AztecNode;
type Fr = import("@aztec/aztec.js/fields").Fr;
type AztecAddress = import("@aztec/aztec.js/addresses").AztecAddress;
type EthAddress = import("@aztec/foundation/eth-address").EthAddress;
type AccountWithSecretKey = import("@aztec/aztec.js/account").AccountWithSecretKey;
type ContractInstance = import("@aztec/aztec.js/contracts").Contract;
type Note = import("@aztec/aztec.js/note").Note;

// Backwards compatibility alias
type PXE = AztecNode;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AccountWallet = any;

/**
 * Position status values from the Noir contract
 */
export enum PositionStatus {
  PendingDeposit = 0,
  Active = 1,
  PendingWithdraw = 2,
  Consumed = 3,
}

/**
 * Parsed position receipt note
 */
export interface ParsedPositionNote {
  owner: bigint;
  nonce: bigint;
  assetId: bigint;
  shares: bigint;
  aaveMarketId: bigint;
  status: PositionStatus;
}

/**
 * Intent state from public storage
 */
export interface IntentState {
  intentId: bigint;
  status: PositionStatus;
  exists: boolean;
}

/**
 * L2→L1 message content
 */
export interface L2ToL1Message {
  recipient: string; // L1 portal address
  content: bigint[];
}

// =============================================================================
// Aztec Helper Class
// =============================================================================

/**
 * AztecHelper provides high-level utilities for Aztec interactions in tests.
 *
 * @example
 * ```ts
 * const helper = new AztecHelper(pxe);
 *
 * // Query notes
 * const notes = await helper.getPositionNotes(contract, owner);
 *
 * // Check intent status
 * const state = await helper.getIntentState(contract, intentId);
 * ```
 */
export class AztecHelper {
  private pxe: PXE;
  private aztec: {
    Fr: typeof import("@aztec/aztec.js/fields").Fr;
    AztecAddress: typeof import("@aztec/aztec.js/addresses").AztecAddress;
  } | null = null;

  constructor(pxe: PXE) {
    this.pxe = pxe;
  }

  /**
   * Initialize Aztec modules (required before use).
   */
  async initialize(): Promise<void> {
    const fieldsModule = await import("@aztec/aztec.js/fields");
    const addressesModule = await import("@aztec/aztec.js/addresses");
    this.aztec = {
      Fr: fieldsModule.Fr,
      AztecAddress: addressesModule.AztecAddress,
    };
  }

  // ===========================================================================
  // Note Querying
  // ===========================================================================

  /**
   * Get all position receipt notes for an owner.
   *
   * @param contract - AaveWrapper contract instance
   * @param owner - Owner wallet
   * @returns Array of parsed position notes
   */
  async getPositionNotes(
    contract: ContractInstance,
    owner: AccountWallet
  ): Promise<ParsedPositionNote[]> {
    // Query notes from the owner's PXE
    // The storage slot for positions is defined in the contract
    const POSITIONS_STORAGE_SLOT = 1n; // From contract storage layout

    try {
      // Get notes from the contract's private storage
      // Note: The actual implementation depends on aztec.js API version
      // Using type assertion as the PXE API varies between versions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pxeAny = this.pxe as any;
      if (!pxeAny.getNotes) {
        console.warn("PXE.getNotes not available in this aztec.js version");
        return [];
      }

      const { Fr } = await import("@aztec/aztec.js/fields");
      const notes = await pxeAny.getNotes({
        contractAddress: contract.address,
        storageSlot: Fr.fromString(POSITIONS_STORAGE_SLOT.toString()),
        owner: owner.getAddress(),
        status: 1, // Active notes only
      });

      return notes.map((note: Note) => this.parsePositionNote(note));
    } catch (error) {
      // If note querying fails, return empty array
      console.warn("Failed to query position notes:", error);
      return [];
    }
  }

  /**
   * Get a specific position note by intent ID (stored as nonce).
   *
   * The intent_id is stored as the nonce field in the PositionReceiptNote.
   *
   * @param contract - AaveWrapper contract instance
   * @param owner - Owner wallet
   * @param intentId - Intent ID to search for (matches the nonce field)
   * @returns Parsed position note or null if not found
   */
  async getPositionByIntentId(
    contract: ContractInstance,
    owner: AccountWallet,
    intentId: bigint
  ): Promise<ParsedPositionNote | null> {
    const notes = await this.getPositionNotes(contract, owner);
    return notes.find((note) => note.nonce === intentId) || null;
  }

  /**
   * Parse a raw note into a structured position receipt.
   */
  private parsePositionNote(note: Note): ParsedPositionNote {
    const items = note.items;

    if (items.length < 6) {
      throw new Error(
        `Invalid position note: expected 6 fields, got ${items.length}`
      );
    }

    return {
      owner: items[0]!.toBigInt(),
      nonce: items[1]!.toBigInt(),
      assetId: items[2]!.toBigInt(),
      shares: items[3]!.toBigInt(),
      aaveMarketId: items[4]!.toBigInt(),
      status: Number(items[5]!.toBigInt()) as PositionStatus,
    };
  }

  // ===========================================================================
  // Intent State
  // ===========================================================================

  /**
   * Get the public state of an intent from contract storage.
   *
   * @param contract - AaveWrapper contract instance
   * @param intentId - Intent ID to query
   * @returns Intent state
   */
  async getIntentState(
    contract: ContractInstance,
    intentId: bigint
  ): Promise<IntentState> {
    try {
      // Call the contract's public getter for intent status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = contract.methods as any;

      // Try to read the intent status via public function
      const status = await methods.get_intent_status(intentId).simulate();

      return {
        intentId,
        status: Number(status.toBigInt()) as PositionStatus,
        exists: true,
      };
    } catch {
      // Intent doesn't exist
      return {
        intentId,
        status: PositionStatus.PendingDeposit,
        exists: false,
      };
    }
  }

  /**
   * Check if an intent has been consumed.
   *
   * @param contract - AaveWrapper contract instance
   * @param intentId - Intent ID to check
   * @returns true if intent is consumed/finalized
   */
  async isIntentConsumed(
    contract: ContractInstance,
    intentId: bigint
  ): Promise<boolean> {
    const state = await this.getIntentState(contract, intentId);
    return state.exists && state.status === PositionStatus.Consumed;
  }

  // ===========================================================================
  // L1↔L2 Messages
  // ===========================================================================

  /**
   * Get pending L2→L1 messages from the contract.
   *
   * Note: This is a helper for testing; actual message consumption
   * happens via the L1 portal contract.
   *
   * @returns Array of pending messages
   */
  async getPendingL2ToL1Messages(): Promise<L2ToL1Message[]> {
    // L2→L1 messages are emitted as events and consumed by L1
    // In tests, we typically verify them through L1 portal calls
    // This is a placeholder for more advanced message tracking
    return [];
  }

  /**
   * Wait for an L1→L2 message to be processed.
   *
   * @param messageHash - Hash of the expected message
   * @param timeoutMs - Maximum wait time
   * @returns true if message was processed
   */
  async waitForL1ToL2Message(
    messageHash: bigint,
    timeoutMs: number = 60_000
  ): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if message has been added to the inbox
        // Implementation depends on aztec.js version
        const info = await this.pxe.getNodeInfo();
        // In a real implementation, we'd query the inbox
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch {
        // Continue polling
      }
    }

    return false;
  }

  // ===========================================================================
  // Transaction Helpers
  // ===========================================================================

  /**
   * Execute a contract method and wait for it to be mined.
   *
   * @param contract - Contract instance
   * @param methodName - Method to call
   * @param args - Method arguments
   * @returns Transaction result
   */
  async executeAndWait(
    contract: ContractInstance,
    methodName: string,
    args: unknown[]
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = contract.methods as any;
      const method = methods[methodName];

      if (!method) {
        return { success: false, error: `Method ${methodName} not found` };
      }

      const tx = await method(...args).send().wait();

      return {
        success: true,
        txHash: tx.txHash?.toString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate a contract method without sending.
   *
   * @param contract - Contract instance
   * @param methodName - Method to call
   * @param args - Method arguments
   * @returns Simulation result
   */
  async simulate(
    contract: ContractInstance,
    methodName: string,
    args: unknown[]
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = contract.methods as any;
      const method = methods[methodName];

      if (!method) {
        return { success: false, error: `Method ${methodName} not found` };
      }

      const result = await method(...args).simulate();

      return {
        success: true,
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// =============================================================================
// Standalone Utility Functions
// =============================================================================

/**
 * Generate a random secret for authorization.
 *
 * @returns Random Fr value as bigint
 */
export async function generateSecret(): Promise<bigint> {
  const { Fr } = await import("@aztec/aztec.js/fields");
  return Fr.random().toBigInt();
}

/**
 * Compute secret hash matching the Aztec protocol.
 *
 * @param secret - Secret value
 * @returns Secret hash
 */
export async function computeSecretHash(secret: bigint): Promise<bigint> {
  const { computeSecretHash: aztecComputeSecretHash } = await import(
    "@aztec/stdlib/hash"
  );
  const { Fr } = await import("@aztec/aztec.js/fields");
  // Use Fr constructor directly with bigint - fromString doesn't handle decimal strings properly
  // In 3.0.0, computeSecretHash is async
  const hash = await aztecComputeSecretHash(new Fr(secret));
  return hash.toBigInt();
}

/**
 * Compute intent ID matching the contract's computation.
 *
 * @param params - Intent parameters
 * @returns Intent ID
 */
export async function computeIntentId(params: {
  caller: bigint;
  asset: bigint;
  amount: bigint;
  originalDecimals: number;
  deadline: bigint;
  salt: bigint;
}): Promise<bigint> {
  const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");

  const hash = await poseidon2Hash([
    params.caller,
    params.asset,
    params.amount,
    BigInt(params.originalDecimals),
    params.deadline,
    params.salt,
  ]);
  return hash.toBigInt();
}

/**
 * Compute salt for intent ID generation.
 *
 * @param caller - Caller address as bigint
 * @param secretHash - Secret hash
 * @returns Salt value
 */
export async function computeSalt(
  caller: bigint,
  secretHash: bigint
): Promise<bigint> {
  const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");
  const hash = await poseidon2Hash([caller, secretHash]);
  return hash.toBigInt();
}

/**
 * Format an Aztec address for display.
 *
 * @param address - Aztec address
 * @returns Truncated hex string
 */
export function formatAddress(address: { toString(): string }): string {
  const str = address.toString();
  return `${str.slice(0, 10)}...${str.slice(-8)}`;
}

/**
 * Convert a deadline offset to absolute timestamp.
 *
 * @param offsetSeconds - Seconds from now
 * @returns Unix timestamp in seconds
 */
export function deadlineFromOffset(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Check if a deadline has passed.
 *
 * @param deadline - Deadline timestamp
 * @returns true if deadline is in the past
 */
export function isDeadlinePassed(deadline: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return deadline < now;
}
