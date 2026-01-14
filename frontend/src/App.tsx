/**
 * Main Application Component
 *
 * Assembles all components into main application layout.
 * AppProvider context is provided at the entry point (index.tsx).
 */

import type { Component } from "solid-js";
import { createSignal } from "solid-js";
import { ContractDeployment } from "./components/ContractDeployment";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type LogEntry, LogLevel, LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import type { Position } from "./components/PositionCard";
import { PositionStatus } from "./components/PositionCard";
import { PositionsList } from "./components/PositionsList";
import { TopBar } from "./components/TopBar";

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
    <>
      {/* Fixed TopBar */}
      <TopBar />

      {/* Main content with top padding for fixed header */}
      <main class="pt-12 pb-8 min-h-screen bg-zinc-950">
        <div class="container mx-auto max-w-4xl px-4 space-y-6">
          {/* Hero section */}
          <section class="text-center py-6">
            <h1 class="text-2xl font-semibold tracking-tight text-zinc-100">
              Privacy-Preserving Lending
            </h1>
            <p class="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
              Deposit into Aave V3 from Aztec L2 while keeping your identity private
            </p>
          </section>

          {/* Contract Deployment */}
          <ErrorBoundary>
            <ContractDeployment />
          </ErrorBoundary>

          {/* Main Operations */}
          <ErrorBoundary>
            <OperationTabs
              defaultTab="deposit"
              onDeposit={handleDeposit}
              onWithdraw={handleWithdraw}
            />
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
      </main>
    </>
  );
};

export default App;
