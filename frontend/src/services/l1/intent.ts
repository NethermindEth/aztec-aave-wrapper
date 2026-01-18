/**
 * Intent Hash Computation Service
 *
 * Computes intent hashes matching Solidity IntentLib encoding.
 * These hashes are used for L2→L1 message verification via the Aztec outbox.
 *
 * Matches the pattern from e2e/scripts/full-flow.ts:501-533.
 */

import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";

// =============================================================================
// Types
// =============================================================================

/**
 * Deposit intent structure matching Solidity DepositIntent.
 * Must match eth/contracts/types/Intent.sol
 */
export interface DepositIntent {
  /** Unique identifier for this intent (derived from user address + nonce) */
  intentId: Hex;
  /** Hash of the L2 owner address for privacy preservation */
  ownerHash: Hex;
  /** Token address on L1 to deposit */
  asset: Address;
  /** Amount of tokens to deposit (in token's smallest unit) - uint128 */
  amount: bigint;
  /** Original token decimals - uint8 */
  originalDecimals: number;
  /** Unix timestamp after which this intent expires - uint64 */
  deadline: bigint;
  /** Random salt for intent uniqueness and replay protection */
  salt: Hex;
  /** Hash of secret for L1→L2 message consumption */
  secretHash: Hex;
}

/**
 * Withdraw intent structure matching Solidity WithdrawIntent.
 * Must match eth/contracts/types/Intent.sol
 */
export interface WithdrawIntent {
  /** Unique identifier for this intent (must match original deposit) */
  intentId: Hex;
  /** Hash of the L2 owner address for privacy preservation */
  ownerHash: Hex;
  /** Amount of aTokens/shares to withdraw - uint128 */
  amount: bigint;
  /** Unix timestamp after which this intent expires - uint64 */
  deadline: bigint;
}

// =============================================================================
// Hash Computation Functions
// =============================================================================

/**
 * Compute the hash of a DepositIntent for message verification.
 *
 * IMPORTANT: This must exactly match Solidity's IntentLib.hashDepositIntent()
 * which uses keccak256(abi.encode(...)).
 *
 * @param intent - The deposit intent to hash
 * @returns keccak256 hash of the encoded intent
 *
 * @example
 * ```ts
 * const hash = computeDepositIntentHash({
 *   intentId: "0x...",
 *   ownerHash: "0x...",
 *   asset: "0x...",
 *   amount: 1000000n,
 *   originalDecimals: 6,
 *   deadline: 1234567890n,
 *   salt: "0x...",
 * });
 * ```
 */
export function computeDepositIntentHash(intent: DepositIntent): Hex {
  // Match Solidity: keccak256(abi.encode(...))
  // abi.encode pads each value to 32 bytes (for non-dynamic types)
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, // intentId
        { type: "bytes32" }, // ownerHash
        { type: "address" }, // asset
        { type: "uint128" }, // amount
        { type: "uint8" }, // originalDecimals
        { type: "uint64" }, // deadline
        { type: "bytes32" }, // salt
        { type: "bytes32" }, // secretHash
      ],
      [
        intent.intentId,
        intent.ownerHash,
        intent.asset,
        intent.amount,
        intent.originalDecimals,
        intent.deadline,
        intent.salt,
        intent.secretHash,
      ]
    )
  );
}

/**
 * Compute the hash of a WithdrawIntent for message verification.
 *
 * IMPORTANT: This must exactly match Solidity's IntentLib.hashWithdrawIntent()
 * which uses keccak256(abi.encode(...)).
 *
 * @param intent - The withdraw intent to hash
 * @returns keccak256 hash of the encoded intent
 *
 * @example
 * ```ts
 * const hash = computeWithdrawIntentHash({
 *   intentId: "0x...",
 *   ownerHash: "0x...",
 *   amount: 1000000n,
 *   deadline: 1234567890n,
 * });
 * ```
 */
export function computeWithdrawIntentHash(intent: WithdrawIntent): Hex {
  // Match Solidity: keccak256(abi.encode(...))
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, // intentId
        { type: "bytes32" }, // ownerHash
        { type: "uint128" }, // amount
        { type: "uint64" }, // deadline
      ],
      [intent.intentId, intent.ownerHash, intent.amount, intent.deadline]
    )
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute a deadline timestamp from now.
 *
 * @param offsetSeconds - Number of seconds from now until deadline
 * @returns Unix timestamp as bigint
 *
 * @example
 * ```ts
 * // Deadline in 10 minutes
 * const deadline = deadlineFromNow(600);
 * ```
 */
export function deadlineFromNow(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Generate a random 32-byte salt for intent uniqueness.
 *
 * @returns Random bytes32 hex string
 */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

/**
 * Validate that a deadline is within acceptable bounds for L1 execution.
 *
 * The L1 portal enforces:
 * - MIN_DEADLINE: 5 minutes (to allow time for execution)
 * - MAX_DEADLINE: 24 hours (to prevent stale intents)
 *
 * @param deadline - Unix timestamp to validate
 * @returns Object with isValid and error message if invalid
 */
export function validateDeadline(deadline: bigint): {
  isValid: boolean;
  error?: string;
} {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const timeUntilDeadline = deadline > now ? deadline - now : 0n;

  const MIN_DEADLINE = 5n * 60n; // 5 minutes in seconds
  const MAX_DEADLINE = 24n * 60n * 60n; // 24 hours in seconds

  if (timeUntilDeadline < MIN_DEADLINE) {
    return {
      isValid: false,
      error: `Deadline too soon: ${timeUntilDeadline}s until deadline, minimum is ${MIN_DEADLINE}s`,
    };
  }

  if (timeUntilDeadline > MAX_DEADLINE) {
    return {
      isValid: false,
      error: `Deadline too far: ${timeUntilDeadline}s until deadline, maximum is ${MAX_DEADLINE}s`,
    };
  }

  return { isValid: true };
}
