/**
 * Wormhole Testnet Interaction Utilities
 *
 * Provides utilities for interacting with real Wormhole testnet infrastructure:
 * - VAA fetching from Wormhole guardian network
 * - Message tracking and polling
 * - Testnet relayer integration
 *
 * This module is used for integration tests against actual Wormhole testnets
 * (Sepolia, Arbitrum Sepolia, etc.).
 *
 * Usage:
 *   import { WormholeTestnet } from './utils/wormhole-testnet';
 *   const wormhole = new WormholeTestnet('testnet');
 *   const vaa = await wormhole.fetchVAA(emitterChain, emitterAddress, sequence);
 */

import type { Hex, Address } from "viem";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Wormhole network environments
 */
export type WormholeNetwork = "mainnet" | "testnet" | "devnet";

/**
 * Wormhole API configuration
 */
export interface WormholeApiConfig {
  /** Wormhole API base URL */
  apiUrl: string;
  /** Wormhole RPC URL (for VAA submission) */
  rpcUrl: string;
  /** Wormhole relayer API URL */
  relayerUrl: string;
}

/**
 * VAA fetch result
 */
export interface VAAResult {
  /** Raw VAA bytes (base64 encoded) */
  vaaBytes: string;
  /** Parsed VAA data */
  vaa: {
    version: number;
    guardianSetIndex: number;
    timestamp: number;
    nonce: number;
    emitterChain: number;
    emitterAddress: Hex;
    sequence: bigint;
    consistencyLevel: number;
    payload: Hex;
  };
  /** Whether the VAA is finalized */
  finalized: boolean;
}

/**
 * Message status from Wormhole
 */
export interface MessageStatus {
  /** Message ID */
  id: string;
  /** Emitter chain */
  emitterChain: number;
  /** Emitter address */
  emitterAddress: Hex;
  /** Sequence number */
  sequence: bigint;
  /** Status: 'pending' | 'finalized' | 'failed' */
  status: "pending" | "finalized" | "failed";
  /** VAA bytes if finalized */
  vaaBytes?: string;
  /** Timestamp of status check */
  timestamp: number;
}

/**
 * Relayer delivery status
 */
export interface DeliveryStatus {
  /** Delivery hash */
  deliveryHash: Hex;
  /** Source chain */
  sourceChain: number;
  /** Target chain */
  targetChain: number;
  /** Status */
  status: "pending" | "delivered" | "failed";
  /** Target transaction hash if delivered */
  targetTxHash?: Hex;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Network Configuration
// =============================================================================

const NETWORK_CONFIGS: Record<WormholeNetwork, WormholeApiConfig> = {
  mainnet: {
    apiUrl: "https://api.wormholescan.io/api/v1",
    rpcUrl: "https://wormhole-v2-mainnet-api.certus.one",
    relayerUrl: "https://relayer.wormhole.com",
  },
  testnet: {
    apiUrl: "https://api.testnet.wormholescan.io/api/v1",
    rpcUrl: "https://wormhole-v2-testnet-api.certus.one",
    relayerUrl: "https://relayer.testnet.wormhole.com",
  },
  devnet: {
    // Local guardian for devnet testing
    apiUrl: "http://localhost:7071/v1",
    rpcUrl: "http://localhost:7071",
    relayerUrl: "http://localhost:7072",
  },
};

/**
 * Chain ID to Wormhole chain ID mapping
 */
export const CHAIN_ID_MAP: Record<number, number> = {
  // Ethereum
  1: 2, // Mainnet
  11155111: 10002, // Sepolia

  // Arbitrum
  42161: 23, // Mainnet
  421614: 10003, // Sepolia

  // Local (custom)
  31337: 2, // L1 (mimics Ethereum)
  31338: 23, // Target (mimics Arbitrum)
};

// =============================================================================
// Wormhole Testnet Class
// =============================================================================

/**
 * WormholeTestnet provides utilities for interacting with Wormhole testnet.
 *
 * @example
 * ```ts
 * const wormhole = new WormholeTestnet('testnet');
 *
 * // Fetch a VAA
 * const vaa = await wormhole.fetchVAA(10002, emitterAddress, 123n);
 *
 * // Wait for a VAA to be signed
 * const signedVaa = await wormhole.waitForVAA(10002, emitterAddress, 123n, 60000);
 * ```
 */
export class WormholeTestnet {
  private network: WormholeNetwork;
  private config: WormholeApiConfig;

  constructor(network: WormholeNetwork = "testnet") {
    this.network = network;
    this.config = NETWORK_CONFIGS[network];
  }

  // ===========================================================================
  // VAA Operations
  // ===========================================================================

  /**
   * Fetch a VAA from the Wormhole guardian network.
   *
   * @param emitterChain - Wormhole chain ID of the emitter
   * @param emitterAddress - Address of the emitting contract (32 bytes hex)
   * @param sequence - Sequence number
   * @returns VAA result or null if not found
   */
  async fetchVAA(
    emitterChain: number,
    emitterAddress: Hex,
    sequence: bigint
  ): Promise<VAAResult | null> {
    try {
      // Normalize emitter address to 32 bytes
      const normalizedAddress = this.normalizeAddress(emitterAddress);

      const url = `${this.config.apiUrl}/vaas/${emitterChain}/${normalizedAddress}/${sequence}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`VAA fetch failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        vaaBytes?: string;
        vaa?: string;
        version?: number;
        guardianSetIndex: number;
        timestamp: number;
        nonce: number;
        emitterChain: number;
        sequence: string | number;
        consistencyLevel: number;
        payload: string;
        finalized?: boolean;
      };

      return {
        vaaBytes: data.vaaBytes || data.vaa || "",
        vaa: {
          version: data.version || 1,
          guardianSetIndex: data.guardianSetIndex,
          timestamp: data.timestamp,
          nonce: data.nonce,
          emitterChain: data.emitterChain,
          emitterAddress: normalizedAddress,
          sequence: BigInt(data.sequence),
          consistencyLevel: data.consistencyLevel,
          payload: data.payload as Hex,
        },
        finalized: data.finalized ?? true,
      };
    } catch (error) {
      console.warn("Failed to fetch VAA:", error);
      return null;
    }
  }

  /**
   * Wait for a VAA to be signed by guardians.
   *
   * @param emitterChain - Wormhole chain ID
   * @param emitterAddress - Emitter contract address
   * @param sequence - Sequence number
   * @param timeoutMs - Maximum wait time (default: 2 minutes)
   * @param pollIntervalMs - Polling interval (default: 5 seconds)
   * @returns VAA result
   * @throws Error if timeout is reached
   */
  async waitForVAA(
    emitterChain: number,
    emitterAddress: Hex,
    sequence: bigint,
    timeoutMs: number = 120_000,
    pollIntervalMs: number = 5_000
  ): Promise<VAAResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.fetchVAA(emitterChain, emitterAddress, sequence);

      if (result && result.finalized) {
        return result;
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(
      `Timeout waiting for VAA: chain=${emitterChain} address=${emitterAddress} seq=${sequence}`
    );
  }

  /**
   * Get message status from Wormhole.
   *
   * @param emitterChain - Wormhole chain ID
   * @param emitterAddress - Emitter address
   * @param sequence - Sequence number
   * @returns Message status
   */
  async getMessageStatus(
    emitterChain: number,
    emitterAddress: Hex,
    sequence: bigint
  ): Promise<MessageStatus> {
    const normalizedAddress = this.normalizeAddress(emitterAddress);

    try {
      const vaa = await this.fetchVAA(emitterChain, emitterAddress, sequence);

      if (vaa) {
        return {
          id: `${emitterChain}/${normalizedAddress}/${sequence}`,
          emitterChain,
          emitterAddress: normalizedAddress,
          sequence,
          status: vaa.finalized ? "finalized" : "pending",
          vaaBytes: vaa.vaaBytes,
          timestamp: Date.now(),
        };
      }

      return {
        id: `${emitterChain}/${normalizedAddress}/${sequence}`,
        emitterChain,
        emitterAddress: normalizedAddress,
        sequence,
        status: "pending",
        timestamp: Date.now(),
      };
    } catch {
      return {
        id: `${emitterChain}/${normalizedAddress}/${sequence}`,
        emitterChain,
        emitterAddress: normalizedAddress,
        sequence,
        status: "failed",
        timestamp: Date.now(),
      };
    }
  }

  // ===========================================================================
  // Relayer Operations
  // ===========================================================================

  /**
   * Check delivery status via Wormhole relayer.
   *
   * @param deliveryHash - Delivery hash from relayer
   * @returns Delivery status
   */
  async getDeliveryStatus(deliveryHash: Hex): Promise<DeliveryStatus | null> {
    try {
      const url = `${this.config.relayerUrl}/v1/delivery/${deliveryHash}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Delivery status fetch failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        sourceChain: number;
        targetChain: number;
        status: "pending" | "delivered" | "failed";
        targetTxHash?: Hex;
        error?: string;
      };

      return {
        deliveryHash,
        sourceChain: data.sourceChain,
        targetChain: data.targetChain,
        status: data.status,
        targetTxHash: data.targetTxHash,
        error: data.error,
      };
    } catch (error) {
      console.warn("Failed to get delivery status:", error);
      return null;
    }
  }

  /**
   * Wait for relayer delivery to complete.
   *
   * @param deliveryHash - Delivery hash
   * @param timeoutMs - Maximum wait time
   * @returns Final delivery status
   */
  async waitForDelivery(
    deliveryHash: Hex,
    timeoutMs: number = 300_000 // 5 minutes for cross-chain
  ): Promise<DeliveryStatus> {
    const startTime = Date.now();
    const pollInterval = 10_000; // 10 seconds

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getDeliveryStatus(deliveryHash);

      if (status && (status.status === "delivered" || status.status === "failed")) {
        return status;
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`Timeout waiting for delivery: ${deliveryHash}`);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Convert native chain ID to Wormhole chain ID.
   */
  toWormholeChainId(nativeChainId: number): number {
    const wormholeId = CHAIN_ID_MAP[nativeChainId];
    if (wormholeId === undefined) {
      throw new Error(`Unknown chain ID: ${nativeChainId}`);
    }
    return wormholeId;
  }

  /**
   * Normalize an address to 32-byte Wormhole format.
   */
  normalizeAddress(address: Hex | Address): Hex {
    // Remove 0x prefix, pad to 64 hex chars (32 bytes), add 0x back
    const clean = address.toLowerCase().replace("0x", "");
    return `0x${clean.padStart(64, "0")}` as Hex;
  }

  /**
   * Parse VAA bytes to extract payload.
   *
   * @param vaaBytes - Base64 encoded VAA
   * @returns Parsed VAA payload
   */
  parseVAAPayload(vaaBytes: string): Hex {
    // Decode base64
    const bytes = Buffer.from(vaaBytes, "base64");

    // VAA structure:
    // - 1 byte: version
    // - 4 bytes: guardian set index
    // - 1 byte: signature count
    // - 66 bytes * sig_count: signatures
    // - 4 bytes: timestamp
    // - 4 bytes: nonce
    // - 2 bytes: emitter chain
    // - 32 bytes: emitter address
    // - 8 bytes: sequence
    // - 1 byte: consistency level
    // - rest: payload

    // These variables are for documentation purposes
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _version = bytes[0];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _guardianSetIndex = bytes.readUInt32BE(1);
    const sigCount = bytes[5] ?? 0;
    const sigLength = 66 * sigCount;
    const payloadStart = 6 + sigLength + 4 + 4 + 2 + 32 + 8 + 1;
    const payload = bytes.slice(payloadStart);

    return `0x${payload.toString("hex")}` as Hex;
  }

  /**
   * Get current network configuration.
   */
  getConfig(): WormholeApiConfig {
    return { ...this.config };
  }

  /**
   * Get current network name.
   */
  getNetwork(): WormholeNetwork {
    return this.network;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WormholeTestnet instance for the specified network.
 */
export function createWormholeTestnet(
  network: WormholeNetwork = "testnet"
): WormholeTestnet {
  return new WormholeTestnet(network);
}

/**
 * Get Wormhole chain ID for a native EVM chain ID.
 */
export function getWormholeChainId(nativeChainId: number): number {
  const id = CHAIN_ID_MAP[nativeChainId];
  if (id === undefined) {
    throw new Error(`Unknown native chain ID: ${nativeChainId}`);
  }
  return id;
}

/**
 * Construct a VAA ID string.
 */
export function constructVAAId(
  emitterChain: number,
  emitterAddress: Hex,
  sequence: bigint
): string {
  const normalizedAddress = emitterAddress.toLowerCase().replace("0x", "").padStart(64, "0");
  return `${emitterChain}/${normalizedAddress}/${sequence}`;
}
