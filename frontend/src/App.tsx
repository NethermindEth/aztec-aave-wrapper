/**
 * Main Application Component
 *
 * Assembles all components into main application layout.
 * AppProvider context is provided at the entry point (index.tsx).
 *
 * This component is intentionally minimal - all orchestration logic
 * lives in useAppController, making App purely a layout/wiring layer.
 */

import type { Component } from "solid-js";
import { useAppController } from "./app/controller/useAppController";
import { ClaimPendingBridges } from "./components/ClaimPendingBridges";
import { ContractDeployment } from "./components/ContractDeployment";
import { Hero } from "./components/dashboard/Hero";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import { PositionsList } from "./components/PositionsList";
import { RecoverDeposit } from "./components/RecoverDeposit";
import { TopBar } from "./components/TopBar";
import { useApp } from "./store/hooks";

/**
 * Main application component
 */
const App: Component = () => {
  const { state } = useApp();
  const controller = useAppController();

  return (
    <>
      {/* Fixed TopBar */}
      <TopBar />

      {/* Main content with top padding for fixed header */}
      <main class="pt-12 pb-8 min-h-screen bg-zinc-950">
        <div class="container mx-auto max-w-4xl px-4 space-y-6">
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

          {/* Main Operations */}
          <ErrorBoundary>
            <OperationTabs
              defaultTab="deposit"
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
