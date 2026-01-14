/**
 * Chain configuration using shared constants
 */

import {
  CHAIN_IDS,
  LOCAL_RPC_URLS,
  AZTEC_CONFIG,
} from "@aztec-aave-wrapper/shared";
import type { ChainConfig } from "@aztec-aave-wrapper/shared";

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Get environment variable value (Vite uses import.meta.env)
 */
function getEnvVar(key: string, defaultValue: string): string {
  // Vite exposes env vars on import.meta.env with VITE_ prefix
  const viteKey = `VITE_${key}`;
  const env = import.meta.env;
  return (env[viteKey] as string) ?? defaultValue;
}

/**
 * Detect if running in local development mode
 */
export function isLocalDevelopment(): boolean {
  return import.meta.env.DEV === true;
}

// =============================================================================
// L1 Chain Configurations
// =============================================================================

export const L1_CHAINS: Record<number, ChainConfig> = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: {
    name: "Ethereum Mainnet",
    chainId: CHAIN_IDS.ETHEREUM_MAINNET,
    rpcUrl: getEnvVar("L1_RPC_URL", "https://eth.llamarpc.com"),
  },
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: {
    name: "Sepolia Testnet",
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    rpcUrl: getEnvVar("L1_RPC_URL", "https://rpc.sepolia.org"),
  },
  [CHAIN_IDS.ANVIL_L1]: {
    name: "Anvil Local",
    chainId: CHAIN_IDS.ANVIL_L1,
    rpcUrl: getEnvVar("L1_RPC_URL", LOCAL_RPC_URLS.L1),
  },
};

// =============================================================================
// L2 (Aztec) Configurations
// =============================================================================

export interface AztecChainConfig extends ChainConfig {
  /** PXE endpoint URL */
  pxeUrl: string;
}

export const L2_CHAINS: Record<string, AztecChainConfig> = {
  local: {
    name: "Aztec Sandbox",
    chainId: 0, // Aztec doesn't use EVM chain IDs
    rpcUrl: getEnvVar("PXE_URL", LOCAL_RPC_URLS.PXE),
    pxeUrl: getEnvVar("PXE_URL", LOCAL_RPC_URLS.PXE),
  },
  devnet: {
    name: "Aztec Devnet",
    chainId: 0,
    rpcUrl: getEnvVar("PXE_URL", AZTEC_CONFIG.DEVNET_PXE_URL),
    pxeUrl: getEnvVar("PXE_URL", AZTEC_CONFIG.DEVNET_PXE_URL),
  },
};

// =============================================================================
// Default Chain Selection
// =============================================================================

/**
 * Get the default L1 chain configuration based on environment
 */
export function getDefaultL1Chain(): ChainConfig {
  if (isLocalDevelopment()) {
    return L1_CHAINS[CHAIN_IDS.ANVIL_L1];
  }
  // Default to Sepolia for non-local environments
  const chainId = Number(getEnvVar("L1_CHAIN_ID", String(CHAIN_IDS.ETHEREUM_SEPOLIA)));
  return L1_CHAINS[chainId] ?? L1_CHAINS[CHAIN_IDS.ETHEREUM_SEPOLIA];
}

/**
 * Get the default L2 (Aztec) chain configuration based on environment
 */
export function getDefaultL2Chain(): AztecChainConfig {
  if (isLocalDevelopment()) {
    return L2_CHAINS.local;
  }
  return L2_CHAINS.devnet;
}
