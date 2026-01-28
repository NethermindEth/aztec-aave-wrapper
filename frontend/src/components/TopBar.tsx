/**
 * TopBar Component
 *
 * Compact navigation bar with auto-connecting network and wallet status.
 * Terminal-inspired aesthetic with real-time connection indicators.
 */

import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { createL1PublicClient, verifyL1Connection } from "../services/l1/client.js";
import { balanceOf } from "../services/l1/tokens.js";
import {
  type AztecNodeClient,
  createL2NodeClient,
  verifyL2Connection,
} from "../services/l2/client.js";
import {
  connectEthereumWallet,
  createConnectionForAddress,
  disconnectEthereumWallet,
  type EthereumWalletConnection,
  formatEthBalance,
  getEthBalance,
  isCorrectChain,
  switchToAnvil,
  watchAccountChanges,
} from "../services/wallet/ethereum.js";
import {
  type AnyWalletConnection,
  connectWallet,
  disconnectWallet,
  truncateAztecAddress,
} from "../services/wallet/index.js";
import { useApp } from "../store/hooks.js";
import { formatUSDCFromString } from "../types/state.js";

/**
 * Polling interval for block number updates (ms)
 */
const BLOCK_POLL_INTERVAL = 4000;

/**
 * LocalStorage keys for wallet connection persistence
 */
const STORAGE_KEYS = {
  ETH_WALLET_CONNECTED: "aztec-aave:eth-wallet-connected",
  AZTEC_WALLET_CONNECTED: "aztec-aave:aztec-wallet-connected",
} as const;

/**
 * Check if wallet was previously connected
 */
function wasWalletConnected(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/**
 * Save wallet connection state
 */
function saveWalletConnection(key: string, connected: boolean): void {
  try {
    if (connected) {
      localStorage.setItem(key, "true");
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Truncate Ethereum address for display
 */
function truncateEthAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Connection status indicator with pulse animation
 * Uses .network-dot CSS class with state modifiers for consistent styling
 */
function StatusIndicator(props: { status: "connected" | "connecting" | "disconnected" | "error" }) {
  const stateClass = () => {
    switch (props.status) {
      case "connected":
        return "connected";
      case "connecting":
        return "connecting";
      case "error":
        return "error";
      case "disconnected":
        return "disconnected";
      default:
        return "disconnected";
    }
  };

  return <span class={`network-dot ${stateClass()}`} />;
}

/**
 * Block number display with subtle update animation
 */
function BlockDisplay(props: { block: number; label: string }) {
  const [flash, setFlash] = createSignal(false);

  createEffect(
    on(
      () => props.block,
      () => {
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
      },
      { defer: true }
    )
  );

  return (
    <span
      class={`font-mono text-[10px] tabular-nums transition-colors duration-150 ${flash() ? "text-emerald-400" : "text-zinc-500"}`}
    >
      {props.label}:{props.block.toLocaleString()}
    </span>
  );
}

/**
 * TopBar with auto-connect and compact status display
 */
export function TopBar() {
  const { state, actions } = useApp();

  // Connection state
  const [l1Status, setL1Status] = createSignal<
    "connected" | "connecting" | "disconnected" | "error"
  >("disconnected");
  const [l2Status, setL2Status] = createSignal<
    "connected" | "connecting" | "disconnected" | "error"
  >("disconnected");
  const [ethWalletStatus, setEthWalletStatus] = createSignal<
    "connected" | "connecting" | "disconnected" | "error"
  >("disconnected");
  const [aztecWalletStatus, setAztecWalletStatus] = createSignal<
    "connected" | "connecting" | "disconnected" | "error"
  >("disconnected");
  const [wrongChain, setWrongChain] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  // Connection instances
  let l1PollInterval: ReturnType<typeof setInterval> | undefined;
  let l2PollInterval: ReturnType<typeof setInterval> | undefined;
  let nodeClient: AztecNodeClient | undefined;
  let ethConnection: EthereumWalletConnection | null = null;
  let aztecConnection: AnyWalletConnection | null = null;

  // Wallet event cleanup
  let cleanupAccountWatcher: (() => void) | null = null;

  onCleanup(() => {
    if (l1PollInterval) clearInterval(l1PollInterval);
    if (l2PollInterval) clearInterval(l2PollInterval);
    cleanupAccountWatcher?.();
  });

  // ============================================================================
  // Network Auto-Connect
  // ============================================================================

  /**
   * Auto-connect to L1 (Anvil)
   */
  const connectL1 = async () => {
    setL1Status("connecting");
    try {
      const publicClient = createL1PublicClient();
      const chainId = await verifyL1Connection(publicClient);
      const blockNumber = await publicClient.getBlockNumber();

      actions.setL1Connection({
        connected: true,
        chainId,
        blockNumber: Number(blockNumber),
      });
      setL1Status("connected");

      // Start block polling
      l1PollInterval = setInterval(async () => {
        try {
          const block = await publicClient.getBlockNumber();
          actions.setL1BlockNumber(Number(block));
        } catch {
          /* silent */
        }
      }, BLOCK_POLL_INTERVAL);
    } catch {
      setL1Status("error");
      actions.setL1Connection({ connected: false });
    }
  };

  /**
   * Auto-connect to L2 (Aztec)
   */
  const connectL2 = async () => {
    setL2Status("connecting");
    try {
      nodeClient = await createL2NodeClient();
      const nodeInfo = await verifyL2Connection(nodeClient);
      const blockNumber = await nodeClient.getBlockNumber();

      actions.setL2Connection({
        connected: true,
        nodeVersion: nodeInfo.nodeVersion,
        blockNumber,
      });
      setL2Status("connected");

      // Start block polling
      l2PollInterval = setInterval(async () => {
        try {
          if (nodeClient) {
            const block = await nodeClient.getBlockNumber();
            actions.setL2BlockNumber(block);
          }
        } catch {
          /* silent */
        }
      }, BLOCK_POLL_INTERVAL);
    } catch {
      setL2Status("error");
      actions.setL2Connection({ connected: false });
    }
  };

  // ============================================================================
  // Wallet Auto-Connect
  // ============================================================================

  /**
   * Refresh L1 balances
   */
  const refreshL1Balances = async () => {
    if (!ethConnection || !state.wallet.l1Address) return;
    try {
      const ethBal = await getEthBalance(ethConnection.publicClient, state.wallet.l1Address);
      actions.setEthBalance(ethBal.toString());

      if (state.contracts.mockUsdc) {
        const publicClient = createL1PublicClient();
        const usdcBal = await balanceOf(
          publicClient,
          state.contracts.mockUsdc,
          state.wallet.l1Address
        );
        actions.setUsdcBalance(usdcBal.toString());
      }
    } catch {
      /* silent */
    }
  };

  /**
   * Connect Ethereum wallet via Web3Modal
   */
  const connectEthWallet = async () => {
    // Don't start a new connection if already connecting
    if (ethWalletStatus() === "connecting") {
      console.log("Connection already in progress");
      return;
    }

    setEthWalletStatus("connecting");
    try {
      const connection = await connectEthereumWallet();
      ethConnection = connection;

      if (!isCorrectChain(connection.chainId)) {
        setWrongChain(true);
        actions.setWallet({ l1Address: connection.address });
        setEthWalletStatus("connected");
        return;
      }

      setWrongChain(false);
      actions.setWallet({ l1Address: connection.address });

      const ethBal = await getEthBalance(connection.publicClient, connection.address);
      actions.setEthBalance(ethBal.toString());

      // Fetch USDC balance if contracts are already loaded
      if (state.contracts.mockUsdc) {
        refreshL1Balances();
      }

      setEthWalletStatus("connected");
      saveWalletConnection(STORAGE_KEYS.ETH_WALLET_CONNECTED, true);

      // Watch for account changes
      cleanupAccountWatcher = watchAccountChanges(async (account) => {
        if (!account.isConnected || !account.address) {
          disconnectEthWallet();
        } else if (account.address !== state.wallet.l1Address) {
          // Account changed - recreate the connection with new account (no MetaMask prompt)
          console.log("Account changed to:", account.address);
          try {
            const newConnection = createConnectionForAddress(account.address);
            ethConnection = newConnection;
            actions.setWallet({ l1Address: newConnection.address });

            const ethBal = await getEthBalance(newConnection.publicClient, newConnection.address);
            actions.setEthBalance(ethBal.toString());

            if (state.contracts.mockUsdc) {
              const publicClient = createL1PublicClient();
              const usdcBal = await balanceOf(
                publicClient,
                state.contracts.mockUsdc,
                newConnection.address
              );
              actions.setUsdcBalance(usdcBal.toString());
            }
          } catch (err) {
            console.warn("Failed to refresh connection after account change:", err);
          }
        }
        if (account.chainId) {
          setWrongChain(!isCorrectChain(account.chainId));
        }
      });
    } catch (err) {
      console.warn("Wallet connection failed:", err);
      // Show user-friendly error for common issues
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("already in progress")) {
        console.info("Tip: Close any pending MetaMask dialogs and try again");
      }
      setEthWalletStatus("disconnected");
    }
  };

  /**
   * Disconnect Ethereum wallet
   */
  const disconnectEthWallet = async () => {
    cleanupAccountWatcher?.();
    cleanupAccountWatcher = null;
    await disconnectEthereumWallet();
    ethConnection = null;
    setWrongChain(false);
    setEthWalletStatus("disconnected");
    saveWalletConnection(STORAGE_KEYS.ETH_WALLET_CONNECTED, false);
    actions.setWallet({
      l1Address: null,
      ethBalance: "0",
      usdcBalance: "0",
      aTokenBalance: "0",
    });
  };

  /**
   * Auto-connect Aztec wallet (DevWallet in dev mode, Azguard in production)
   */
  const connectAztecWalletAuto = async () => {
    setAztecWalletStatus("connecting");
    try {
      const connection = await connectWallet();
      aztecConnection = connection;

      connection.wallet.onDisconnected.addHandler(() => {
        aztecConnection = null;
        setAztecWalletStatus("disconnected");
        saveWalletConnection(STORAGE_KEYS.AZTEC_WALLET_CONNECTED, false);
        actions.setWallet({ l2Address: null });
      });

      actions.setWallet({ l2Address: connection.address as `0x${string}` });
      setAztecWalletStatus("connected");
      saveWalletConnection(STORAGE_KEYS.AZTEC_WALLET_CONNECTED, true);
    } catch {
      setAztecWalletStatus("error");
      saveWalletConnection(STORAGE_KEYS.AZTEC_WALLET_CONNECTED, false);
    }
  };

  /**
   * Disconnect Aztec wallet
   */
  const disconnectAztecWalletHandler = async () => {
    if (aztecConnection?.wallet) {
      await disconnectWallet(aztecConnection.wallet);
    }
    aztecConnection = null;
    setAztecWalletStatus("disconnected");
    saveWalletConnection(STORAGE_KEYS.AZTEC_WALLET_CONNECTED, false);
    actions.setWallet({ l2Address: null });
  };

  /**
   * Handle chain switch
   */
  const handleSwitchChain = async () => {
    try {
      await switchToAnvil();
      setWrongChain(false);
    } catch {
      /* silent */
    }
  };

  // Refresh balances when contracts or wallet change
  createEffect(
    on(
      () => [state.contracts.mockUsdc, state.wallet.l1Address] as const,
      () => {
        if (ethConnection && state.wallet.l1Address && state.contracts.mockUsdc) {
          refreshL1Balances();
        }
      }
    )
  );

  // Auto-connect networks and wallets on mount
  onMount(() => {
    // Always connect to networks
    connectL1();
    connectL2();

    // Auto-reconnect wallets if previously connected
    if (wasWalletConnected(STORAGE_KEYS.ETH_WALLET_CONNECTED)) {
      connectEthWallet();
    }
    if (wasWalletConnected(STORAGE_KEYS.AZTEC_WALLET_CONNECTED)) {
      connectAztecWalletAuto();
    }
  });

  // Derived state
  const allConnected = () =>
    state.l1.connected && state.l2.connected && state.wallet.l1Address && state.wallet.l2Address;

  return (
    <>
      <header class="header">
        {/* Logo/Title */}
        <div class="logo">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </svg>
          </div>
          <span class="logo-text">Aztec Aave</span>
        </div>

        {/* Status indicators */}
        <div class="header-right">
          {/* Network status */}
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5" title={`L1 Anvil - Chain ${state.l1.chainId}`}>
              <StatusIndicator status={l1Status()} />
              <span class="text-[10px] text-zinc-500 uppercase tracking-wider">L1</span>
              <Show when={state.l1.connected}>
                <BlockDisplay block={state.l1.blockNumber} label="#" />
              </Show>
            </div>

            <div class="w-px h-3 bg-zinc-700" />

            <div
              class="flex items-center gap-1.5"
              title={`L2 Aztec - ${state.l2.nodeVersion || "connecting"}`}
            >
              <StatusIndicator status={l2Status()} />
              <span class="text-[10px] text-zinc-500 uppercase tracking-wider">L2</span>
              <Show when={state.l2.connected}>
                <BlockDisplay block={state.l2.blockNumber} label="#" />
              </Show>
            </div>
          </div>

          <div class="w-px h-4 bg-zinc-700" />

          {/* Wallet status */}
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (state.wallet.l1Address ? disconnectEthWallet() : connectEthWallet())}
              class={`btn-wallet ${state.wallet.l1Address ? "connected" : ""}`}
              title={state.wallet.l1Address || "Click to connect Ethereum wallet"}
            >
              <StatusIndicator status={ethWalletStatus()} />
              <Show
                when={state.wallet.l1Address}
                fallback={
                  <span>
                    {ethWalletStatus() === "connecting" ? "Connecting..." : "Connect ETH"}
                  </span>
                }
              >
                <span class="font-mono">{truncateEthAddress(state.wallet.l1Address!)}</span>
              </Show>
            </button>

            <button
              type="button"
              onClick={() =>
                state.wallet.l2Address ? disconnectAztecWalletHandler() : connectAztecWalletAuto()
              }
              class={`btn-wallet ${state.wallet.l2Address ? "connected" : ""}`}
              title={state.wallet.l2Address || "Click to connect Aztec wallet"}
            >
              <StatusIndicator status={aztecWalletStatus()} />
              <Show
                when={state.wallet.l2Address}
                fallback={
                  <span>
                    {aztecWalletStatus() === "connecting" ? "Connecting..." : "Connect Aztec"}
                  </span>
                }
              >
                <span class="font-mono">{truncateAztecAddress(state.wallet.l2Address!)}</span>
              </Show>
            </button>
          </div>

          {/* Expand/collapse button */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded())}
            class="p-1 rounded hover:bg-zinc-800/50 transition-colors"
            title="Toggle details"
          >
            <svg
              class={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${expanded() ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* Expanded details panel */}
      <Show when={expanded()}>
        <div class="header-expanded px-3 py-3">
          <div class="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px]">
            {/* L1 Details */}
            <div class="space-y-1.5">
              <div class="text-zinc-500 uppercase tracking-wider text-[9px] font-medium">
                L1 Ethereum
              </div>
              <div class="flex justify-between">
                <span class="text-zinc-500">Chain</span>
                <span class="font-mono text-zinc-300">{state.l1.chainId || "—"}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-zinc-500">Block</span>
                <span class="font-mono text-zinc-300">
                  {state.l1.blockNumber.toLocaleString() || "—"}
                </span>
              </div>
            </div>

            {/* L2 Details */}
            <div class="space-y-1.5">
              <div class="text-zinc-500 uppercase tracking-wider text-[9px] font-medium">
                L2 Aztec
              </div>
              <div class="flex justify-between">
                <span class="text-zinc-500">Version</span>
                <span
                  class="font-mono text-zinc-300 truncate max-w-[100px]"
                  title={state.l2.nodeVersion}
                >
                  {state.l2.nodeVersion?.slice(0, 12) || "—"}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-zinc-500">Block</span>
                <span class="font-mono text-zinc-300">
                  {state.l2.blockNumber.toLocaleString() || "—"}
                </span>
              </div>
            </div>

            {/* ETH Wallet Details */}
            <div class="space-y-1.5">
              <div class="text-zinc-500 uppercase tracking-wider text-[9px] font-medium">
                ETH Wallet
              </div>
              <Show
                when={state.wallet.l1Address}
                fallback={<span class="text-zinc-600 italic">Not connected</span>}
              >
                <div class="flex justify-between">
                  <span class="text-zinc-500">ETH</span>
                  <span class="font-mono text-zinc-300">
                    {formatEthBalance(BigInt(state.wallet.ethBalance))}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-zinc-500">USDC</span>
                  <span class="font-mono text-zinc-300">
                    {formatUSDCFromString(state.wallet.usdcBalance)}
                  </span>
                </div>
              </Show>
              <Show when={wrongChain()}>
                <button
                  type="button"
                  onClick={handleSwitchChain}
                  class="text-amber-500 hover:text-amber-400 text-[10px] underline underline-offset-2"
                >
                  Switch to Anvil
                </button>
              </Show>
            </div>

            {/* Aztec Wallet Details */}
            <div class="space-y-1.5">
              <div class="text-zinc-500 uppercase tracking-wider text-[9px] font-medium">
                Aztec Wallet
              </div>
              <Show
                when={state.wallet.l2Address}
                fallback={<span class="text-zinc-600 italic">Not connected</span>}
              >
                <div class="flex justify-between">
                  <span class="text-zinc-500">aUSDC</span>
                  <span class="font-mono text-zinc-300">
                    {formatUSDCFromString(state.wallet.aTokenBalance)}
                  </span>
                </div>
                <div
                  class="text-zinc-600 font-mono text-[9px] truncate"
                  title={state.wallet.l2Address!}
                >
                  {state.wallet.l2Address}
                </div>
              </Show>
            </div>
          </div>

          {/* All systems status */}
          <div class="mt-3 pt-2 border-t border-zinc-800/30 flex justify-center">
            <Show
              when={allConnected()}
              fallback={
                <span class="text-[10px] text-zinc-500 flex items-center gap-1.5">
                  <span class="inline-block w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                  Connecting to networks...
                </span>
              }
            >
              <span class="text-[10px] text-emerald-500/80 flex items-center gap-1.5">
                <span class="inline-block w-1 h-1 rounded-full bg-emerald-500" />
                All systems operational
              </span>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}
