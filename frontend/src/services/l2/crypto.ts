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
export type Fr = InstanceType<Awaited<ReturnType<typeof loadAztecModules>>["Fr"]>;

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
 * is included in L1→L2 messages. During finalization, the user
 * reveals the secret to prove authorization.
 *
 * IMPORTANT: Uses computeSecretHash which adds GeneratorIndex.SECRET_HASH
 * as a domain separator. This matches what Aztec's consume_l1_to_l2_message
 * expects when looking up messages.
 *
 * @returns Object containing secret and secretHash
 *
 * @example
 * ```ts
 * const { secret, secretHash } = await generateSecretPair();
 * // Use secretHash in depositToAztecPrivate
 * // Use secret in claim_private
 * ```
 */
export async function generateSecretPair(): Promise<SecretPair> {
  const { Fr, computeSecretHash } = await loadAztecModules();

  const secret = Fr.random();
  // Use computeSecretHash which internally does:
  // poseidon2HashWithSeparator([secret], GeneratorIndex.SECRET_HASH)
  // This equals poseidon2Hash([20, secret]) where 20 = SECRET_HASH generator index
  // This matches what Aztec's consume_l1_to_l2_message uses internally
  const secretHash = await computeSecretHash(secret);

  return { secret, secretHash };
}

/**
 * Compute the hash of a secret value.
 *
 * Uses computeSecretHash which adds GeneratorIndex.SECRET_HASH (20)
 * as a domain separator. This matches what Aztec's consume_l1_to_l2_message
 * expects when looking up L1→L2 messages.
 *
 * Internally equivalent to: poseidon2Hash([20, secret])
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
export async function computeSecretHashFromValue(secret: Fr | bigint): Promise<Fr> {
  const { Fr, computeSecretHash } = await loadAztecModules();

  // Convert bigint to Fr if needed
  const secretFr = typeof secret === "bigint" ? new Fr(secret) : secret;
  // Use computeSecretHash for consistent domain-separated hashing
  return computeSecretHash(secretFr);
}

// =============================================================================
// Owner Hash Computation
// =============================================================================

/**
 * Compute the owner hash for privacy-preserving cross-chain messages.
 *
 * This matches main.nr compute_owner_hash function:
 * ```noir
 * pub fn compute_owner_hash(owner: AztecAddress, intent_id: Field) -> Field {
 *     poseidon2_hash([owner.to_field(), intent_id])
 * }
 * ```
 *
 * The owner_hash is derived from both the owner address AND the intent_id,
 * making each intent have a unique owner_hash even for the same user.
 * This prevents L1 observers from linking multiple deposits/withdrawals
 * to the same user.
 *
 * @param owner - The Aztec address of the owner
 * @param intentId - The intent ID (unique per operation)
 * @returns The computed owner hash as Fr
 *
 * @example
 * ```ts
 * const ownerHash = await computeOwnerHash(userAddress, intentId);
 * // ownerHash is unique per intent, preserving privacy
 * ```
 */
export async function computeOwnerHash(owner: AztecAddress, intentId: bigint): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();
  return poseidon2Hash([owner.toBigInt(), intentId]);
}

/**
 * Compute owner hash from a bigint representation of an address.
 *
 * Useful when working with raw field values rather than AztecAddress objects.
 *
 * @param ownerBigInt - The owner address as bigint
 * @param intentId - The intent ID (unique per operation)
 * @returns The computed owner hash as Fr
 *
 * @example
 * ```ts
 * const ownerBigInt = userAddress.toBigInt();
 * const ownerHash = await computeOwnerHashFromBigInt(ownerBigInt, intentId);
 * ```
 */
export async function computeOwnerHashFromBigInt(
  ownerBigInt: bigint,
  intentId: bigint
): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();
  return poseidon2Hash([ownerBigInt, intentId]);
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
export async function computeSalt(caller: AztecAddress, secretHash: Fr | bigint): Promise<Fr> {
  const { poseidon2Hash } = await loadAztecModules();

  const callerField = caller.toBigInt();
  const secretHashBigInt = typeof secretHash === "bigint" ? secretHash : secretHash.toBigInt();

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
  const saltBigInt = typeof params.salt === "bigint" ? params.salt : params.salt.toBigInt();

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

// =============================================================================
// SHA256 to Field (for L1↔L2 message content hash)
// =============================================================================

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array.
 *
 * @param value - The bigint to convert
 * @returns 32-byte Uint8Array in big-endian format
 */
export function bigIntToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * Compute SHA256 and truncate to a field element.
 *
 * This matches the Aztec protocol's sha256_to_field function used in L1↔L2 messaging.
 * The SHA256 hash is truncated to fit within the field (first 31 bytes = 248 bits).
 *
 * @param data - Input data as Uint8Array
 * @returns Promise resolving to the field element as Fr
 *
 * @example
 * ```ts
 * const data = new Uint8Array([...]);
 * const field = await sha256ToField(data);
 * ```
 */
export async function sha256ToField(data: Uint8Array): Promise<Fr> {
  const { Fr } = await loadAztecModules();

  // Compute SHA-256 hash using browser crypto API
  // Cast to ArrayBuffer to satisfy TypeScript's strict type checking
  const hashBuffer = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);

  // Truncate to 31 bytes (248 bits) to fit in field element
  // This matches Aztec's sha256_to_field implementation
  const truncated = hashArray.slice(0, 31);

  // Convert to bigint (big-endian)
  let result = 0n;
  for (const byte of truncated) {
    result = (result << 8n) | BigInt(byte);
  }

  return new Fr(result);
}

/**
 * Compute the expected L1→L2 deposit confirmation message content hash.
 *
 * This matches the Noir contract's compute_deposit_confirmation_content function
 * and the L1 portal's _computeDepositFinalizationMessage function.
 *
 * Encoding: sha256_to_field([intentId (32 bytes) + assetId (32 bytes) + shares (32 bytes)])
 *
 * @param intentId - The intent ID as bigint
 * @param assetId - The asset address as bigint (L1 address zero-extended to 32 bytes)
 * @param shares - The number of aToken shares as bigint
 * @returns Promise resolving to the message content hash as Fr
 *
 * @example
 * ```ts
 * const contentHash = await computeDepositConfirmationContent(
 *   intentIdBigInt,
 *   BigInt(usdcAddress),
 *   sharesBigInt
 * );
 * ```
 */
export async function computeDepositConfirmationContent(
  intentId: bigint,
  assetId: bigint,
  shares: bigint
): Promise<Fr> {
  // Create 96-byte packed data: intentId (32) + assetId (32) + shares (32)
  const data = new Uint8Array(96);

  // Pack intentId (first 32 bytes)
  const intentBytes = bigIntToBytes32(intentId);
  data.set(intentBytes, 0);

  // Pack assetId (next 32 bytes)
  const assetBytes = bigIntToBytes32(assetId);
  data.set(assetBytes, 32);

  // Pack shares (last 32 bytes)
  const sharesBytes = bigIntToBytes32(shares);
  data.set(sharesBytes, 64);

  return sha256ToField(data);
}
