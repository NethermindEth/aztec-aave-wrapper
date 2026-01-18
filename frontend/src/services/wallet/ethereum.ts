/**
 * Ethereum Wallet Connection Service
 *
 * Connects to browser extension wallets (MetaMask, etc.) using viem.
 * Targets local Anvil devnet (chainId: 31337).
 */

import { CHAIN_IDS, LOCAL_RPC_URLS } from "@aztec-aave-wrapper/shared";
import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { foundry } from "viem/chains";

// Extend Window interface for ethereum provider
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

/**
 * Check if MetaMask or another injected provider is available
 */
export function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

/**
 * Ethereum wallet connection result
 */
export interface EthereumWalletConnection {
  address: Address;
  chainId: number;
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient<Transport, Chain>;
}

/**
 * Extended ethereum provider with event methods
 */
interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

/**
 * Get the injected ethereum provider
 */
function getProvider(): EthereumProvider {
  if (!hasInjectedProvider()) {
    throw new Error("No Ethereum wallet detected. Please install MetaMask.");
  }
  return window.ethereum as EthereumProvider;
}

/**
 * Connect to an injected Ethereum wallet (MetaMask, etc.)
 *
 * @returns Wallet connection with address, clients, and chain info
 * @throws Error if no wallet is available or user rejects connection
 */
export async function connectEthereumWallet(): Promise<EthereumWalletConnection> {
  const provider = getProvider();

  // Request account access
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found. Please unlock your wallet.");
  }

  const address = accounts[0];

  // Get current chain ID
  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainIdHex, 16);

  // Create wallet client with injected provider
  const walletClient = createWalletClient({
    account: address,
    chain: foundry,
    transport: custom(provider),
  });

  // Create public client for read operations (use HTTP for reliability)
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(LOCAL_RPC_URLS.L1),
  });

  return {
    address,
    chainId,
    walletClient,
    publicClient,
  };
}

/**
 * Get ETH balance for an address
 */
export async function getEthBalance(
  publicClient: PublicClient<Transport, Chain>,
  address: Address
): Promise<bigint> {
  return publicClient.getBalance({ address });
}

/**
 * Format ETH balance for display
 */
export function formatEthBalance(balance: bigint): string {
  const formatted = formatEther(balance);
  // Show up to 4 decimal places
  const num = parseFloat(formatted);
  return num.toFixed(4);
}

/**
 * Check if connected to the expected chain (Anvil devnet)
 */
export function isCorrectChain(chainId: number): boolean {
  return chainId === CHAIN_IDS.ANVIL_L1;
}

/**
 * Request chain switch to Anvil
 */
export async function switchToAnvil(): Promise<void> {
  const provider = getProvider();

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${CHAIN_IDS.ANVIL_L1.toString(16)}` }],
    });
  } catch (error: unknown) {
    // Chain not added, try to add it
    if ((error as { code?: number })?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${CHAIN_IDS.ANVIL_L1.toString(16)}`,
            chainName: "Anvil Local",
            nativeCurrency: {
              name: "Ether",
              symbol: "ETH",
              decimals: 18,
            },
            rpcUrls: [LOCAL_RPC_URLS.L1],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

/**
 * Event handler types for wallet events
 */
export type AccountsChangedHandler = (accounts: Address[]) => void;
export type ChainChangedHandler = (chainId: string) => void;
export type DisconnectHandler = () => void;

/**
 * Subscribe to wallet account changes
 */
export function onAccountsChanged(handler: AccountsChangedHandler): () => void {
  if (!hasInjectedProvider()) return () => {};

  const provider = getProvider();
  const wrappedHandler = (accounts: unknown) => handler(accounts as Address[]);
  provider.on("accountsChanged", wrappedHandler);

  return () => provider.removeListener("accountsChanged", wrappedHandler);
}

/**
 * Subscribe to chain changes
 */
export function onChainChanged(handler: ChainChangedHandler): () => void {
  if (!hasInjectedProvider()) return () => {};

  const provider = getProvider();
  const wrappedHandler = (chainId: unknown) => handler(chainId as string);
  provider.on("chainChanged", wrappedHandler);

  return () => provider.removeListener("chainChanged", wrappedHandler);
}

/**
 * Subscribe to disconnect events
 */
export function onDisconnect(handler: DisconnectHandler): () => void {
  if (!hasInjectedProvider()) return () => {};

  const provider = getProvider();
  provider.on("disconnect", handler);

  return () => provider.removeListener("disconnect", handler);
}
