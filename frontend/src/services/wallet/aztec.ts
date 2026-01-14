/**
 * Aztec Wallet Connection Service
 *
 * Connects to Aztec L2 via Azguard browser wallet.
 * https://github.com/AzguardWallet/aztec-wallet
 */

import { AztecWallet } from "@azguardwallet/aztec-wallet";

/**
 * Azguard wallet instance type
 */
export type AzguardWallet = Awaited<ReturnType<typeof AztecWallet.connect>>;

/**
 * Aztec wallet connection result
 */
export interface AztecWalletConnection {
  wallet: AzguardWallet;
  address: string;
}

/**
 * App metadata for Azguard connection
 */
const APP_METADATA = {
  name: "Aztec Aave Wrapper",
  description: "Privacy-preserving Aave lending from Aztec L2",
  logo: "",
  url: typeof window !== "undefined" ? window.location.origin : "",
};

/**
 * Connect to Aztec wallet via Azguard browser extension
 *
 * @returns Wallet connection with wallet instance and address
 * @throws Error if Azguard is not installed or user rejects connection
 */
export async function connectAztecWallet(): Promise<AztecWalletConnection> {
  // Connect to Azguard wallet for sandbox/local development
  const wallet = await AztecWallet.connect(APP_METADATA, "sandbox");

  // Get the connected accounts
  // Returns array of { alias: string, item: AztecAddress }
  const accounts = await wallet.getAccounts();

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found in Azguard wallet");
  }

  // Use the first account - access .item to get the AztecAddress
  const account = accounts[0] as { alias: string; item: { toString(): string } };
  const address = account.item.toString();

  return {
    wallet,
    address,
  };
}

/**
 * Disconnect from Azguard wallet
 */
export async function disconnectAztecWallet(wallet: AzguardWallet): Promise<void> {
  await wallet.disconnect();
}

/**
 * Check if wallet is still connected
 */
export function isAztecWalletConnected(wallet: AzguardWallet): boolean {
  return wallet.connected;
}

/**
 * Register connection event handlers
 */
export function onAztecWalletConnected(wallet: AzguardWallet, handler: () => void): void {
  wallet.onConnected.addHandler(handler);
}

/**
 * Register disconnection event handlers
 */
export function onAztecWalletDisconnected(wallet: AzguardWallet, handler: () => void): void {
  wallet.onDisconnected.addHandler(handler);
}

/**
 * Truncate an Aztec address for display
 * Aztec addresses are longer (66 chars), so we show more context
 */
export function truncateAztecAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}
