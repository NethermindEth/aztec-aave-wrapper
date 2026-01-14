/**
 * Cryptographic Utility Functions for L2 Operations
 *
 * Provides cryptographic primitives matching Aztec protocol standards:
 * - Secret generation and hashing for L1↔L2 message authentication
 * - Owner hash computation for privacy-preserving cross-chain messages
 * - Field element conversions
 *
 * These utilities ensure compatibility with the AaveWrapper Noir contract
 * and Aztec protocol message handling.
 */

import { loadAztecModules } from "./modules.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Fr type from Aztec SDK (field element)
 */
export type Fr = InstanceType<
  Awaited<ReturnType<typeof loadAztecModules>>["Fr"]
>;

/**
 * AztecAddress type from Aztec SDK
 */
export type AztecAddress = InstanceType<
  Awaited<ReturnType<typeof loadAztecModules>>["AztecAddress"]
>;

/**
 * Secret and its hash pair for authentication
 */
export interface SecretPair {
  /** Random secret value */
  secret: Fr;
  /** Hash of the secret for commitment */
  secretHash: Fr;
}

// =============================================================================
// Secret Generation and Hashing
// =============================================================================

/**
 * Generate a random secret field element.
 *
 * Creates a cryptographically secure random value suitable for
 * L1↔L2 message authentication.
 *
 * @returns Random Fr value
 *
 * @example
 * ```ts
 * const secret = await generateSecret();
 * console.log('Secret:', secret.toString());
 * ```
 */
export async function generateSecret(): Promise<Fr> {
  const { Fr } = await loadAztecModules();
  return Fr.random();
}

/**
 * Generate a secret and its hash for authentication.
 *
 * The secret is kept private by the user, while the secretHash
 * is included in L2→L1 messages. During finalization, the user
 * reveals the secret to prove authorization.
 *
 * @returns Object containing secret and secretHash
 *
 * @example
 * ```ts
 * const { secret, secretHash } = await generateSecretPair();
 * // Use secretHash in request_deposit
 * // Use secret in finalize_deposit
 * ```
 */
export async function generateSecretPair(): Promise<SecretPair> {
  const { Fr, computeSecretHash } = await loadAztecModules();

  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);

  return { secret, secretHash };
}

/**
 * Compute the hash of a secret value.
 *
 * Uses Aztec's standard computeSecretHash function which internally uses:
 * `poseidon2HashWithSeparator([secret], GeneratorIndex.SECRET_HASH)`
 *
 * This matches the secret_hash verification in the Noir contract.
 *
 * @param secret - The secret value (Fr or bigint)
 * @returns The computed secret hash as Fr
 *
 * @example
 * ```ts
 * const secret = await generateSecret();
 * const hash = await computeSecretHashFromValue(secret);
 * ```
 */
export async function computeSecretHashFromValue(
  secret: Fr | bigint
): Promise<Fr> {
  const { Fr, computeSecretHash } = await loadAztecModules();

  const secretFr = typeof secret === "bigint" ? new Fr(secret) : secret;
  return computeSecretHash(secretFr);
}

// =============================================================================
// Owner Hash Computation
// =============================================================================

/**
 * Compute the owner hash for privacy-preserving cross-chain messages.
 *
 * This matches main.nr:363:
 * ```noir
 * let owner_hash = poseidon2_hash([caller.to_field()]);
 * ```
 *
 * The owner_hash is used instead of the raw L2 address in L2→L1 messages,
 * ensuring the user's identity is never revealed on L1.
 *
 * @param owner - The Aztec address of the owner
 * @returns The computed owner hash as Fr
 *
 * @example
 * ```ts
 * const ownerHash = await computeOwnerHash(userAddress);
 * // ownerHash can be safely included in L1 transactions
 * ```
 */
export async function computeOwnerHash(owner: AztecAddress): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();
  return poseidon2Hash([owner.toBigInt()]);
}

/**
 * Compute owner hash from a bigint representation of an address.
 *
 * Useful when working with raw field values rather than AztecAddress objects.
 *
 * @param ownerBigInt - The owner address as bigint
 * @returns The computed owner hash as Fr
 *
 * @example
 * ```ts
 * const ownerBigInt = userAddress.toBigInt();
 * const ownerHash = await computeOwnerHashFromBigInt(ownerBigInt);
 * ```
 */
export async function computeOwnerHashFromBigInt(
  ownerBigInt: bigint
): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();
  return poseidon2Hash([ownerBigInt]);
}

// =============================================================================
// Salt Computation
// =============================================================================

/**
 * Compute the salt used in intent_id generation.
 *
 * This matches main.nr:367:
 * ```noir
 * let salt = poseidon2_hash([caller.to_field(), secret_hash]);
 * ```
 *
 * The salt binds the intent to both the caller and their secret,
 * preventing intent spoofing while maintaining privacy.
 *
 * @param caller - The Aztec address of the caller
 * @param secretHash - The hash of the secret (Fr or bigint)
 * @returns The computed salt as Fr
 *
 * @example
 * ```ts
 * const { secretHash } = await generateSecretPair();
 * const salt = await computeSalt(userAddress, secretHash);
 * ```
 */
export async function computeSalt(
  caller: AztecAddress,
  secretHash: Fr | bigint
): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();

  const callerField = caller.toBigInt();
  const secretHashBigInt =
    typeof secretHash === "bigint" ? secretHash : secretHash.toBigInt();

  return poseidon2Hash([callerField, secretHashBigInt]);
}

// =============================================================================
// Intent ID Computation
// =============================================================================

/**
 * Compute the expected intent_id for a deposit or withdraw request.
 *
 * This matches the computation in main.nr compute_intent_id:
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
 * Useful for predicting intent IDs before transaction submission
 * or for verification purposes.
 *
 * @param params - Intent parameters
 * @returns The computed intent_id as Fr
 *
 * @example
 * ```ts
 * const intentId = await computeIntentId({
 *   caller: userAddress,
 *   asset: 1n,
 *   amount: 1_000_000n,
 *   originalDecimals: 6,
 *   deadline: deadlineFromNow(3600),
 *   salt,
 * });
 * ```
 */
export async function computeIntentId(params: {
  caller: AztecAddress;
  asset: bigint;
  amount: bigint;
  originalDecimals: number;
  deadline: bigint;
  salt: Fr | bigint;
}): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();

  const callerField = params.caller.toBigInt();
  const saltBigInt =
    typeof params.salt === "bigint" ? params.salt : params.salt.toBigInt();

  return poseidon2Hash([
    callerField,
    params.asset,
    params.amount,
    BigInt(params.originalDecimals),
    params.deadline,
    saltBigInt,
  ]);
}

// =============================================================================
// Field Element Conversions
// =============================================================================

/**
 * Convert a Fr field element to bigint.
 *
 * @param fr - The Fr value to convert
 * @returns The value as bigint
 *
 * @example
 * ```ts
 * const secret = await generateSecret();
 * const secretBigInt = frToBigInt(secret);
 * ```
 */
export function frToBigInt(fr: Fr): bigint {
  return fr.toBigInt();
}

/**
 * Convert a bigint to Fr field element.
 *
 * @param value - The bigint value to convert
 * @returns Promise resolving to the Fr value
 *
 * @example
 * ```ts
 * const fr = await bigIntToFr(12345n);
 * ```
 */
export async function bigIntToFr(value: bigint): Promise<Fr> {
  const { Fr } = await loadAztecModules();
  return new Fr(value);
}

/**
 * Convert a hex string to Fr field element.
 *
 * @param hex - The hex string (with or without 0x prefix)
 * @returns Promise resolving to the Fr value
 *
 * @example
 * ```ts
 * const fr = await hexToFr('0x1234abcd');
 * ```
 */
export async function hexToFr(hex: string): Promise<Fr> {
  const { Fr } = await loadAztecModules();
  return Fr.fromString(hex);
}

/**
 * Convert Fr to hex string.
 *
 * @param fr - The Fr value to convert
 * @returns Hex string with 0x prefix
 *
 * @example
 * ```ts
 * const secret = await generateSecret();
 * const hex = frToHex(secret);
 * console.log(hex); // '0x...'
 * ```
 */
export function frToHex(fr: Fr): string {
  return fr.toString();
}
