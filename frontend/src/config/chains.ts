/**
 * Chain configuration using shared constants and network service
 */

import type { ChainConfig } from "@aztec-aave-wrapper/shared";
import { CHAIN_IDS, LOCAL_RPC_URLS } from "@aztec-aave-wrapper/shared";
import { getCurrentNetwork, type NetworkConfig } from "../services/network.js";

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Detect if running in local development mode (Vite dev server)
 */
export function isLocalDevelopment(): boolean {
  return import.meta.env.DEV === true;
}

/**
 * Check if the current network is local
 */
export function isLocalNetwork(): boolean {
  return getCurrentNetwork().id === "local";
}

// =============================================================================
// L1 Chain Configurations
// =============================================================================

export const L1_CHAINS: Record<number, ChainConfig> = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: {
    name: "Ethereum Mainnet",
    chainId: CHAIN_IDS.ETHEREUM_MAINNET,
    rpcUrl: "https://eth.llamarpc.com",
  },
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: {
    name: "Sepolia Testnet",
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    rpcUrl: import.meta.env.VITE_L1_RPC_URL || "https://rpc.sepolia.org",
  },
  [CHAIN_IDS.ANVIL_L1]: {
    name: "Anvil Local",
    chainId: CHAIN_IDS.ANVIL_L1,
    rpcUrl: LOCAL_RPC_URLS.L1,
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
    rpcUrl: LOCAL_RPC_URLS.PXE,
    pxeUrl: LOCAL_RPC_URLS.PXE,
  },
  devnet: {
    name: "Aztec Devnet",
    chainId: 0,
    rpcUrl: import.meta.env.VITE_PXE_URL || "https://devnet-6.aztec-labs.com",
    pxeUrl: import.meta.env.VITE_PXE_URL || "https://devnet-6.aztec-labs.com",
  },
};

// =============================================================================
// Network-Aware Chain Selection
// =============================================================================

/**
 * Get L1 chain configuration from network config
 */
function getL1ChainFromNetwork(network: NetworkConfig): ChainConfig {
  return {
    name: network.l1.chainName,
    chainId: network.l1.chainId,
    rpcUrl: network.l1.rpcUrl,
  };
}

/**
 * Get L2 chain configuration from network config
 */
function getL2ChainFromNetwork(network: NetworkConfig): AztecChainConfig {
  return {
    name: network.name,
    chainId: 0,
    rpcUrl: network.l2.pxeUrl,
    pxeUrl: network.l2.pxeUrl,
  };
}

/**
 * Get the L1 chain configuration for the current network
 */
export function getDefaultL1Chain(): ChainConfig {
  const network = getCurrentNetwork();
  return getL1ChainFromNetwork(network);
}

/**
 * Get the L2 (Aztec) chain configuration for the current network
 */
export function getDefaultL2Chain(): AztecChainConfig {
  const network = getCurrentNetwork();
  return getL2ChainFromNetwork(network);
}
