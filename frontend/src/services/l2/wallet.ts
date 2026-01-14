/**
 * L2 Wallet Service
 *
 * Creates and manages test wallets for Aztec L2 operations.
 * Matches the pattern from e2e/scripts/full-flow.ts:411-434.
 */

import type { AztecNodeClient } from "./client.js";
import type { AztecModules } from "./modules.js";

// =============================================================================
// Types
// =============================================================================

/**
 * TestWallet type (inferred from dynamic import)
 */
export type TestWallet = Awaited<
  ReturnType<typeof import("@aztec/test-wallet/server").TestWallet.create>
>;

/**
 * AztecAddress type re-exported for convenience
 */
export type AztecAddress = InstanceType<AztecModules["AztecAddress"]>;

/**
 * Test wallet configuration
 */
export interface TestWalletConfig {
  /** Whether to enable the prover (default: false for faster tests) */
  proverEnabled?: boolean;
  /** Account index to use from INITIAL_TEST_* arrays (default: 0) */
  accountIndex?: number;
}

/**
 * Result of wallet creation
 */
export interface WalletSetupResult {
  /** The created TestWallet instance */
  wallet: TestWallet;
  /** The L2 address of the account */
  address: AztecAddress;
}

// =============================================================================
// Test Account Keys
// =============================================================================

/**
 * Dynamically loads test account keys from @aztec/accounts/testing.
 * These are deterministic keys used for local development and testing.
 */
async function loadTestAccountKeys() {
  const { INITIAL_TEST_SECRET_KEYS, INITIAL_TEST_SIGNING_KEYS, INITIAL_TEST_ACCOUNT_SALTS } =
    await import("@aztec/accounts/testing");

  return {
    secretKeys: INITIAL_TEST_SECRET_KEYS,
    signingKeys: INITIAL_TEST_SIGNING_KEYS,
    accountSalts: INITIAL_TEST_ACCOUNT_SALTS,
  };
}

// =============================================================================
// Wallet Creation
// =============================================================================

/**
 * Create a test wallet with a Schnorr account.
 *
 * This matches the e2e pattern:
 * ```ts
 * const { TestWallet } = await import("@aztec/test-wallet/server");
 * const wallet = await TestWallet.create(node, { proverEnabled: false });
 * const accountManager = await wallet.createSchnorrAccount(
 *   INITIAL_TEST_SECRET_KEYS[0]!,
 *   INITIAL_TEST_ACCOUNT_SALTS[0]!,
 *   INITIAL_TEST_SIGNING_KEYS[0]!
 * );
 * ```
 *
 * @param node - Connected Aztec node client
 * @param config - Optional wallet configuration
 * @returns Wallet and account address
 *
 * @example
 * ```ts
 * const node = await createL2NodeClient();
 * const { wallet, address } = await createTestWallet(node);
 * console.log('Wallet address:', address.toString());
 * ```
 */
export async function createTestWallet(
  node: AztecNodeClient,
  config?: TestWalletConfig
): Promise<WalletSetupResult> {
  const proverEnabled = config?.proverEnabled ?? false;
  const accountIndex = config?.accountIndex ?? 0;

  // Dynamically import TestWallet to support WASM dependencies
  const { TestWallet } = await import("@aztec/test-wallet/server");

  // Load test account keys
  const { secretKeys, signingKeys, accountSalts } = await loadTestAccountKeys();

  // Validate account index
  if (accountIndex < 0 || accountIndex >= secretKeys.length) {
    throw new Error(
      `Invalid account index ${accountIndex}. Must be between 0 and ${secretKeys.length - 1}`
    );
  }

  // Create wallet instance
  const wallet = await TestWallet.create(node, { proverEnabled });

  // Create Schnorr account using test keys
  const accountManager = await wallet.createSchnorrAccount(
    secretKeys[accountIndex]!,
    accountSalts[accountIndex]!,
    signingKeys[accountIndex]!
  );

  return {
    wallet,
    address: accountManager.address,
  };
}

/**
 * Create multiple test wallets for different users.
 * Useful for testing multi-party scenarios.
 *
 * @param node - Connected Aztec node client
 * @param count - Number of wallets to create (max: length of INITIAL_TEST_* arrays)
 * @param config - Optional wallet configuration (proverEnabled applies to all)
 * @returns Array of wallet setup results
 *
 * @example
 * ```ts
 * const node = await createL2NodeClient();
 * const wallets = await createMultipleTestWallets(node, 3);
 * console.log('Created wallets:', wallets.map(w => w.address.toString()));
 * ```
 */
export async function createMultipleTestWallets(
  node: AztecNodeClient,
  count: number,
  config?: Omit<TestWalletConfig, "accountIndex">
): Promise<WalletSetupResult[]> {
  const { secretKeys } = await loadTestAccountKeys();
  const maxCount = secretKeys.length;

  if (count > maxCount) {
    throw new Error(`Cannot create ${count} wallets. Maximum available: ${maxCount}`);
  }

  const results: WalletSetupResult[] = [];

  for (let i = 0; i < count; i++) {
    const result = await createTestWallet(node, {
      ...config,
      accountIndex: i,
    });
    results.push(result);
  }

  return results;
}

// =============================================================================
// Account Address Utilities
// =============================================================================

/**
 * Get the deterministic address for a test account by index.
 * This can be used to compute addresses without creating the full wallet.
 *
 * Note: This still requires creating a temporary wallet to derive the address
 * due to how Aztec account addresses are computed.
 *
 * @param node - Connected Aztec node client
 * @param accountIndex - Index of the test account (default: 0)
 * @returns The L2 address for the test account
 */
export async function getTestAccountAddress(
  node: AztecNodeClient,
  accountIndex: number = 0
): Promise<AztecAddress> {
  const { address } = await createTestWallet(node, {
    proverEnabled: false,
    accountIndex,
  });
  return address;
}
