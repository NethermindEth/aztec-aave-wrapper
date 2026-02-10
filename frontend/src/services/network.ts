/**
 * Network configuration service
 *
 * Manages network selection (local vs devnet) and provides
 * network-specific configuration for RPC URLs and deployment files.
 */

import { CHAIN_IDS, LOCAL_RPC_URLS } from "@aztec-aave-wrapper/shared";

// =============================================================================
// Types
// =============================================================================

/**
 * Available network identifiers
 */
export type NetworkId = "local" | "devnet";

/**
 * Network configuration
 */
export interface NetworkConfig {
  /** Human-readable network name */
  name: string;
  /** Network identifier */
  id: NetworkId;
  /** L1 chain configuration */
  l1: {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    blockExplorer?: string;
  };
  /** L2 Aztec configuration */
  l2: {
    pxeUrl: string;
    blockExplorer?: string;
  };
  /** Path to deployment addresses file */
  deploymentsFile: string;
}

// =============================================================================
// Network Configurations
// =============================================================================

/**
 * Local development network (Anvil + Aztec Sandbox)
 */
const LOCAL_NETWORK: NetworkConfig = {
  name: "Local Devnet",
  id: "local",
  l1: {
    chainId: CHAIN_IDS.ANVIL_L1,
    chainName: "Anvil Local",
    rpcUrl: LOCAL_RPC_URLS.L1,
  },
  l2: {
    pxeUrl: LOCAL_RPC_URLS.PXE,
  },
  deploymentsFile: "/.deployments.local.json",
};

/**
 * Aztec Devnet (Sepolia + Aztec Devnet)
 */
const DEVNET_NETWORK: NetworkConfig = {
  name: "Aztec Devnet",
  id: "devnet",
  l1: {
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    chainName: "Sepolia",
    rpcUrl: import.meta.env.VITE_L1_RPC_URL || "https://rpc.sepolia.org",
    blockExplorer: "https://sepolia.etherscan.io",
  },
  l2: {
    pxeUrl: import.meta.env.VITE_PXE_URL || "https://devnet-6.aztec-labs.com",
    blockExplorer: "https://devnet.aztecscan.xyz",
  },
  deploymentsFile: "/.deployments.devnet.json",
};

/**
 * All available networks
 */
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  local: LOCAL_NETWORK,
  devnet: DEVNET_NETWORK,
};

// =============================================================================
// LocalStorage Persistence
// =============================================================================

const STORAGE_KEY = "aztec-aave:network";

/**
 * Get the saved network ID from localStorage
 */
function getSavedNetworkId(): NetworkId | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "local" || saved === "devnet") {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

/**
 * Save network ID to localStorage
 */
function saveNetworkId(id: NetworkId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

// =============================================================================
// Network State
// =============================================================================

/**
 * Currently selected network ID
 * Defaults to local in development mode, devnet otherwise
 */
let currentNetworkId: NetworkId = getSavedNetworkId() ?? (import.meta.env.DEV ? "local" : "devnet");

/**
 * Listeners for network changes
 */
type NetworkChangeListener = (network: NetworkConfig) => void;
const listeners: Set<NetworkChangeListener> = new Set();

/**
 * Get the current network configuration
 */
export function getCurrentNetwork(): NetworkConfig {
  return NETWORKS[currentNetworkId];
}

/**
 * Get the current network ID
 */
export function getCurrentNetworkId(): NetworkId {
  return currentNetworkId;
}

/**
 * Set the current network and notify listeners
 */
export function setCurrentNetwork(id: NetworkId): void {
  if (id === currentNetworkId) return;

  currentNetworkId = id;
  saveNetworkId(id);

  const network = NETWORKS[id];
  for (const listener of listeners) {
    listener(network);
  }
}

/**
 * Subscribe to network changes
 * @returns Unsubscribe function
 */
export function onNetworkChange(listener: NetworkChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get all available networks
 */
export function getAvailableNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS);
}
