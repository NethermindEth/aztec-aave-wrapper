/**
 * Secret Management Service
 *
 * Provides secure storage and retrieval of deposit secrets used for position finalization.
 * Secrets are encrypted before storage in localStorage to prevent plaintext exposure.
 *
 * Security considerations:
 * - Secrets are encrypted using a derived key from the user's L2 address
 * - Stored data is base64-encoded ciphertext
 * - Each secret is associated with an intent ID for lookup
 *
 * NOTE: This is browser-based encryption suitable for MVP/devnet use.
 * For production, consider hardware wallet signing or more robust key management.
 */

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for encrypted secrets */
const SECRETS_STORAGE_KEY = "aztec-aave-secrets";

/** Encryption algorithm for secret storage */
const ENCRYPTION_ALGORITHM = "AES-GCM";

/** IV length in bytes */
const IV_LENGTH = 12;

// =============================================================================
// Types
// =============================================================================

/**
 * Stored secret entry (encrypted format)
 */
interface StoredSecret {
  /** Intent ID this secret belongs to */
  intentId: string;
  /** Encrypted secret value (base64) */
  encryptedSecret: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Timestamp when secret was stored */
  storedAt: number;
}

/**
 * Secret entry with decrypted value
 */
export interface SecretEntry {
  /** Intent ID this secret belongs to */
  intentId: string;
  /** Secret value as hex string */
  secretHex: string;
  /** Timestamp when secret was stored */
  storedAt: number;
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Derive an encryption key from a seed string.
 * Uses PBKDF2 with a fixed salt for deterministic key derivation.
 *
 * @param seed - Seed string (e.g., L2 address hex)
 * @returns CryptoKey for AES-GCM encryption
 */
async function deriveKey(seed: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(seed),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Use a fixed salt - the security comes from the seed (user's L2 address)
  const salt = encoder.encode("aztec-aave-wrapper-secrets-v1");

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ENCRYPTION_ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// =============================================================================
// Encryption/Decryption
// =============================================================================

/**
 * Encrypt a secret value.
 *
 * @param secretHex - Secret value as hex string
 * @param key - Encryption key
 * @returns Object containing encrypted data and IV (both base64)
 */
async function encryptSecret(
  secretHex: string,
  key: CryptoKey
): Promise<{ encryptedSecret: string; iv: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secretHex);

  // Generate random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    data
  );

  return {
    encryptedSecret: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypt a secret value.
 *
 * @param encryptedSecret - Encrypted data (base64)
 * @param iv - Initialization vector (base64)
 * @param key - Encryption key
 * @returns Decrypted secret as hex string
 */
async function decryptSecret(
  encryptedSecret: string,
  iv: string,
  key: CryptoKey
): Promise<string> {
  const encryptedData = base64ToArrayBuffer(encryptedSecret);
  const ivData = base64ToArrayBuffer(iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: ivData },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// =============================================================================
// Base64 Utilities
// =============================================================================

/**
 * Convert ArrayBuffer or Uint8Array to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// =============================================================================
// Storage Operations
// =============================================================================

/**
 * Load stored secrets from localStorage (encrypted format).
 *
 * @returns Array of stored secrets
 */
function loadStoredSecrets(): StoredSecret[] {
  try {
    const stored = localStorage.getItem(SECRETS_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as StoredSecret[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (s) =>
        typeof s.intentId === "string" &&
        typeof s.encryptedSecret === "string" &&
        typeof s.iv === "string" &&
        typeof s.storedAt === "number"
    );
  } catch {
    return [];
  }
}

/**
 * Save secrets to localStorage.
 *
 * @param secrets - Array of stored secrets to save
 */
function saveStoredSecrets(secrets: StoredSecret[]): void {
  try {
    localStorage.setItem(SECRETS_STORAGE_KEY, JSON.stringify(secrets));
  } catch {
    console.warn("Failed to persist secrets to localStorage");
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Store a deposit secret for later retrieval during withdrawal.
 *
 * The secret is encrypted using a key derived from the user's L2 address,
 * ensuring only the same user can decrypt it.
 *
 * @param intentId - The intent ID associated with this secret
 * @param secretHex - The secret value as hex string (Fr.toString())
 * @param l2AddressHex - The user's L2 address as hex string (for key derivation)
 * @throws Error if any parameter is empty
 *
 * @example
 * ```ts
 * // After successful deposit
 * await storeSecret(
 *   depositResult.intentId,
 *   depositResult.secret.toString(),
 *   wallet.address.toString()
 * );
 * ```
 */
export async function storeSecret(
  intentId: string,
  secretHex: string,
  l2AddressHex: string
): Promise<void> {
  // Validate inputs to prevent storing invalid data
  if (!intentId || intentId.trim() === "") {
    throw new Error("storeSecret: intentId is required");
  }
  if (!secretHex || secretHex.trim() === "") {
    throw new Error("storeSecret: secretHex is required");
  }
  if (!l2AddressHex || l2AddressHex.trim() === "") {
    throw new Error("storeSecret: l2AddressHex is required");
  }

  const key = await deriveKey(l2AddressHex);
  const { encryptedSecret, iv } = await encryptSecret(secretHex, key);

  const secrets = loadStoredSecrets();

  // Remove any existing secret for this intent (prevents duplicates)
  const filtered = secrets.filter((s) => s.intentId !== intentId);

  // Add new secret
  filtered.push({
    intentId,
    encryptedSecret,
    iv,
    storedAt: Date.now(),
  });

  saveStoredSecrets(filtered);
}

/**
 * Retrieve a stored secret for withdrawal finalization.
 *
 * @param intentId - The intent ID to look up
 * @param l2AddressHex - The user's L2 address as hex string (for key derivation)
 * @returns The decrypted secret entry, or null if not found or if parameters are invalid
 *
 * @example
 * ```ts
 * const secretEntry = await getSecret(position.intentId, wallet.address.toString());
 * if (secretEntry) {
 *   const secretFr = await hexToFr(secretEntry.secretHex);
 *   // Use secretFr for withdrawal finalization
 * }
 * ```
 */
export async function getSecret(
  intentId: string,
  l2AddressHex: string
): Promise<SecretEntry | null> {
  // Validate inputs - return null for invalid parameters instead of throwing
  if (!intentId || intentId.trim() === "" || !l2AddressHex || l2AddressHex.trim() === "") {
    return null;
  }

  const secrets = loadStoredSecrets();
  const stored = secrets.find((s) => s.intentId === intentId);

  if (!stored) {
    return null;
  }

  try {
    const key = await deriveKey(l2AddressHex);
    const secretHex = await decryptSecret(stored.encryptedSecret, stored.iv, key);

    return {
      intentId: stored.intentId,
      secretHex,
      storedAt: stored.storedAt,
    };
  } catch (error) {
    // Decryption failed - likely wrong key (different user) or corrupted data
    console.warn(`Failed to decrypt secret for intent ${intentId}:`, error);
    return null;
  }
}

/**
 * Check if a secret exists for a given intent ID.
 *
 * Note: This only checks existence, not decryptability.
 *
 * @param intentId - The intent ID to check
 * @returns True if a secret is stored for this intent
 */
export function hasSecret(intentId: string): boolean {
  const secrets = loadStoredSecrets();
  return secrets.some((s) => s.intentId === intentId);
}

/**
 * Remove a stored secret after successful withdrawal.
 *
 * @param intentId - The intent ID whose secret should be removed
 */
export function removeSecret(intentId: string): void {
  const secrets = loadStoredSecrets();
  const filtered = secrets.filter((s) => s.intentId !== intentId);
  saveStoredSecrets(filtered);
}

/**
 * Get all stored intent IDs (useful for debugging/UI).
 *
 * @returns Array of intent IDs with stored secrets
 */
export function getStoredIntentIds(): string[] {
  const secrets = loadStoredSecrets();
  return secrets.map((s) => s.intentId);
}

/**
 * Clear all stored secrets (use with caution).
 *
 * This is a destructive operation that removes all secrets,
 * making withdrawal finalization impossible for affected positions.
 */
export function clearAllSecrets(): void {
  try {
    localStorage.removeItem(SECRETS_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
