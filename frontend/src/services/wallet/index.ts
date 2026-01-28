/**
 * Wallet Services Index
 *
 * Provides unified wallet exports with automatic environment-based switching.
 * In dev mode (import.meta.env.DEV), uses the lightweight DevWallet that:
 * - Requires no browser extension
 * - Uses pre-funded sandbox test accounts
 * - Auto-detects devnet resets
 *
 * In production, uses the Azguard browser wallet.
 */

// Re-export Azguard wallet exports (for production and explicit usage)
export {
  type AzguardWallet,
  type AztecWalletConnection,
  connectAztecWallet as connectAzguardWallet,
  disconnectAztecWallet as disconnectAzguardWallet,
  isAztecWalletConnected as isAzguardWalletConnected,
  onAztecWalletConnected as onAzguardWalletConnected,
  onAztecWalletDisconnected as onAzguardWalletDisconnected,
  truncateAztecAddress,
} from "./aztec.js";
// Re-export DevWallet exports (for dev mode and explicit usage)
export {
  connectDevWallet,
  type DevWallet,
  type DevWalletConnection,
  disconnectDevWallet,
  isDevWalletConnected,
  onDevWalletConnected,
  onDevWalletDisconnected,
  resetDevWalletState,
} from "./devWallet.js";
// Re-export Ethereum wallet (same for all environments)
export * from "./ethereum.js";

// =============================================================================
// Unified Wallet Interface
// =============================================================================

import type { AzguardWallet, AztecWalletConnection } from "./aztec.js";
import type { DevWallet, DevWalletConnection } from "./devWallet.js";

/**
 * Combined wallet type for both dev and production
 */
export type AnyAztecWallet = AzguardWallet | DevWallet;

/**
 * Combined connection result type
 */
export type AnyWalletConnection = AztecWalletConnection | DevWalletConnection;

/**
 * Check if a wallet is a DevWallet (has getUnderlyingWallet method)
 */
export function isDevWallet(wallet: AnyAztecWallet): wallet is DevWallet {
  return "getUnderlyingWallet" in wallet;
}

/**
 * Connect to the appropriate Aztec wallet based on environment.
 *
 * NOTE: DevWallet is currently disabled due to WASM compatibility issues in browsers.
 * The Aztec SDK's circuit execution requires native WASM which doesn't work well
 * with Vite's bundling. Use Azguard browser extension for all environments.
 *
 * @returns Wallet connection with wallet instance and address
 */
export async function connectWallet(): Promise<AnyWalletConnection> {
  // DevWallet disabled - WASM circuit execution fails in browser environment
  // TODO: Re-enable when Aztec SDK browser WASM support improves
  // if (import.meta.env.DEV) {
  //   const { connectDevWallet } = await import("./devWallet.js");
  //   console.log("[Wallet] Dev mode - using DevWallet");
  //   return connectDevWallet();
  // }

  const { connectAztecWallet } = await import("./aztec.js");
  return connectAztecWallet();
}

/**
 * Disconnect from any Aztec wallet
 */
export async function disconnectWallet(wallet: AnyAztecWallet): Promise<void> {
  await wallet.disconnect();
}

/**
 * Check if any wallet is connected
 */
export function isWalletConnected(wallet: AnyAztecWallet): boolean {
  return wallet.connected;
}
