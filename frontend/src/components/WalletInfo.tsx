/**
 * Wallet Info Component
 *
 * Dual wallet connection panel for L1 (Ethereum) and L2 (Aztec).
 * Displays wallet addresses, balances, and connection controls.
 */

import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { createL1PublicClient } from "../services/l1/client.js";
import { balanceOf } from "../services/l1/tokens.js";
import {
  type AztecWalletConnection,
  connectAztecWallet,
  disconnectAztecWallet,
  onAztecWalletDisconnected,
  truncateAztecAddress,
} from "../services/wallet/aztec.js";
import {
  connectEthereumWallet,
  type EthereumWalletConnection,
  formatEthBalance,
  getEthBalance,
  hasInjectedProvider,
  isCorrectChain,
  onAccountsChanged,
  onChainChanged,
  switchToAnvil,
} from "../services/wallet/ethereum.js";
import { useApp } from "../store/hooks.js";
import { formatUSDCFromString } from "../types/state.js";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/**
 * Truncate an Ethereum address for display
 */
function truncateEthAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Connection status indicator dot
 */
function StatusDot(props: { connected: boolean }) {
  return (
    <span
      class={`inline-block w-2 h-2 rounded-full ${
        props.connected ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" : "bg-zinc-400"
      }`}
    />
  );
}

/**
 * WalletInfo displays dual wallet connection panels.
 *
 * Features:
 * - L1 (Ethereum) wallet connection via MetaMask
 * - L2 (Aztec) wallet connection via test accounts
 * - ETH, USDC, and aToken balance display
 * - Chain validation with switch network prompt
 * - Event listeners for account/chain changes
 */
export function WalletInfo() {
  const { state, actions } = useApp();

  // Connection state
  const [l1Connecting, setL1Connecting] = createSignal(false);
  const [l2Connecting, setL2Connecting] = createSignal(false);
  const [l1Error, setL1Error] = createSignal<string | null>(null);
  const [l2Error, setL2Error] = createSignal<string | null>(null);
  const [wrongChain, setWrongChain] = createSignal(false);

  // Store wallet instances for balance queries
  let ethConnection: EthereumWalletConnection | null = null;
  let aztecConnection: AztecWalletConnection | null = null;

  // Cleanup event listeners
  let cleanupAccountsChanged: (() => void) | null = null;
  let cleanupChainChanged: (() => void) | null = null;

  onCleanup(() => {
    cleanupAccountsChanged?.();
    cleanupChainChanged?.();
  });

  /**
   * Check if L1 wallet is connected
   */
  const l1Connected = () => state.wallet.l1Address !== null;

  /**
   * Check if L2 wallet is connected
   */
  const l2Connected = () => state.wallet.l2Address !== null;

  /**
   * Both wallets connected
   */
  const bothConnected = () => l1Connected() && l2Connected();

  /**
   * Refresh L1 balances (ETH and USDC)
   */
  const refreshL1Balances = async () => {
    if (!ethConnection || !state.wallet.l1Address) return;

    try {
      // Get ETH balance
      const ethBal = await getEthBalance(ethConnection.publicClient, state.wallet.l1Address);
      actions.setEthBalance(ethBal.toString());

      // Get USDC balance if contracts are deployed
      if (state.contracts.mockUsdc) {
        const publicClient = createL1PublicClient();
        const usdcBal = await balanceOf(
          publicClient,
          state.contracts.mockUsdc,
          state.wallet.l1Address
        );
        actions.setUsdcBalance(usdcBal.toString());
      }
    } catch (err) {
      console.error("Failed to refresh L1 balances:", err);
    }
  };

  /**
   * Handle L1 wallet connection
   */
  const handleConnectL1 = async () => {
    if (!hasInjectedProvider()) {
      setL1Error("Please install MetaMask or another Ethereum wallet");
      return;
    }

    setL1Connecting(true);
    setL1Error(null);

    try {
      const connection = await connectEthereumWallet();
      ethConnection = connection;

      // Check if on correct chain
      if (!isCorrectChain(connection.chainId)) {
        setWrongChain(true);
        // Still set address but show warning
        actions.setWallet({ l1Address: connection.address });
        return;
      }

      setWrongChain(false);
      actions.setWallet({ l1Address: connection.address });

      // Fetch initial ETH balance
      const ethBal = await getEthBalance(connection.publicClient, connection.address);
      actions.setEthBalance(ethBal.toString());

      // Setup event listeners
      cleanupAccountsChanged = onAccountsChanged((accounts) => {
        if (accounts.length === 0) {
          handleDisconnectL1();
        } else {
          actions.setWallet({ l1Address: accounts[0] });
          refreshL1Balances();
        }
      });

      cleanupChainChanged = onChainChanged((chainIdHex) => {
        const chainId = parseInt(chainIdHex, 16);
        setWrongChain(!isCorrectChain(chainId));
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setL1Error(message);
    } finally {
      setL1Connecting(false);
    }
  };

  /**
   * Handle L1 wallet disconnection
   */
  const handleDisconnectL1 = () => {
    ethConnection = null;
    cleanupAccountsChanged?.();
    cleanupChainChanged?.();
    cleanupAccountsChanged = null;
    cleanupChainChanged = null;
    setWrongChain(false);
    actions.setWallet({
      l1Address: null,
      ethBalance: "0",
      usdcBalance: "0",
      aTokenBalance: "0",
    });
  };

  /**
   * Handle switch to Anvil chain
   */
  const handleSwitchChain = async () => {
    try {
      await switchToAnvil();
      setWrongChain(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to switch network";
      setL1Error(message);
    }
  };

  /**
   * Handle L2 wallet connection via Azguard
   */
  const handleConnectL2 = async () => {
    setL2Connecting(true);
    setL2Error(null);

    try {
      const connection = await connectAztecWallet();
      aztecConnection = connection;

      // Set up disconnect handler
      onAztecWalletDisconnected(connection.wallet, () => {
        aztecConnection = null;
        actions.setWallet({ l2Address: null });
      });

      actions.setWallet({ l2Address: connection.address });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect Azguard wallet";
      setL2Error(message);
    } finally {
      setL2Connecting(false);
    }
  };

  /**
   * Handle L2 wallet disconnection
   */
  const handleDisconnectL2 = async () => {
    if (aztecConnection?.wallet) {
      await disconnectAztecWallet(aztecConnection.wallet);
    }
    aztecConnection = null;
    actions.setWallet({ l2Address: null });
  };

  // Refresh balances when contracts are loaded
  createEffect(
    on(
      () => state.contracts.mockUsdc,
      () => {
        if (l1Connected() && state.contracts.mockUsdc) {
          refreshL1Balances();
        }
      }
    )
  );

  return (
    <Card>
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-lg">Wallets</CardTitle>
          <Show when={bothConnected()}>
            <Badge variant="default" class="bg-emerald-600 hover:bg-emerald-700">
              Ready
            </Badge>
          </Show>
        </div>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* L1 Wallet Section */}
          <div class="space-y-3 p-3 rounded-lg bg-secondary/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <StatusDot connected={l1Connected()} />
                <span class="text-sm font-medium">Ethereum (L1)</span>
              </div>
              <Show when={l1Connected()}>
                <button
                  type="button"
                  onClick={handleDisconnectL1}
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Disconnect
                </button>
              </Show>
            </div>

            <Show when={l1Error()}>
              <p class="text-xs text-destructive">{l1Error()}</p>
            </Show>

            <Show when={wrongChain()}>
              <div class="space-y-2">
                <p class="text-xs text-amber-600">Wrong network. Switch to Anvil (31337)</p>
                <Button size="sm" variant="outline" onClick={handleSwitchChain} class="w-full">
                  Switch Network
                </Button>
              </div>
            </Show>

            <Show
              when={l1Connected()}
              fallback={
                <Button
                  size="sm"
                  onClick={handleConnectL1}
                  disabled={l1Connecting()}
                  class="w-full"
                >
                  {l1Connecting() ? "Connecting..." : "Connect MetaMask"}
                </Button>
              }
            >
              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span class="text-muted-foreground">Address</span>
                  <span class="font-mono text-xs" title={state.wallet.l1Address!}>
                    {truncateEthAddress(state.wallet.l1Address!)}
                  </span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-muted-foreground">ETH</span>
                  <span class="font-mono text-xs">
                    {formatEthBalance(BigInt(state.wallet.ethBalance))}
                  </span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-muted-foreground">USDC</span>
                  <span class="font-mono text-xs">
                    {formatUSDCFromString(state.wallet.usdcBalance)}
                  </span>
                </div>
              </div>
            </Show>
          </div>

          {/* L2 Wallet Section */}
          <div class="space-y-3 p-3 rounded-lg bg-secondary/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <StatusDot connected={l2Connected()} />
                <span class="text-sm font-medium">Aztec (L2)</span>
              </div>
              <Show when={l2Connected()}>
                <button
                  type="button"
                  onClick={handleDisconnectL2}
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Disconnect
                </button>
              </Show>
            </div>

            <Show when={l2Error()}>
              <p class="text-xs text-destructive">{l2Error()}</p>
            </Show>

            <Show
              when={l2Connected()}
              fallback={
                <Button
                  size="sm"
                  onClick={handleConnectL2}
                  disabled={l2Connecting()}
                  class="w-full"
                >
                  {l2Connecting() ? "Connecting..." : "Connect Azguard"}
                </Button>
              }
            >
              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span class="text-muted-foreground">Address</span>
                  <span class="font-mono text-xs" title={state.wallet.l2Address!}>
                    {truncateAztecAddress(state.wallet.l2Address!)}
                  </span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-muted-foreground">aUSDC</span>
                  <span class="font-mono text-xs">
                    {formatUSDCFromString(state.wallet.aTokenBalance)}
                  </span>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* Connection requirement notice */}
        <Show when={!bothConnected()}>
          <p class="text-xs text-muted-foreground text-center mt-4">
            Connect both wallets to perform cross-chain operations
          </p>
        </Show>
      </CardContent>
    </Card>
  );
}
