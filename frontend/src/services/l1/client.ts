/**
 * L1 Client Factory
 *
 * Creates viem PublicClient and WalletClient instances for Ethereum L1 interaction.
 * Matches the pattern from e2e/scripts/full-flow.ts:336-371.
 */

import { CHAIN_IDS, LOCAL_PRIVATE_KEYS, LOCAL_RPC_URLS } from "@aztec-aave-wrapper/shared";
import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import { getDefaultL1Chain, isLocalNetwork } from "../../config/chains.js";

// =============================================================================
// Custom Chain Definitions
// =============================================================================

/**
 * Custom chain definition for local Anvil L1.
 * viem's built-in `foundry` chain works for local development, but we define
 * this for explicit chain ID matching with our configuration.
 */
export const anvilL1Chain: Chain = defineChain({
  id: CHAIN_IDS.ANVIL_L1,
  name: "Anvil Local",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [LOCAL_RPC_URLS.L1],
    },
  },
});

// =============================================================================
// Chain Mapping
// =============================================================================

/**
 * Map chain IDs to viem Chain objects
 */
const chainMap: Record<number, Chain> = {
  [CHAIN_IDS.ANVIL_L1]: foundry, // Use foundry for local devnet compatibility
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: sepolia, // Sepolia testnet for Aztec devnet
};

/**
 * Get the viem Chain object for a given chain ID
 */
export function getChainById(chainId: number): Chain {
  const chain = chainMap[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return chain;
}

// =============================================================================
// Client Creation
// =============================================================================

export interface L1ClientConfig {
  /** RPC URL override (defaults to chain config) */
  rpcUrl?: string;
  /** Chain ID override (defaults to environment detection) */
  chainId?: number;
}

/**
 * Create a public client for read-only L1 operations.
 *
 * @param config - Optional configuration overrides
 * @returns PublicClient instance
 *
 * @example
 * ```ts
 * const publicClient = createL1PublicClient();
 * const chainId = await publicClient.getChainId();
 * ```
 */
export function createL1PublicClient(config?: L1ClientConfig): PublicClient<Transport, Chain> {
  const chainConfig = getDefaultL1Chain();
  const rpcUrl = config?.rpcUrl ?? chainConfig.rpcUrl;
  const chainId = config?.chainId ?? chainConfig.chainId;
  const chain = getChainById(chainId);

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

export interface L1WalletConfig extends L1ClientConfig {
  /** Private key for the wallet (hex string with 0x prefix) */
  privateKey: `0x${string}`;
}

/**
 * Create a wallet client for signing L1 transactions.
 *
 * WARNING: Private key handling in browser environments is a security concern.
 * This is acceptable for local devnet testing but should NOT be used with
 * real funds or in production environments.
 *
 * @param config - Wallet configuration including private key
 * @returns WalletClient instance with account
 *
 * @example
 * ```ts
 * const walletClient = createL1WalletClient({
 *   privateKey: LOCAL_PRIVATE_KEYS.USER1,
 * });
 * ```
 */
export function createL1WalletClient(
  config: L1WalletConfig
): WalletClient<Transport, Chain, Account> {
  const chainConfig = getDefaultL1Chain();
  const rpcUrl = config.rpcUrl ?? chainConfig.rpcUrl;
  const chainId = config.chainId ?? chainConfig.chainId;
  const chain = getChainById(chainId);
  const account = privateKeyToAccount(config.privateKey);

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

// =============================================================================
// Convenience Functions for Local Development
// =============================================================================

/**
 * Pre-configured accounts for local development.
 * Maps to the default Anvil accounts.
 */
export const DevnetAccounts = {
  deployer: LOCAL_PRIVATE_KEYS.DEPLOYER,
  user1: LOCAL_PRIVATE_KEYS.USER1,
  user2: LOCAL_PRIVATE_KEYS.USER2,
  relayer: LOCAL_PRIVATE_KEYS.RELAYER,
} as const;

export interface L1Clients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

/**
 * Create a set of L1 clients for local development.
 *
 * @param userPrivateKey - Private key for user wallet (defaults to USER1)
 * @returns Object with publicClient and walletClient
 *
 * @example
 * ```ts
 * const { publicClient, walletClient } = createDevnetL1Clients();
 * ```
 */
export function createDevnetL1Clients(
  userPrivateKey: `0x${string}` = DevnetAccounts.user1
): L1Clients {
  if (!isLocalNetwork()) {
    console.warn("createDevnetL1Clients() called outside local network environment");
  }

  const publicClient = createL1PublicClient();

  const walletClient = createL1WalletClient({
    privateKey: userPrivateKey,
  });

  return { publicClient, walletClient };
}

/**
 * Verify L1 connection by fetching chain ID.
 *
 * @param client - Public client to verify
 * @returns Chain ID if connected
 * @throws Error if connection fails
 */
export async function verifyL1Connection(client: PublicClient<Transport, Chain>): Promise<number> {
  const chainId = await client.getChainId();
  return chainId;
}
