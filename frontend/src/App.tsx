/**
 * Main Application Component
 *
 * Assembles all components into main application layout.
 * AppProvider context is provided at the entry point (index.tsx).
 *
 * This component is intentionally minimal - all orchestration logic
 * lives in useAppController, making App purely a layout/wiring layer.
 */

import { type Component, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { useAppController } from "./app/controller/useAppController";
import { ClaimPendingBridges } from "./components/ClaimPendingBridges";
import { ContractDeployment } from "./components/ContractDeployment";
import { Hero } from "./components/dashboard/Hero";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FaucetCard } from "./components/FaucetCard";
import { LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import { PositionsList } from "./components/PositionsList";
import { RecoverDeposit } from "./components/RecoverDeposit";
import { TopBar } from "./components/TopBar";
import { WalletBalances } from "./components/WalletBalances";
import { createL1PublicClient } from "./services/l1/client";
import { balanceOf } from "./services/l1/tokens";
import {
  connectEthereumWallet,
  createConnectionForAddress,
  type EthereumWalletConnection,
  isCorrectChain,
  watchAccountChanges,
} from "./services/wallet/ethereum";
import { useApp } from "./store/hooks";

/**
 * Main application component
 */
const App: Component = () => {
  const { state, actions } = useApp();
  const controller = useAppController();

  // L1 clients for FaucetCard
  const [publicClient, setPublicClient] = createSignal<PublicClient<Transport, Chain> | null>(null);
  const [walletClient, setWalletClient] = createSignal<WalletClient<
    Transport,
    Chain,
    Account
  > | null>(null);
  const [ethConnection, setEthConnection] = createSignal<EthereumWalletConnection | null>(null);

  // Initialize L1 public client when L1 is connected
  createEffect(
    on(
      () => state.l1.connected,
      (connected) => {
        if (connected) {
          setPublicClient(createL1PublicClient());
        } else {
          setPublicClient(null);
        }
      }
    )
  );

  // Connect wallet when L1 address is available (wallet connected in TopBar)
  // Only set walletClient if on the correct chain to prevent transaction errors
  createEffect(
    on(
      () => state.wallet.l1Address,
      async (address) => {
        if (address && !ethConnection()) {
          try {
            const connection = await connectEthereumWallet();
            setEthConnection(connection);
            // Only enable write operations if on correct chain
            if (isCorrectChain(connection.chainId)) {
              setWalletClient(connection.walletClient as WalletClient<Transport, Chain, Account>);
            } else {
              console.warn(
                `Wallet on wrong chain (${connection.chainId}). Switch to correct network to use faucet.`
              );
              setWalletClient(null);
            }
          } catch (err) {
            console.warn("Failed to get wallet client for faucet:", err);
          }
        } else if (!address) {
          setEthConnection(null);
          setWalletClient(null);
        }
      }
    )
  );

  // Watch for chain changes and update walletClient accordingly
  onMount(() => {
    const cleanup = watchAccountChanges((account) => {
      if (account.chainId !== undefined) {
        const connection = ethConnection();
        if (connection && account.address) {
          if (isCorrectChain(account.chainId)) {
            // Chain is now correct, create a new connection with updated chain
            const newConnection = createConnectionForAddress(account.address);
            setEthConnection(newConnection);
            setWalletClient(newConnection.walletClient as WalletClient<Transport, Chain, Account>);
          } else {
            // Wrong chain, disable write operations
            setWalletClient(null);
          }
        }
      }
    });

    onCleanup(cleanup);
  });

  /**
   * Refresh L1 USDC balance after faucet claim
   */
  const handleFaucetClaimSuccess = async () => {
    const client = publicClient();
    const userAddress = state.wallet.l1Address;
    const mockUsdc = state.contracts.mockUsdc;

    if (client && userAddress && mockUsdc) {
      try {
        const usdcBalance = await balanceOf(client, mockUsdc, userAddress);
        actions.setUsdcBalance(usdcBalance.toString());
      } catch (err) {
        console.warn("Failed to refresh USDC balance after faucet claim:", err);
      }
    }
  };

  return (
    <>
      {/* Fixed TopBar */}
      <TopBar />

      {/* Main content with top padding for fixed header */}
      <main class="pt-12 pb-8 min-h-screen bg-zinc-950">
        <div class="main-container space-y-6">
          {/* Hero section with portfolio stats */}
          <Hero
            totalValueLocked={controller.derived.totalValueLocked()}
            activePositionCount={controller.derived.activePositionCount()}
            readyClaimsCount={controller.derived.readyClaimsCount()}
          />

          {/* Contract Deployment */}
          <ErrorBoundary>
            <ContractDeployment />
          </ErrorBoundary>

          {/* Token Faucet - Get test tokens */}
          <ErrorBoundary>
            <FaucetCard
              faucetAddress={state.contracts.faucet}
              userAddress={state.wallet.l1Address}
              publicClient={publicClient()}
              walletClient={walletClient()}
              onClaimSuccess={handleFaucetClaimSuccess}
            />
          </ErrorBoundary>

          {/* Wallet Balances - Token holdings across L1/L2 */}
          <ErrorBoundary>
            <WalletBalances
              l1Address={state.wallet.l1Address}
              l2Address={state.wallet.l2Address}
              publicClient={publicClient()}
              mockUsdcAddress={state.contracts.mockUsdc}
              mockLendingPoolAddress={state.contracts.mockLendingPool}
              l2BridgedTokenAddress={state.contracts.l2BridgedToken}
            />
          </ErrorBoundary>

          {/* Main Operations */}
          <ErrorBoundary>
            <OperationTabs
              defaultTab="bridge"
              onBridge={controller.actions.handleBridge}
              onDeposit={controller.actions.handleDeposit}
              onWithdraw={controller.actions.handleWithdraw}
            />
          </ErrorBoundary>

          {/* Pending Bridge Claims */}
          <ErrorBoundary>
            <ClaimPendingBridges
              bridges={controller.bridge.pendingBridges}
              isLoading={controller.bridge.isLoading}
              claimingKey={controller.bridge.claimingKey}
              error={controller.bridge.error}
              walletConnected={!!state.contracts.tokenPortal}
              onClaim={controller.actions.handleClaimBridge}
              onRefresh={controller.actions.handleRefreshBridges}
            />
          </ErrorBoundary>

          {/* Positions */}
          <ErrorBoundary>
            <PositionsList
              onWithdraw={controller.actions.handleWithdraw}
              onCancel={controller.actions.handleCancelDeposit}
              onFinalizeDeposit={controller.actions.handleFinalizeDeposit}
              onClaimRefund={controller.actions.handleClaimRefund}
              onRefresh={controller.actions.handleRefreshPositions}
              isRefreshing={controller.positions.isRefreshing()}
            />
          </ErrorBoundary>

          {/* Recover Stuck Deposits */}
          <ErrorBoundary>
            <RecoverDeposit />
          </ErrorBoundary>

          {/* Logs */}
          <ErrorBoundary>
            <LogViewer logs={controller.logs()} title="Operation Logs" maxHeight={300} />
          </ErrorBoundary>
        </div>
      </main>
    </>
  );
};

export default App;
