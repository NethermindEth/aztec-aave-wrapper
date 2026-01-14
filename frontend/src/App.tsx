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
import { executeDepositFlow, type DepositL1Addresses, type DepositL2Context } from "./flows/deposit";
import { createDevnetL1Clients } from "./services/l1/client";
import { getAztecOutbox } from "./services/l1/portal";
import { createL2NodeClient } from "./services/l2/client";
import { loadContractWithAzguard } from "./services/l2/contract";
import { connectAztecWallet } from "./services/wallet/aztec";
import { useApp } from "./store/hooks";

/**
 * Main application component
 */
const App: Component = () => {
  const { state } = useApp();

  // Positions state - would typically come from store or data fetching
  const [positions, setPositions] = createSignal<Position[]>([]);
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [isDepositing, setIsDepositing] = createSignal(false);

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
   * Handle deposit operation using the real deposit flow
   */
  const handleDeposit = async (amount: bigint, deadline: number) => {
    // Prevent duplicate submissions
    if (isDepositing()) {
      addLog("Deposit already in progress", LogLevel.WARNING);
      return;
    }

    // Validate contracts are loaded
    if (
      !state.contracts.portal ||
      !state.contracts.mockUsdc ||
      !state.contracts.mockLendingPool ||
      !state.contracts.l2Wrapper
    ) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    // Extract validated contract addresses for type narrowing
    const portal = state.contracts.portal;
    const mockUsdc = state.contracts.mockUsdc;
    const mockLendingPool = state.contracts.mockLendingPool;
    const l2WrapperAddress = state.contracts.l2Wrapper;

    setIsDepositing(true);
    const amountFormatted = formatAmount(amount);
    addLog(`Initiating deposit of ${amountFormatted} USDC with ${deadline}s deadline`);

    try {
      // Initialize L1 clients
      addLog("Connecting to L1...");
      const l1Clients = createDevnetL1Clients();

      // Get mockAztecOutbox from portal contract
      addLog("Fetching portal configuration...");
      const mockAztecOutbox = await getAztecOutbox(l1Clients.publicClient, portal);

      // Build L1 addresses
      // Note: In MVP, mockAToken uses the same address as mockUsdc since mock lending
      // pool doesn't issue separate aTokens. In production, this would be the actual
      // aToken address from Aave.
      const l1Addresses: DepositL1Addresses = {
        portal,
        mockUsdc,
        mockAToken: mockUsdc,
        mockLendingPool,
        mockAztecOutbox,
      };

      // Initialize L2 context
      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectAztecWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = await loadContractWithAzguard(wallet, l2WrapperAddress);

      // Build L2 context - need to parse address
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: DepositL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      // Execute the deposit flow
      addLog("Executing deposit flow...");
      const result = await executeDepositFlow(l1Clients, l1Addresses, l2Context, {
        assetId: 1n, // USDC asset ID
        amount,
        originalDecimals: 6,
        deadlineOffset: deadline,
      });

      // Update UI with result
      setPositions((prev) => [
        ...prev,
        {
          intentId: result.intentId,
          shares: result.shares,
          status: PositionStatus.PENDING_DEPOSIT,
        },
      ]);
      addLog(`Deposit complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Shares received: ${formatAmount(result.shares)}`, LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Deposit failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsDepositing(false);
    }
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
