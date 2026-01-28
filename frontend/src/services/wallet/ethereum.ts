/**
 * Ethereum Wallet Connection Service
 *
 * Connects to browser extension wallets (MetaMask, etc.) using direct provider access.
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

// Track if a connection attempt is in progress to prevent duplicate requests
let connectionInProgress = false;

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
 * Connect to Ethereum wallet using direct injected provider (MetaMask)
 *
 * @returns Wallet connection with address, clients, and chain info
 * @throws Error if user cancels or connection fails
 */
export async function connectEthereumWallet(): Promise<EthereumWalletConnection> {
  // Guard against multiple simultaneous connection attempts
  if (connectionInProgress) {
    throw new Error(
      "Connection already in progress. Please wait or close any pending wallet dialogs."
    );
  }

  if (!hasInjectedProvider()) {
    throw new Error("No Ethereum wallet detected. Please install MetaMask.");
  }

  connectionInProgress = true;

  try {
    const provider = getProvider();

    // Request account access - this triggers the MetaMask popup
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as Address[];

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts returned from wallet");
    }

    const address = accounts[0];

    // Get chain ID
    const chainIdHex = (await provider.request({
      method: "eth_chainId",
    })) as string;
    const chainId = parseInt(chainIdHex, 16);

    // Create viem clients
    const walletClient = createWalletClient({
      account: address,
      chain: foundry,
      transport: custom(provider),
    });

    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(LOCAL_RPC_URLS.L1),
    });

    connectionInProgress = false;

    return {
      address,
      chainId,
      walletClient,
      publicClient,
    };
  } catch (err) {
    connectionInProgress = false;
    throw err;
  }
}

/**
 * Disconnect the Ethereum wallet
 * Note: MetaMask doesn't have a true "disconnect" - we just clear our state
 * The user must manually disconnect from MetaMask's UI if needed
 */
export async function disconnectEthereumWallet(): Promise<void> {
  // MetaMask doesn't support programmatic disconnect
  // We just reset our connection state
  connectionInProgress = false;
}

/**
 * Create a wallet connection for a specific address without prompting MetaMask
 * Used when the account changes and we need to refresh the connection
 *
 * @param address - The new account address
 * @returns Wallet connection with updated clients
 */
export function createConnectionForAddress(address: Address): EthereumWalletConnection {
  if (!hasInjectedProvider()) {
    throw new Error("No Ethereum wallet detected. Please install MetaMask.");
  }

  const provider = getProvider();

  // Create viem clients with the new address
  const walletClient = createWalletClient({
    account: address,
    chain: foundry,
    transport: custom(provider),
  });

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(LOCAL_RPC_URLS.L1),
  });

  return {
    address,
    chainId: CHAIN_IDS.ANVIL_L1,
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
 * Watch for account changes (compatible interface with previous Web3Modal version)
 * Returns an unsubscribe function
 */
export function watchAccountChanges(
  callback: (account: { address?: Address; isConnected: boolean; chainId?: number }) => void
): () => void {
  if (!hasInjectedProvider()) {
    return () => {};
  }

  const provider = getProvider();

  const handleAccountsChanged = async (accounts: unknown) => {
    const accountList = accounts as Address[];
    if (accountList.length === 0) {
      callback({ isConnected: false });
    } else {
      // Get current chain ID
      try {
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        const chainId = parseInt(chainIdHex, 16);
        callback({
          address: accountList[0],
          isConnected: true,
          chainId,
        });
      } catch {
        callback({
          address: accountList[0],
          isConnected: true,
        });
      }
    }
  };

  const handleChainChanged = async (chainIdHex: unknown) => {
    const chainId = parseInt(chainIdHex as string, 16);
    // Get current accounts
    try {
      const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
      if (accounts.length > 0) {
        callback({
          address: accounts[0],
          isConnected: true,
          chainId,
        });
      }
    } catch {
      // Ignore errors, account change will handle it
    }
  };

  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);

  return () => {
    provider.removeListener("accountsChanged", handleAccountsChanged);
    provider.removeListener("chainChanged", handleChainChanged);
  };
}

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
