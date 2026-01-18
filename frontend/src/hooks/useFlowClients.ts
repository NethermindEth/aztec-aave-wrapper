/**
 * Flow Clients Hook
 *
 * Custom hook that initializes L1/L2 clients and contract instances from wallet connections.
 * Provides a unified interface for deposit/withdraw flows to access all required clients.
 *
 * Handles:
 * - Race conditions between wallet connection and client initialization
 * - Stale client references after wallet reconnection
 * - Lazy loading of Aztec modules
 */

import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { Account, Chain, Transport, WalletClient } from "viem";
import type { L1Clients } from "../services/l1/client.js";
import { createL1WalletClient, DevnetAccounts } from "../services/l1/client.js";
import { balanceOf } from "../services/l1/tokens.js";
import type { AztecNodeClient } from "../services/l2/client.js";
import { createL2NodeClientNoWait, waitForL2Node } from "../services/l2/client.js";
import type { AaveWrapperContract, AztecAddress } from "../services/l2/contract.js";
import { loadContractWithAzguard } from "../services/l2/contract.js";
import type { AzguardWallet } from "../services/wallet/aztec.js";
import type { EthereumWalletConnection } from "../services/wallet/ethereum.js";
import { setATokenBalance, setEthBalance, setUsdcBalance } from "../store/actions.js";
import { useAppState } from "../store/hooks.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L2 context for flow operations
 */
export interface FlowL2Context {
  /** Aztec node client */
  node: AztecNodeClient;
  /** User wallet with address accessor */
  wallet: { address: AztecAddress };
  /** AaveWrapper contract instance */
  contract: AaveWrapperContract;
}

/**
 * Complete flow clients for deposit/withdraw operations
 */
export interface FlowClients {
  /** L1 clients (public, user wallet, relayer wallet) */
  l1: L1Clients;
  /** L2 context (node, wallet, contract) */
  l2: FlowL2Context;
}

/**
 * Flow clients initialization state
 */
export type FlowClientsStatus = "disconnected" | "initializing" | "ready" | "error";

/**
 * Return type of useFlowClients hook
 */
export interface UseFlowClientsResult {
  /** Current initialization status */
  status: Accessor<FlowClientsStatus>;
  /** Flow clients (only valid when status is "ready") */
  clients: Accessor<FlowClients | null>;
  /** Error message if status is "error" */
  error: Accessor<string | null>;
  /** Re-initialize clients (useful after reconnection) */
  reinitialize: () => Promise<void>;
  /** Refresh wallet balances from L1 (useful after deposit/withdraw) */
  refreshBalances: () => Promise<void>;
}

// =============================================================================
// Internal State
// =============================================================================

/**
 * Version counter to detect stale initialization attempts.
 * Incremented each time wallets change, allowing in-flight
 * initializations to detect when they should be discarded.
 */
let initializationVersion = 0;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook to initialize and manage flow clients from wallet connections.
 *
 * Automatically initializes clients when both L1 and L2 wallets are connected.
 * Handles reconnection by reinitializing with fresh client instances.
 *
 * @param l1Connection - Ethereum wallet connection (from connectEthereumWallet)
 * @param l2Wallet - Azguard wallet instance (from connectAztecWallet)
 * @returns Flow clients state and controls
 *
 * @example
 * ```tsx
 * function DepositButton() {
 *   const [l1Connection] = createSignal(ethereumConnection);
 *   const [l2Wallet] = createSignal(azguardWallet);
 *
 *   const { status, clients, error } = useFlowClients(
 *     () => l1Connection(),
 *     () => l2Wallet()
 *   );
 *
 *   const handleDeposit = async () => {
 *     if (status() !== "ready" || !clients()) return;
 *
 *     const { l1, l2 } = clients()!;
 *     await executeDepositFlow(l1, l1Addresses, l2, config);
 *   };
 *
 *   return (
 *     <button
 *       disabled={status() !== "ready"}
 *       onClick={handleDeposit}
 *     >
 *       {status() === "initializing" ? "Initializing..." : "Deposit"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useFlowClients(
  l1Connection: Accessor<EthereumWalletConnection | null>,
  l2Wallet: Accessor<AzguardWallet | null>
): UseFlowClientsResult {
  const appState = useAppState();

  const [status, setStatus] = createSignal<FlowClientsStatus>("disconnected");
  const [clients, setClients] = createSignal<FlowClients | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Track whether both wallets are connected
  const bothConnected = createMemo(() => {
    const l1 = l1Connection();
    const l2 = l2Wallet();
    return l1 !== null && l2 !== null;
  });

  // Track the L2 wrapper address from app state
  const l2WrapperAddress = createMemo(() => appState.contracts.l2Wrapper);

  /**
   * Initialize all flow clients.
   * Handles race conditions by checking version before setting state.
   */
  async function initializeClients(): Promise<void> {
    const l1 = l1Connection();
    const l2 = l2Wallet();
    const wrapperAddress = l2WrapperAddress();

    // Validate prerequisites
    if (!l1 || !l2) {
      setStatus("disconnected");
      setClients(null);
      setError(null);
      return;
    }

    if (!wrapperAddress) {
      setStatus("error");
      setError("L2 wrapper contract address not available");
      return;
    }

    // Increment version to invalidate any in-flight initializations
    const currentVersion = ++initializationVersion;

    setStatus("initializing");
    setError(null);

    try {
      // Initialize L1 clients
      const l1Clients = await initializeL1Clients(l1);

      // Check for stale initialization
      if (currentVersion !== initializationVersion) {
        return; // Wallet changed during initialization
      }

      // Initialize L2 clients
      const l2Context = await initializeL2Context(l2, wrapperAddress);

      // Check for stale initialization again
      if (currentVersion !== initializationVersion) {
        return; // Wallet changed during initialization
      }

      setClients({
        l1: l1Clients,
        l2: l2Context,
      });
      setStatus("ready");
    } catch (err) {
      // Only set error if this initialization is still current
      if (currentVersion === initializationVersion) {
        const message = err instanceof Error ? err.message : "Failed to initialize clients";
        setError(message);
        setStatus("error");
        setClients(null);
      }
    }
  }

  /**
   * Initialize L1 clients from wallet connection.
   */
  async function initializeL1Clients(connection: EthereumWalletConnection): Promise<L1Clients> {
    const { publicClient, walletClient } = connection;

    // Create relayer wallet for L1 operations that don't reveal user identity
    const relayerWallet = createL1WalletClient({
      privateKey: DevnetAccounts.relayer,
    });

    return {
      publicClient,
      userWallet: walletClient as WalletClient<Transport, Chain, Account>,
      relayerWallet,
    };
  }

  /**
   * Initialize L2 context from Azguard wallet.
   */
  async function initializeL2Context(
    wallet: AzguardWallet,
    wrapperAddress: string
  ): Promise<FlowL2Context> {
    // Create node client (don't wait - we'll wait separately)
    const node = await createL2NodeClientNoWait();

    // Wait for node to be ready
    await waitForL2Node(node);

    // Load the contract with Azguard wallet
    const { contract } = await loadContractWithAzguard(wallet, wrapperAddress);

    // Get the user's L2 address from the wallet
    const accounts = await wallet.getAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found in Azguard wallet");
    }

    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const account = accounts[0] as { alias: string; item: { toString(): string } };
    const userAddress = AztecAddress.fromString(account.item.toString());

    return {
      node,
      wallet: { address: userAddress },
      contract,
    };
  }

  // Effect: Initialize clients when wallets connect or wrapper address changes
  createEffect(
    on(
      [bothConnected, l2WrapperAddress],
      ([connected, wrapper]) => {
        if (connected && wrapper) {
          initializeClients();
        } else if (!connected) {
          // Reset state when disconnected
          setStatus("disconnected");
          setClients(null);
          setError(null);
        }
      },
      { defer: true }
    )
  );

  // Effect: Detect wallet reconnection and reinitialize
  createEffect(
    on(
      [l1Connection, l2Wallet],
      () => {
        // If we were ready and wallets changed, reinitialize
        if (status() === "ready" && bothConnected()) {
          initializeClients();
        }
      },
      { defer: true }
    )
  );

  // Cleanup: Invalidate any in-flight initializations
  onCleanup(() => {
    initializationVersion++;
  });

  /**
   * Refresh wallet balances from L1.
   * Queries ETH, USDC, and aToken balances for the connected L1 wallet.
   * Safe to call during ongoing operations - uses read-only queries.
   */
  async function refreshBalances(): Promise<void> {
    const flowClients = clients();
    const l1 = l1Connection();

    if (!flowClients || !l1) {
      return; // No clients available, nothing to refresh
    }

    const { publicClient } = flowClients.l1;
    const userAddress = l1.address;
    const { mockUsdc } = appState.contracts;

    try {
      // Query ETH balance
      const ethBalance = await publicClient.getBalance({ address: userAddress });
      setEthBalance(ethBalance.toString());

      // Query token balances only if contract addresses are available
      if (mockUsdc) {
        const usdcBalance = await balanceOf(publicClient, mockUsdc, userAddress);
        setUsdcBalance(usdcBalance.toString());
        // In MVP, aToken uses same address as USDC (mock lending pool doesn't
        // issue separate aTokens). In production, query actual aToken contract.
        setATokenBalance(usdcBalance.toString());
      }
    } catch (err) {
      // Balance refresh failures are non-critical - log but don't throw
      console.warn("Failed to refresh balances:", err);
    }
  }

  return {
    status,
    clients,
    error,
    reinitialize: initializeClients,
    refreshBalances,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if flow clients are ready for operations
 */
export function isFlowClientsReady(result: UseFlowClientsResult): boolean {
  return result.status() === "ready" && result.clients() !== null;
}

/**
 * Get flow clients or throw if not ready
 */
export function getFlowClientsOrThrow(result: UseFlowClientsResult): FlowClients {
  if (result.status() !== "ready") {
    throw new Error(`Flow clients not ready: ${result.status()}`);
  }

  const flowClients = result.clients();
  if (!flowClients) {
    throw new Error("Flow clients are null despite ready status");
  }

  return flowClients;
}
