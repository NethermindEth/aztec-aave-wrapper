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
import {
  type CancelL2Context,
  executeCancelDeposit,
} from "./flows/cancel";
import {
  executeClaimRefundFlow,
  type RefundL2Context,
} from "./flows/refund";
import {
  type BridgeL1Addresses,
  type BridgeL2Context,
  executeBridgeFlow,
} from "./flows/bridge";
import { getPositionStatusLabel, usePositions } from "./hooks/usePositions.js";
import { createL1PublicClient, createL1WalletClient, DevnetAccounts } from "./services/l1/client";
import { getAztecOutbox } from "./services/l1/portal";
import { balanceOf } from "./services/l1/tokens";
import { createL2NodeClient } from "./services/l2/client";
import { loadContractWithAzguard } from "./services/l2/contract";
import { loadBridgedTokenWithAzguard } from "./services/l2/bridgedToken";
import { connectAztecWallet } from "./services/wallet/aztec";
import { connectEthereumWallet } from "./services/wallet/ethereum";
import { setATokenBalance, setEthBalance, setL2UsdcBalance, setUsdcBalance } from "./store";
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
  const [isBridging, setIsBridging] = createSignal(false);
  const [isDepositing, setIsDepositing] = createSignal(false);
  const [isWithdrawing, setIsWithdrawing] = createSignal(false);
  const [isCancelling, setIsCancelling] = createSignal(false);
  const [isClaimingRefund, setIsClaimingRefund] = createSignal(false);

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
   * Handle bridge operation to transfer USDC from L1 to L2.
   * This is a prerequisite for privacy-preserving deposits.
   */
  const handleBridge = async (amount: bigint) => {
    // Prevent duplicate submissions
    if (isBridging()) {
      addLog("Bridge already in progress", LogLevel.WARNING);
      return;
    }

    // Validate contracts are loaded
    if (!state.contracts.tokenPortal || !state.contracts.mockUsdc) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    // Extract validated contract addresses for type narrowing
    const tokenPortal = state.contracts.tokenPortal;
    const mockUsdc = state.contracts.mockUsdc;

    setIsBridging(true);
    const amountFormatted = formatAmount(amount);
    addLog(`Initiating bridge of ${amountFormatted} USDC from L1 to L2`);

    try {
      // Connect to MetaMask for user wallet
      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      // Create L1 clients with MetaMask user wallet
      const publicClient = createL1PublicClient();
      const l1Clients = {
        publicClient,
        userWallet: ethereumConnection.walletClient,
        relayerWallet: ethereumConnection.walletClient, // Bridge doesn't need separate relayer
      };

      // Build L1 addresses for bridge
      const l1Addresses: BridgeL1Addresses = {
        tokenPortal,
        mockUsdc,
      };

      // Initialize L2 context
      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectAztecWallet();

      // Load BridgedToken contract for L2 claiming
      // Note: In MVP, we use the AaveWrapper address as a placeholder since
      // BridgedToken address isn't in deployments. The bridge flow handles
      // the L2 claim step gracefully if it fails.
      addLog("Loading BridgedToken contract...");
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");

      // For now, we need to get the BridgedToken address. In devnet, it should be
      // deployed and linked to the AaveWrapper. We'll try to load it from the wallet.
      // If not available, the bridge will still work but L2 claim may fail.
      let bridgedTokenContract;
      try {
        // Try to load BridgedToken - in production this would come from deployments
        // For MVP, we'll skip the L2 claim if BridgedToken isn't available
        const wrapperContract = await loadContractWithAzguard(wallet, state.contracts.l2Wrapper!);
        // Try to get bridged_token address from wrapper contract
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const methods = wrapperContract.contract.methods as any;
        const bridgedTokenAddress = await methods.get_bridged_token().simulate();
        const { contract } = await loadBridgedTokenWithAzguard(wallet, bridgedTokenAddress.toString());
        bridgedTokenContract = contract;
        addLog("BridgedToken contract loaded");
      } catch {
        addLog("BridgedToken contract not available - L2 claim will be skipped", LogLevel.WARNING);
        // Create a minimal placeholder - the bridge flow will handle this gracefully
        bridgedTokenContract = null;
      }

      // Build L2 context
      const l2Context: BridgeL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        bridgedTokenContract: bridgedTokenContract as BridgeL2Context["bridgedTokenContract"],
      };

      // Execute the bridge flow
      addLog("Executing bridge flow...");
      const result = await executeBridgeFlow(l1Clients, l1Addresses, l2Context, {
        amount,
      });

      addLog(`Bridge complete! Message key: ${result.messageKey.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Amount bridged: ${formatAmount(result.amount)}`, LogLevel.SUCCESS);
      if (result.claimed) {
        addLog("L2 tokens claimed successfully", LogLevel.SUCCESS);
      } else {
        addLog("L2 tokens can be claimed later", LogLevel.WARNING);
      }

      // Refresh L1 balances after bridge
      await refreshBalances(publicClient, ethereumConnection.address, mockUsdc);

      // Update L2 USDC balance if claim was successful
      if (result.claimed && bridgedTokenContract) {
        try {
          const { getBalance } = await import("./services/l2/bridgedToken");
          const l2Balance = await getBalance(bridgedTokenContract, AztecAddress.fromString(walletAddress));
          setL2UsdcBalance(l2Balance.toString());
        } catch {
          // Non-critical - L2 balance refresh is optional
          console.warn("Failed to refresh L2 USDC balance");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Bridge failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsBridging(false);
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

  /**
   * Handle cancel deposit operation for expired pending deposits.
   * Allows users to reclaim their tokens when deadline passes without L1 execution.
   */
  const handleCancelDeposit = async (intentId: string, deadline: bigint, netAmount: bigint) => {
    // Prevent duplicate submissions
    if (isCancelling()) {
      addLog("Cancellation already in progress", LogLevel.WARNING);
      return;
    }

    // Validate contracts are loaded
    if (!state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;

    setIsCancelling(true);
    addLog(`Initiating cancel for deposit: ${intentId.slice(0, 16)}...`);
    addLog(`Net amount to refund: ${formatAmount(netAmount)} USDC`);

    try {
      // Create L1 public client for timestamp queries
      const publicClient = createL1PublicClient();

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
      const l2Context: CancelL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      // Convert intentId string to Fr for cancel flow
      const depositIntentId = Fr.fromString(intentId);

      // Execute the cancel deposit flow
      addLog("Executing cancel deposit flow...");
      const result = await executeCancelDeposit(publicClient, l2Context, {
        pendingDeposit: {
          intentId: depositIntentId,
          deadline,
          netAmount,
        },
      });

      // Position is removed by the cancel flow via store action
      addLog(`Cancel complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Refunded: ${formatAmount(result.refundedAmount)} USDC`, LogLevel.SUCCESS);

      // Refresh wallet balances after successful cancel
      const mockUsdc = state.contracts.mockUsdc;
      if (mockUsdc) {
        const { walletClient: ethWallet } = await connectEthereumWallet();
        await refreshBalances(publicClient, ethWallet.account.address, mockUsdc);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Cancel failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsCancelling(false);
    }
  };

  /**
   * Handle claim refund operation for expired pending withdrawals.
   * Allows users to restore their position when L1 execution doesn't happen before deadline.
   */
  const handleClaimRefund = async (
    intentId: string,
    deadline: bigint,
    shares: bigint,
    assetId: string
  ) => {
    // Prevent duplicate submissions
    if (isClaimingRefund()) {
      addLog("Refund claim already in progress", LogLevel.WARNING);
      return;
    }

    // Validate contracts are loaded
    if (!state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;

    setIsClaimingRefund(true);
    addLog(`Initiating refund claim for withdrawal: ${intentId.slice(0, 16)}...`);
    addLog(`Shares to restore: ${formatAmount(shares)}`);

    try {
      // Create L1 public client for timestamp queries
      const publicClient = createL1PublicClient();

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
      const l2Context: RefundL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      // Convert intentId string to Fr for refund flow
      const nonce = Fr.fromString(intentId);

      // Execute the claim refund flow
      addLog("Executing claim refund flow...");
      const result = await executeClaimRefundFlow(publicClient, l2Context, {
        pendingWithdraw: {
          nonce,
          deadline,
          shares,
          assetId: BigInt(assetId),
        },
      });

      // Update position status back to Active
      updatePositionStatus(intentId, IntentStatus.Active);
      addLog(`Refund claimed! Original nonce: ${result.originalNonce.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Position restored with ${formatAmount(result.shares)} shares`, LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Claim refund failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsClaimingRefund(false);
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
              onBridge={handleBridge}
              onDeposit={handleDeposit}
              onWithdraw={handleWithdraw}
            />
          </ErrorBoundary>

          {/* Positions */}
          <ErrorBoundary>
            <PositionsList
              onWithdraw={handleWithdraw}
              onCancel={handleCancelDeposit}
              onClaimRefund={handleClaimRefund}
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
