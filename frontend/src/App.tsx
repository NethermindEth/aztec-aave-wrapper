/**
 * Main Application Component
 *
 * Assembles all components into main application layout.
 * AppProvider context is provided at the entry point (index.tsx).
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import type { Component } from "solid-js";
import { createSignal } from "solid-js";
import type { Address, Chain, PublicClient, Transport } from "viem";
import { ContractDeployment } from "./components/ContractDeployment";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type LogEntry, LogLevel, LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import { PositionsList } from "./components/PositionsList";
import { TopBar } from "./components/TopBar";
import {
  type DepositL1Addresses,
  type DepositL2Context,
  executeDepositFlow,
} from "./flows/deposit";
import {
  executeWithdrawFlow,
  type WithdrawL1Addresses,
  type WithdrawL2Context,
} from "./flows/withdraw";
import { getPositionStatusLabel, usePositions } from "./hooks/usePositions.js";
import { createL1PublicClient, createL1WalletClient, DevnetAccounts } from "./services/l1/client";
import { getAztecOutbox } from "./services/l1/portal";
import { balanceOf } from "./services/l1/tokens";
import { createL2NodeClient } from "./services/l2/client";
import { loadContractWithAzguard } from "./services/l2/contract";
import { connectAztecWallet } from "./services/wallet/aztec";
import { connectEthereumWallet } from "./services/wallet/ethereum";
import { setATokenBalance, setEthBalance, setUsdcBalance } from "./store";
import { useApp } from "./store/hooks";
import { formatUSDC, toBigIntString } from "./types/state.js";

/**
 * Main application component
 */
const App: Component = () => {
  const { state } = useApp();
  const {
    addNewPosition,
    updatePositionStatus,
    getPosition,
    removePositionById,
    refreshFromL2,
    isRefreshing,
  } = usePositions();

  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [isDepositing, setIsDepositing] = createSignal(false);
  const [isWithdrawing, setIsWithdrawing] = createSignal(false);

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
   * Refresh positions from L2 contract.
   * This fetches the user's private notes (positions) from the L2 Aztec contract.
   */
  const handleRefreshPositions = async () => {
    // Validate contracts are loaded
    if (!state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;

    addLog("Refreshing positions from L2...");

    try {
      // Connect to Aztec wallet
      const { wallet, address: walletAddress } = await connectAztecWallet();

      // Load contract
      const { contract } = await loadContractWithAzguard(wallet, l2WrapperAddress);

      // Refresh positions from L2
      await refreshFromL2(contract, wallet, walletAddress);

      addLog("Positions refreshed from L2", LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to refresh positions: ${message}`, LogLevel.ERROR);
    }
  };

  /**
   * Refresh wallet balances from L1 after operations complete.
   * Non-blocking - failures are logged but don't throw.
   */
  const refreshBalances = async (
    publicClient: PublicClient<Transport, Chain>,
    userAddress: Address,
    mockUsdc: Address | null
  ) => {
    try {
      // Query ETH balance
      const ethBalance = await publicClient.getBalance({ address: userAddress });
      setEthBalance(ethBalance.toString());

      // Query token balances if contract address available
      if (mockUsdc) {
        const usdcBalance = await balanceOf(publicClient, mockUsdc, userAddress);
        setUsdcBalance(usdcBalance.toString());
        // In MVP, aToken balance mirrors USDC balance (mock lending pool)
        setATokenBalance(usdcBalance.toString());
      }
    } catch (error) {
      // Balance refresh is non-critical - log but don't throw
      console.warn("Failed to refresh balances:", error);
    }
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
      // Connect to MetaMask for user wallet
      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      // Create L1 clients with MetaMask user wallet and hardcoded relayer
      const publicClient = createL1PublicClient();
      const relayerWallet = createL1WalletClient({ privateKey: DevnetAccounts.relayer });
      const l1Clients = {
        publicClient,
        userWallet: ethereumConnection.walletClient,
        relayerWallet,
      };

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

      // Update UI with result - add position to store
      // Status is Active because deposit completed successfully (all steps finished)
      addNewPosition({
        intentId: result.intentId,
        assetId: "0x01", // USDC asset ID
        shares: toBigIntString(result.shares),
        sharesFormatted: formatUSDC(result.shares),
        status: IntentStatus.Active,
      });
      addLog(`Deposit complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Shares received: ${formatAmount(result.shares)}`, LogLevel.SUCCESS);

      // Refresh wallet balances after successful deposit
      await refreshBalances(l1Clients.publicClient, l1Clients.userWallet.account.address, mockUsdc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Deposit failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsDepositing(false);
    }
  };

  /**
   * Handle withdraw operation using the real withdraw flow
   */
  const handleWithdraw = async (intentId: string) => {
    // Prevent duplicate submissions
    if (isWithdrawing()) {
      addLog("Withdrawal already in progress", LogLevel.WARNING);
      return;
    }

    // Look up position
    const position = getPosition(intentId);
    if (!position) {
      addLog(`Position not found: ${intentId}`, LogLevel.ERROR);
      return;
    }

    // Validate position is in withdrawable state
    if (position.status !== IntentStatus.Active) {
      addLog(
        `Position is not in Active status (current: ${getPositionStatusLabel(position.status)}). Cannot withdraw.`,
        LogLevel.ERROR
      );
      return;
    }

    // Validate contracts are loaded
    if (!state.contracts.portal || !state.contracts.mockUsdc || !state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    // Extract validated contract addresses for type narrowing
    const portal = state.contracts.portal;
    const l2WrapperAddress = state.contracts.l2Wrapper;

    setIsWithdrawing(true);
    const sharesFormatted = position.sharesFormatted;
    addLog(`Initiating withdrawal for position: ${intentId.slice(0, 16)}...`);
    addLog(`Shares: ${sharesFormatted}`);

    // Update position status to pending
    updatePositionStatus(intentId, IntentStatus.PendingWithdraw);

    try {
      // Connect to MetaMask for user wallet
      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      // Create L1 clients with MetaMask user wallet and hardcoded relayer
      const publicClient = createL1PublicClient();
      const relayerWallet = createL1WalletClient({ privateKey: DevnetAccounts.relayer });
      const l1Clients = {
        publicClient,
        userWallet: ethereumConnection.walletClient,
        relayerWallet,
      };

      // Get mockAztecOutbox from portal contract
      addLog("Fetching portal configuration...");
      const mockAztecOutbox = await getAztecOutbox(l1Clients.publicClient, portal);

      // Build L1 addresses for withdraw (simpler than deposit)
      const l1Addresses: WithdrawL1Addresses = {
        portal,
        mockAztecOutbox,
      };

      // Initialize L2 context
      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectAztecWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = await loadContractWithAzguard(wallet, l2WrapperAddress);

      // Build L2 context
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const { Fr } = await import("@aztec/aztec.js/fields");
      const l2Context: WithdrawL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      // Convert intentId string to Fr for withdraw flow
      const depositIntentId = Fr.fromString(intentId);

      // Execute the withdraw flow
      addLog("Executing withdraw flow...");
      const result = await executeWithdrawFlow(l1Clients, l1Addresses, l2Context, {
        position: {
          depositIntentId,
          shares: position.shares,
        },
        deadlineOffset: 3600, // 1 hour default
      });

      // Remove position from store (full withdrawal consumes it)
      removePositionById(intentId);
      addLog(`Withdrawal complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Amount withdrawn: ${formatAmount(result.amount)}`, LogLevel.SUCCESS);

      // Refresh wallet balances after successful withdrawal
      await refreshBalances(
        l1Clients.publicClient,
        l1Clients.userWallet.account.address,
        state.contracts.mockUsdc
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Withdrawal failed: ${message}`, LogLevel.ERROR);
      // Revert position status on failure
      updatePositionStatus(intentId, IntentStatus.Active);
    } finally {
      setIsWithdrawing(false);
    }
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
            <PositionsList
              onWithdraw={handleWithdraw}
              onRefresh={handleRefreshPositions}
              isRefreshing={isRefreshing()}
            />
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
