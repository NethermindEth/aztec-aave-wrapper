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
import { ClaimPendingBridges } from "./components/ClaimPendingBridges";
import { ContractDeployment } from "./components/ContractDeployment";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type LogEntry, LogLevel, LogViewer } from "./components/LogViewer";
import { OperationTabs } from "./components/OperationTabs";
import { PositionsList } from "./components/PositionsList";
import { RecoverDeposit } from "./components/RecoverDeposit";
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
import { type CancelL2Context, executeCancelDeposit } from "./flows/cancel";
import { executeClaimRefundFlow, type RefundL2Context } from "./flows/refund";
import { type BridgeL1Addresses, executeBridgeFlow } from "./flows/bridge";
import { executeBridgeClaim, type ClaimL2Context } from "./flows/claim";
import { scanPendingBridges, type PendingBridge } from "./services/pendingBridges";
import { getPositionStatusLabel, usePositions } from "./hooks/usePositions.js";
import { createL1PublicClient, createL1WalletClient, DevnetAccounts } from "./services/l1/client";
import { getAztecOutbox } from "./services/l1/portal";
import { balanceOf } from "./services/l1/tokens";
import { createL2NodeClient } from "./services/l2/client";
import { loadContractWithAzguard } from "./services/l2/contract";
import { loadBridgedTokenWithAzguard, type BridgedTokenContract } from "./services/l2/bridgedToken";
import { connectAztecWallet } from "./services/wallet/aztec";
import { connectEthereumWallet } from "./services/wallet/ethereum";
import { setATokenBalance, setEthBalance, setL2UsdcBalance, setUsdcBalance, setWallet } from "./store";
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

  // Bridge claim state (derived from chain)
  const [pendingBridges, setPendingBridges] = createSignal<PendingBridge[]>([]);
  const [isLoadingBridges, setIsLoadingBridges] = createSignal(false);
  const [claimingBridgeKey, setClaimingBridgeKey] = createSignal<string | null>(null);
  const [bridgeError, setBridgeError] = createSignal<string | null>(null);

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
    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;

    addLog("Refreshing positions from L2...");

    try {
      // Connect to Aztec wallet
      const { wallet, address: walletAddress } = await connectAztecWallet();

      // Load contract
      console.log("[handleRefreshPositions] Loading AaveWrapper contract...");
      const { contract } = await loadContractWithAzguard(wallet, l2WrapperAddress);
      console.log("[handleRefreshPositions] AaveWrapper loaded, calling refreshFromL2...");

      // Refresh positions from L2
      await refreshFromL2(contract, wallet, walletAddress);
      console.log("[handleRefreshPositions] refreshFromL2 completed");

      // Also refresh L2 USDC balance if BridgedToken address is available
      console.log("[handleRefreshPositions] l2BridgedTokenAddress:", l2BridgedTokenAddress);
      if (l2BridgedTokenAddress) {
        try {
          console.log("[handleRefreshPositions] Loading BridgedToken contract...");
          const { contract: bridgedTokenContract } = await loadBridgedTokenWithAzguard(
            wallet,
            l2BridgedTokenAddress
          );
          console.log("[handleRefreshPositions] BridgedToken loaded, getting balance...");
          const { getBalance } = await import("./services/l2/bridgedToken");
          const { AztecAddress } = await import("@aztec/aztec.js/addresses");
          console.log("[handleRefreshPositions] Calling getBalance for:", walletAddress);
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          console.log("[handleRefreshPositions] Got balance:", l2Balance.toString());
          setL2UsdcBalance(l2Balance.toString());
          addLog(`L2 USDC balance: ${formatUSDC(l2Balance)}`);
        } catch (balanceError) {
          console.error("[handleRefreshPositions] Balance error:", balanceError);
        }
      } else {
        console.log("[handleRefreshPositions] No l2BridgedTokenAddress - skipping balance refresh");
      }

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

      // Get L2 wallet address for storing secret and pending bridge
      addLog("Connecting to Aztec wallet...");
      const { address: walletAddress } = await connectAztecWallet();

      // Update global state so ClaimPendingBridges can load pending bridges
      setWallet({ l2Address: walletAddress as `0x${string}` });

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2WalletAddress = AztecAddress.fromString(walletAddress);

      // Execute the bridge flow (L1 only - no L2 claim)
      addLog("Executing bridge flow...");
      const result = await executeBridgeFlow(l1Clients, l1Addresses, l2WalletAddress, {
        amount,
      });

      addLog(
        `Bridge L1 deposit complete! Message key: ${result.messageKey.slice(0, 16)}...`,
        LogLevel.SUCCESS
      );
      addLog(`Amount bridged: ${formatAmount(result.amount)}`, LogLevel.SUCCESS);
      addLog(
        "Tokens will be available to claim on L2 once the message syncs. Check 'Pending Bridge Claims' below.",
        LogLevel.WARNING
      );

      // Refresh L1 balances after bridge
      await refreshBalances(publicClient, ethereumConnection.address, mockUsdc);
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
        status: IntentStatus.Confirmed,
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
    if (position.status !== IntentStatus.Confirmed) {
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
      updatePositionStatus(intentId, IntentStatus.Confirmed);
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
      updatePositionStatus(intentId, IntentStatus.Confirmed);
      addLog(
        `Refund claimed! Original nonce: ${result.originalNonce.slice(0, 16)}...`,
        LogLevel.SUCCESS
      );
      addLog(`Position restored with ${formatAmount(result.shares)} shares`, LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Claim refund failed: ${message}`, LogLevel.ERROR);
    } finally {
      setIsClaimingRefund(false);
    }
  };

  /**
   * Handle claiming a pending bridge on L2.
   */
  const handleClaimBridge = async (bridge: PendingBridge) => {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║ handleClaimBridge START                                    ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("[handleClaimBridge] Input bridge:", {
      messageKey: bridge.messageKey,
      amount: bridge.amount,
      status: bridge.status,
      leafIndex: bridge.leafIndex?.toString(),
      secret: bridge.secret?.slice(0, 20) + "...",
    });

    // Set claiming state
    setClaimingBridgeKey(bridge.messageKey);
    setBridgeError(null);

    // Validate contracts are loaded
    if (!state.contracts.l2BridgedToken) {
      console.log("[handleClaimBridge] ERROR: BridgedToken contract not loaded");
      addLog("BridgedToken contract not loaded. Please wait for deployment.", LogLevel.ERROR);
      setClaimingBridgeKey(null);
      return;
    }

    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;
    addLog(`Claiming bridge: ${bridge.messageKey.slice(0, 16)}...`);
    addLog(`Amount: ${formatAmount(BigInt(bridge.amount))} USDC`);

    try {
      // Initialize L2 context
      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectAztecWallet();

      addLog("Loading BridgedToken contract...");
      const { contract: bridgedTokenContract } = await loadBridgedTokenWithAzguard(
        wallet,
        l2BridgedTokenAddress
      );

      // Build L2 context
      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: ClaimL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        bridgedTokenContract,
      };

      // Execute claim
      addLog("Executing claim...");
      const result = await executeBridgeClaim(l2Context, bridge);
      console.log("[handleClaimBridge] executeBridgeClaim returned:", result);

      if (result.success) {
        console.log("[handleClaimBridge] SUCCESS!");
        addLog(`Bridge claimed successfully! TX: ${result.txHash}`, LogLevel.SUCCESS);

        // Refresh L2 USDC balance
        try {
          const { getBalance } = await import("./services/l2/bridgedToken");
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          setL2UsdcBalance(l2Balance.toString());
        } catch {
          console.warn("Failed to refresh L2 USDC balance");
        }

        // Refresh pending bridges (claimed bridge should disappear)
        await handleRefreshBridges();
      } else {
        console.log("[handleClaimBridge] FAILED:", result.error);
        addLog(`Claim failed: ${result.error}`, LogLevel.ERROR);
        setBridgeError(result.error || "Claim failed");
      }
    } catch (error) {
      console.log("[handleClaimBridge] CAUGHT EXCEPTION!");
      console.log("[handleClaimBridge]   error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Claim failed: ${message}`, LogLevel.ERROR);
      setBridgeError(message);
    } finally {
      setClaimingBridgeKey(null);
    }
  };

  /**
   * Scan for pending bridges from chain state.
   *
   * This derives all bridge state from:
   * 1. L1 TokenPortal DepositToAztecPrivate events
   * 2. L2 node message readiness
   * 3. Locally stored secrets (for matching)
   */
  const handleRefreshBridges = async () => {
    addLog("Scanning for pending bridges...");
    setIsLoadingBridges(true);
    setBridgeError(null);

    try {
      const { address: walletAddress } = await connectAztecWallet();
      const node = await createL2NodeClient();
      const publicClient = await createL1PublicClient();

      if (!state.contracts.tokenPortal) {
        throw new Error("Deployment addresses not loaded");
      }

      // Scan L1 events and match with stored secrets + check L2 readiness
      const result = await scanPendingBridges(
        publicClient,
        state.contracts.tokenPortal as `0x${string}`,
        walletAddress,
        node
      );

      setPendingBridges(result.bridges);

      const readyCount = result.bridges.filter((b) => b.status === "ready").length;
      addLog(
        `Found ${result.bridges.length} pending bridge(s), ${readyCount} ready to claim`,
        LogLevel.SUCCESS
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to scan bridges: ${message}`, LogLevel.ERROR);
      setBridgeError(message);
    } finally {
      setIsLoadingBridges(false);
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

          {/* Pending Bridge Claims */}
          <ErrorBoundary>
            <ClaimPendingBridges
              bridges={pendingBridges()}
              isLoading={isLoadingBridges()}
              claimingKey={claimingBridgeKey()}
              error={bridgeError()}
              walletConnected={!!state.contracts.tokenPortal}
              onClaim={handleClaimBridge}
              onRefresh={handleRefreshBridges}
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

          {/* Recover Stuck Deposits */}
          <ErrorBoundary>
            <RecoverDeposit />
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
