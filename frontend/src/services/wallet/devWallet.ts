/**
 * Dev Wallet Service for Local Development
 *
 * A lightweight wallet implementation for local devnet development that:
 * - Uses pre-funded sandbox test accounts (no deployment needed)
 * - Detects devnet resets automatically
 * - Requires no browser extension
 * - Provides an Azguard-compatible interface
 *
 * Uses @aztec/test-wallet which is designed for testing environments.
 */

import type { AztecAddress as AztecAddressType } from "@aztec/aztec.js/addresses";
import { getCurrentNetwork } from "../network.js";

// =============================================================================
// Types
// =============================================================================

// Use 'any' for internal types since the Aztec API is complex and changing
// This is acceptable for a dev-only tool
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestWalletType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractArtifact = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractInstanceWithAddress = any;

/**
 * Simple event emitter for Azguard compatibility
 */
class SimpleEventEmitter {
  private handlers: Array<() => void> = [];

  addHandler(fn: () => void): void {
    this.handlers.push(fn);
  }

  removeHandler(fn: () => void): void {
    this.handlers = this.handlers.filter((h) => h !== fn);
  }

  emit(): void {
    for (const handler of this.handlers) {
      handler();
    }
  }
}

/**
 * Dev wallet interface (Azguard-compatible)
 */
export interface DevWallet {
  connected: boolean;
  onConnected: SimpleEventEmitter;
  onDisconnected: SimpleEventEmitter;

  getAccounts(): Promise<Array<{ alias: string; item: AztecAddressType }>>;
  getContractMetadata(
    address: AztecAddressType
  ): Promise<{ contractInstance: ContractInstanceWithAddress | undefined }>;
  registerContract(
    instance: ContractInstanceWithAddress,
    artifact: ContractArtifact
  ): Promise<void>;
  disconnect(): Promise<void>;

  /** Get the underlying TestWallet for Contract.at() */
  getUnderlyingWallet(): TestWalletType;
}

/**
 * Dev wallet connection result
 */
export interface DevWalletConnection {
  wallet: DevWallet;
  address: string;
}

// =============================================================================
// Module State (resets on page reload - intentional)
// =============================================================================

let testWallet: TestWalletType | null = null;
let userAddress: AztecAddressType | null = null;
let lastBlockHash: string | null = null;
let isConnected = false;

const onConnectedEmitter = new SimpleEventEmitter();
const onDisconnectedEmitter = new SimpleEventEmitter();

// =============================================================================
// Devnet Reset Detection
// =============================================================================

/**
 * Check if the devnet has been reset by comparing block 1 hash.
 * If the hash changed, clear cached wallet state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkDevnetReset(node: any): Promise<boolean> {
  try {
    // Use "latest" to get the latest block and check its number
    const latestBlock = await node.getBlock("latest");
    const blockNumber = latestBlock?.number ?? 0;

    // If we have very few blocks, devnet was likely reset
    if (blockNumber < 2 && lastBlockHash !== null) {
      console.log("[DevWallet] Devnet reset detected (low block number), clearing cached state");
      testWallet = null;
      userAddress = null;
      lastBlockHash = null;
      return true;
    }

    const hash = latestBlock?.hash().toString() ?? null;
    lastBlockHash = hash;
    return false;
  } catch {
    // Error getting block - might be fresh devnet
    lastBlockHash = null;
    return false;
  }
}

// =============================================================================
// Connection
// =============================================================================

/**
 * Get the PXE URL for the current network
 */
function getPxeUrl(): string {
  return getCurrentNetwork().l2.pxeUrl;
}

/**
 * Connect to the dev wallet.
 *
 * Creates a TestWallet with a Schnorr account using pre-funded sandbox test keys.
 * Automatically detects devnet resets and clears stale state.
 *
 * @returns Wallet connection with wallet instance and address
 * @throws Error if PXE/Node is not available
 */
export async function connectDevWallet(): Promise<DevWalletConnection> {
  const pxeUrl = getPxeUrl();
  console.log("[DevWallet] Connecting to node at", pxeUrl);

  // Dynamically import Aztec modules to avoid bundling issues
  const { createAztecNodeClient, waitForNode } = await import("@aztec/aztec.js/node");
  const { TestWallet } = await import("@aztec/test-wallet/client/bundle");
  const { INITIAL_TEST_SECRET_KEYS, INITIAL_TEST_SIGNING_KEYS, INITIAL_TEST_ACCOUNT_SALTS } =
    await import("@aztec/accounts/testing");

  // Create node client
  const node = createAztecNodeClient(pxeUrl);

  // Wait for node to be ready
  try {
    await waitForNode(node);
  } catch (_error) {
    throw new Error(
      `Failed to connect to Aztec node at ${pxeUrl}. Is the devnet running? (make devnet-up)`
    );
  }

  // Check for devnet reset
  await checkDevnetReset(node);

  // Create TestWallet if needed
  if (!testWallet) {
    console.log("[DevWallet] Creating TestWallet with Schnorr account (index 0)");

    // Create TestWallet with the node
    testWallet = await TestWallet.create(node, {});

    // Enable simulated simulations mode to avoid WASM execution in browser
    // This uses TypeScript emulation instead of running actual circuits
    if (typeof (testWallet as any).enableSimulatedSimulations === "function") {
      console.log("[DevWallet] Enabling simulated simulations mode (no WASM)");
      (testWallet as any).enableSimulatedSimulations();
    }

    // Create a Schnorr account with pre-funded test keys
    const accountManager = await testWallet.createSchnorrAccount(
      INITIAL_TEST_SECRET_KEYS[0]!,
      INITIAL_TEST_ACCOUNT_SALTS[0]!,
      INITIAL_TEST_SIGNING_KEYS[0]!
    );

    userAddress = accountManager.address;
  }

  if (!userAddress) {
    throw new Error("Failed to create wallet - no user address");
  }

  const addressString = userAddress.toString();
  console.log("[DevWallet] Account ready:", addressString);

  isConnected = true;
  onConnectedEmitter.emit();

  return {
    wallet: createDevWalletWrapper(),
    address: addressString,
  };
}

// =============================================================================
// Wallet Wrapper
// =============================================================================

/**
 * Create a wrapper that provides Azguard-compatible interface
 */
function createDevWalletWrapper(): DevWallet {
  return {
    get connected() {
      return isConnected;
    },

    onConnected: onConnectedEmitter,
    onDisconnected: onDisconnectedEmitter,

    async getAccounts() {
      if (!testWallet || !userAddress) {
        return [];
      }
      return [{ alias: "Dev Account 0", item: userAddress }];
    },

    async getContractMetadata(address: AztecAddressType) {
      if (!testWallet) {
        throw new Error("Wallet not connected");
      }
      // TestWallet.getContractMetadata returns ContractMetadata which has contractInstance
      const metadata = await testWallet.getContractMetadata(address);
      return { contractInstance: metadata?.contractInstance };
    },

    async registerContract(instance: ContractInstanceWithAddress, artifact: ContractArtifact) {
      if (!testWallet) {
        throw new Error("Wallet not connected");
      }
      console.log("[DevWallet.registerContract] instance:", instance);
      console.log(
        "[DevWallet.registerContract] instance.address:",
        instance?.address?.toString?.()
      );
      console.log("[DevWallet.registerContract] artifact name:", artifact?.name);

      // TestWallet has various methods - try to find the right one
      const tw = testWallet as any;
      console.log(
        "[DevWallet.registerContract] TestWallet methods:",
        Object.keys(tw).filter((k) => typeof tw[k] === "function")
      );

      try {
        // Try object form first (TestWallet pattern)
        if (typeof tw.registerContract === "function") {
          console.log(
            "[DevWallet.registerContract] Trying tw.registerContract({ instance, artifact })..."
          );
          await tw.registerContract({ instance, artifact });
          console.log("[DevWallet.registerContract] Success with object form!");
          return;
        }
      } catch (err1) {
        console.log("[DevWallet.registerContract] Object form failed:", err1);
        // Try two-argument form
        try {
          console.log(
            "[DevWallet.registerContract] Trying tw.registerContract(instance, artifact)..."
          );
          await tw.registerContract(instance, artifact);
          console.log("[DevWallet.registerContract] Success with two-arg form!");
          return;
        } catch (err2) {
          console.error("[DevWallet.registerContract] Both forms failed");
          throw err2;
        }
      }
    },

    async disconnect() {
      isConnected = false;
      onDisconnectedEmitter.emit();
      console.log("[DevWallet] Disconnected");
    },

    getUnderlyingWallet() {
      if (!testWallet) {
        throw new Error("Wallet not connected");
      }
      return testWallet;
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Disconnect from the dev wallet
 */
export async function disconnectDevWallet(wallet: DevWallet): Promise<void> {
  await wallet.disconnect();
}

/**
 * Check if the dev wallet is connected
 */
export function isDevWalletConnected(wallet: DevWallet): boolean {
  return wallet.connected;
}

/**
 * Register connection event handler
 */
export function onDevWalletConnected(wallet: DevWallet, handler: () => void): void {
  wallet.onConnected.addHandler(handler);
}

/**
 * Register disconnection event handler
 */
export function onDevWalletDisconnected(wallet: DevWallet, handler: () => void): void {
  wallet.onDisconnected.addHandler(handler);
}

/**
 * Truncate an Aztec address for display
 */
export function truncateAztecAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

/**
 * Force reset the dev wallet state.
 * Useful for testing or when you know the devnet was reset.
 */
export function resetDevWalletState(): void {
  console.log("[DevWallet] Forcing state reset");
  testWallet = null;
  userAddress = null;
  lastBlockHash = null;
  isConnected = false;
}
