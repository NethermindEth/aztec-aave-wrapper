/**
 * Test utility functions for Aztec Aave Wrapper E2E tests.
 *
 * This module provides reusable helpers for:
 * - Intent ID computation (matching main.nr:372-380)
 * - Secret hashing for authorization
 * - Deadline management
 * - Time advancement for testing
 * - Note field extraction from PXE
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Fr } from "@aztec/aztec.js/fields";
import type { Note } from "@aztec/aztec.js/note";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { computeSecretHash as aztecComputeSecretHash } from "@aztec/stdlib/hash";

/**
 * Compute the expected intent_id for a deposit request.
 *
 * This matches the computation in main.nr compute_intent_id:
 * ```noir
 * let intent_id = compute_intent_id(
 *     caller,
 *     asset,
 *     amount,
 *     original_decimals,
 *     deadline,
 *     salt,
 * );
 * ```
 *
 * Which internally uses:
 * ```noir
 * poseidon2_hash([
 *     caller.to_field(),
 *     asset,
 *     amount as Field,
 *     original_decimals as Field,
 *     deadline as Field,
 *     salt,
 * ])
 * ```
 *
 * @param caller - The Aztec address of the user making the request
 * @param asset - The asset ID (Field element)
 * @param amount - The deposit amount (as bigint, will be converted to Field)
 * @param originalDecimals - The original token decimals (as number, will be converted to Field)
 * @param deadline - The deadline timestamp (as bigint)
 * @param salt - The salt value (Field element)
 * @returns The computed intent_id as a Field element
 */
export async function computeExpectedIntentId(
  caller: AztecAddress,
  asset: bigint,
  amount: bigint,
  originalDecimals: number,
  deadline: bigint,
  salt: bigint
): Promise<ReturnType<typeof poseidon2Hash>> {
  // Convert AztecAddress to Field
  const callerField = caller.toBigInt();

  // Pack inputs into array for hashing
  return await poseidon2Hash([
    callerField,
    asset,
    amount,
    BigInt(originalDecimals),
    deadline,
    salt,
  ]);
}

/**
 * Compute the secret hash for authorization.
 *
 * This uses Aztec's standard computeSecretHash function which internally uses:
 * `poseidon2HashWithSeparator([secret], GeneratorIndex.SECRET_HASH)`
 *
 * This matches the secret_hash usage in main.nr where secret_hash is passed
 * to the contract and verified against the secret during finalization.
 *
 * @param secret - The secret value (Field element)
 * @returns The computed secret hash
 */
export async function computeSecretHash(
  secret: Fr
): Promise<ReturnType<typeof aztecComputeSecretHash>> {
  return await aztecComputeSecretHash(secret);
}

/**
 * Compute the salt used in intent_id generation.
 *
 * This matches main.nr:367:
 * ```noir
 * let salt = poseidon2_hash([caller.to_field(), secret_hash]);
 * ```
 *
 * @param caller - The Aztec address of the user
 * @param secretHash - The hash of the secret
 * @returns The computed salt as a Field element
 */
export async function computeSalt(
  caller: AztecAddress,
  secretHash: bigint
): Promise<ReturnType<typeof poseidon2Hash>> {
  const callerField = caller.toBigInt();
  return await poseidon2Hash([callerField, secretHash]);
}

/**
 * Compute the owner_hash used in intents.
 *
 * This matches main.nr:363:
 * ```noir
 * let owner_hash = poseidon2_hash([caller.to_field()]);
 * ```
 *
 * @param owner - The Aztec address of the owner
 * @returns The computed owner hash as a Field element
 */
export async function computeOwnerHash(
  owner: AztecAddress
): Promise<ReturnType<typeof poseidon2Hash>> {
  const ownerField = owner.toBigInt();
  return await poseidon2Hash([ownerField]);
}

/**
 * Compute a deadline timestamp from current time + offset.
 *
 * This is refactored from integration.test.ts:67.
 *
 * @param offsetSeconds - Number of seconds to add to current time
 * @returns Deadline timestamp as bigint (Unix epoch in seconds)
 */
export function computeDeadline(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Mock time advancement for deadline testing.
 *
 * Note: This is a placeholder for actual time manipulation.
 * In a real test environment, you would need to:
 * - Use anvil's evm_increaseTime for L1/target chains
 * - Use Aztec sandbox's time manipulation if available
 *
 * @param seconds - Number of seconds to advance
 * @returns Promise that resolves when time is advanced
 */
export async function advanceTime(seconds: number): Promise<void> {
  // TODO: Implement actual time advancement via anvil RPC calls
  // Example for anvil:
  // await anvilClient.send('evm_increaseTime', [seconds]);
  // await anvilClient.send('evm_mine', []);
  console.warn(`advanceTime(${seconds}s) called but not yet implemented`);
}

/**
 * Extract fields from a PositionReceiptNote returned by the PXE.
 *
 * The PositionReceiptNote structure from position_receipt.nr:
 * ```noir
 * struct PositionReceiptNote {
 *   owner: AztecAddress,
 *   nonce: Field,
 *   asset_id: Field,
 *   shares: u128,
 *   aave_market_id: Field,
 *   status: u8,
 * }
 * ```
 *
 * @param note - The note object from PXE
 * @returns Parsed note fields
 */
export interface PositionReceiptFields {
  owner: bigint;
  nonce: bigint;
  assetId: bigint;
  shares: bigint;
  aaveMarketId: bigint;
  status: number;
}

export function extractNoteFields(note: Note): PositionReceiptFields {
  // Aztec notes have their fields in the `items` array
  // The order matches the struct definition in position_receipt.nr
  const items = note.items;

  if (items.length < 6) {
    throw new Error(`Expected at least 6 fields in PositionReceiptNote, got ${items.length}`);
  }

  return {
    owner: items[0]!.toBigInt(),
    nonce: items[1]!.toBigInt(),
    assetId: items[2]!.toBigInt(),
    shares: items[3]!.toBigInt(),
    aaveMarketId: items[4]!.toBigInt(),
    status: Number(items[5]!.toBigInt()),
  };
}

/**
 * Type guard to check if a value is a valid Field element (bigint).
 *
 * @param value - The value to check
 * @returns true if value is a bigint
 */
export function isFieldElement(value: unknown): value is bigint {
  return typeof value === "bigint";
}

/**
 * Convert a Field-like value to bigint if needed.
 *
 * Handles Fr types from aztec.js that need conversion.
 *
 * @param value - The value to convert
 * @returns The value as bigint
 */
export function toFieldBigInt(value: Fr | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  // Fr has toBigInt() method
  return value.toBigInt();
}
