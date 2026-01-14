/**
 * Main Application Component
 *
 * Assembles all components into main application layout.
 * AppProvider context is provided at the entry point (index.tsx).
 */

import type { Component } from "solid-js";
import { createSignal } from "solid-js";
import { ConnectionStatusBar } from "./components/ConnectionStatusBar";
import { ContractDeployment } from "./components/ContractDeployment";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type LogEntry, LogLevel, LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import type { Position } from "./components/PositionCard";
import { PositionStatus } from "./components/PositionCard";
import { PositionsList } from "./components/PositionsList";
import { WalletInfo } from "./components/WalletInfo";

/**
 * Main application component
 */
const App: Component = () => {
  // Positions state - would typically come from store or data fetching
  const [positions, setPositions] = createSignal<Position[]>([]);
  const [logs, setLogs] = createSignal<LogEntry[]>([]);

  /**
   * Add a log entry
   */
  const addLog = (message: string, level: LogLevel = LogLevel.INFO) => {
    setLogs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        message,
        level,
      },
    ]);
  };

  /**
   * Format bigint amount to display string (6 decimals for USDC)
   * Uses bigint arithmetic to avoid precision loss
   */
  const formatAmount = (amount: bigint): string => {
    const wholePart = amount / 1_000_000n;
    const decimalPart = amount % 1_000_000n;
    const decimalStr = decimalPart.toString().padStart(6, "0").slice(0, 2);
    return `${wholePart}.${decimalStr}`;
  };

  /**
   * Handle deposit operation
   */
  const handleDeposit = (amount: bigint, deadline: number) => {
    // Format amount for display using bigint arithmetic to avoid precision loss
    const amountFormatted = formatAmount(amount);
    addLog(`Initiating deposit of ${amountFormatted} USDC with ${deadline}s deadline`);
    // Generate unique intent ID using crypto.randomUUID for uniqueness
    const intentId = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    setPositions((prev) => [
      ...prev,
      {
        intentId,
        shares: amount,
        status: PositionStatus.PENDING_DEPOSIT,
      },
    ]);
    addLog(`Created deposit intent: ${intentId}`, LogLevel.SUCCESS);
  };

  /**
   * Handle withdraw operation
   */
  const handleWithdraw = (intentId: string) => {
    addLog(`Initiating withdrawal for position: ${intentId}`);
    // Update position status
    setPositions((prev) =>
      prev.map((p) =>
        p.intentId === intentId ? { ...p, status: PositionStatus.PENDING_WITHDRAW } : p
      )
    );
    addLog(`Withdrawal request submitted`, LogLevel.SUCCESS);
  };

  return (
    <div class="container mx-auto max-w-4xl p-4 space-y-6">
      {/* Header */}
      <header class="text-center py-4">
        <h1 class="text-2xl font-bold">Aztec Aave Wrapper</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Privacy-preserving Aave lending from Aztec L2
        </p>
      </header>

      {/* Connection Status */}
      <ErrorBoundary>
        <ConnectionStatusBar />
      </ErrorBoundary>

      {/* Wallet Info */}
      <ErrorBoundary>
        <WalletInfo />
      </ErrorBoundary>

      {/* Contract Deployment */}
      <ErrorBoundary>
        <ContractDeployment />
      </ErrorBoundary>

      {/* Main Operations */}
      <ErrorBoundary>
        <OperationTabs defaultTab="deposit" onDeposit={handleDeposit} onWithdraw={handleWithdraw} />
      </ErrorBoundary>

      {/* Positions */}
      <ErrorBoundary>
        <PositionsList positions={positions()} onWithdraw={handleWithdraw} />
      </ErrorBoundary>

      {/* Logs */}
      <ErrorBoundary>
        <LogViewer logs={logs()} title="Operation Logs" maxHeight={300} />
      </ErrorBoundary>
    </div>
  );
};

export default App;
