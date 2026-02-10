/**
 * Operations Hook
 *
 * Contains all main protocol operations:
 * - Bridge (L1 → L2 token transfer)
 * - Deposit (L2 → L1 Aave deposit)
 * - Withdraw (L1 Aave → L2)
 * - Cancel Deposit
 * - Claim Refund
 *
 * Uses dependency injection for logging, busy state, and balance refresh
 * to keep this hook focused on operation orchestration.
 */

import { IntentStatus } from "@aztec-aave-wrapper/shared";
import { LogLevel } from "../../components/LogViewer";
import { type BridgeL1Addresses, executeBridgeFlow } from "../../flows/bridge";
import { type CancelL2Context, executeCancelDeposit } from "../../flows/cancel";
import {
  type DepositL1Addresses,
  type DepositL2Context,
  executeDepositFlow,
} from "../../flows/deposit";
import { executeDepositPhase1 } from "../../flows/depositPhase1";
import {
  executeDepositPhase2,
  type Phase2L1Addresses,
  type Phase2L2Context,
} from "../../flows/depositPhase2";
import { executeFinalizeDepositFlow, type FinalizeL2Context } from "../../flows/finalize";
import { executeClaimRefundFlow, type RefundL2Context } from "../../flows/refund";
import {
  executeWithdrawFlow,
  type WithdrawL1Addresses,
  type WithdrawL2Context,
} from "../../flows/withdraw";
import { getPositionStatusLabel, type UsePositionsResult } from "../../hooks/usePositions.js";
import { getPendingDeposits } from "../../services/pendingDeposits";
import { createL1PublicClient } from "../../services/l1/client";
import { getAztecOutbox } from "../../services/l1/portal";
import { createL2NodeClient } from "../../services/l2/client";
import { loadContractWithAzguard, loadContractWithDevWallet } from "../../services/l2/contract";
import { connectEthereumWallet } from "../../services/wallet/ethereum";
import { connectWallet, isDevWallet } from "../../services/wallet/index.js";
import { formatAmount } from "../../shared/format/usdc";
import { setWallet } from "../../store";
import { useApp } from "../../store/hooks";
import { formatUSDC, toBigIntString } from "../../types/state.js";
import type { UseBalancesResult } from "./useBalances";
import type { BusyState } from "./useBusy";

/** Dependencies injected into operations */
export interface OperationsDeps {
  addLog: (message: string, level?: LogLevel) => void;
  withBusy: <T, K extends keyof BusyState>(key: K, fn: () => Promise<T>) => Promise<T | undefined>;
  refreshBalances: UseBalancesResult["refreshBalances"];
  positionHooks: UsePositionsResult;
}

export interface UseOperationsResult {
  /** Bridge tokens from L1 to L2 */
  handleBridge: (amount: bigint) => Promise<void>;
  /** Deposit from L2 to L1 Aave */
  handleDeposit: (amount: bigint, deadline: number) => Promise<void>;
  /** Deposit Phase 1: L2 request_deposit (burns tokens, persists pending deposit) */
  handleDepositPhase1: (amount: bigint, deadline: number) => Promise<void>;
  /** Deposit Phase 2: L1 execution + L2 finalization (from pending deposit) */
  handleDepositPhase2: (intentId: string) => Promise<void>;
  /** Withdraw from L1 Aave to L2 */
  handleWithdraw: (intentId: string) => Promise<void>;
  /** Cancel a pending deposit */
  handleCancelDeposit: (intentId: string, deadline: bigint, netAmount: bigint) => Promise<void>;
  /** Finalize a pending deposit (create position receipt) */
  handleFinalizeDeposit: (intentId: string) => Promise<void>;
  /** Claim refund for failed withdrawal */
  handleClaimRefund: (
    intentId: string,
    deadline: bigint,
    shares: bigint,
    assetId: string
  ) => Promise<void>;
}

/**
 * Hook for protocol operations.
 *
 * Takes dependencies as parameters to enable composition with other hooks.
 * Each operation uses withBusy for automatic busy flag management.
 *
 * @param deps - Dependencies (logger, busy state, balance refresh, positions)
 * @returns Operation handlers
 *
 * @example
 * const operations = useOperations({
 *   addLog,
 *   withBusy,
 *   refreshBalances,
 *   positionHooks,
 * });
 * await operations.handleDeposit(amount, deadline);
 */
export function useOperations(deps: OperationsDeps): UseOperationsResult {
  const { addLog, withBusy, refreshBalances, positionHooks } = deps;
  const { state } = useApp();
  const { addNewPosition, updatePositionStatus, getPosition, removePositionById } = positionHooks;

  // ---------------------------------------------------------------------------
  // Bridge Handler (L1 → L2)
  // ---------------------------------------------------------------------------
  const handleBridge = async (amount: bigint) => {
    await withBusy("bridging", async () => {
      if (!state.contracts.tokenPortal || !state.contracts.mockUsdc) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const tokenPortal = state.contracts.tokenPortal;
      const mockUsdc = state.contracts.mockUsdc;

      const amountFormatted = formatAmount(amount);
      addLog(`Initiating bridge of ${amountFormatted} USDC from L1 to L2`);

      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      const publicClient = createL1PublicClient();
      const l1Clients = {
        publicClient,
        walletClient: ethereumConnection.walletClient,
      };

      const l1Addresses: BridgeL1Addresses = {
        tokenPortal,
        mockUsdc,
      };

      addLog("Connecting to Aztec wallet...");
      const { address: walletAddress } = await connectWallet();

      setWallet({ l2Address: walletAddress as `0x${string}` });

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2WalletAddress = AztecAddress.fromString(walletAddress);

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

      await refreshBalances(publicClient, ethereumConnection.address, mockUsdc);
    });
  };

  // ---------------------------------------------------------------------------
  // Deposit Handler (L2 → L1 Aave)
  // ---------------------------------------------------------------------------
  const handleDeposit = async (amount: bigint, deadline: number) => {
    await withBusy("depositing", async () => {
      if (
        !state.contracts.portal ||
        !state.contracts.mockUsdc ||
        !state.contracts.mockLendingPool ||
        !state.contracts.l2Wrapper
      ) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const portal = state.contracts.portal;
      const mockUsdc = state.contracts.mockUsdc;
      const mockLendingPool = state.contracts.mockLendingPool;
      const l2WrapperAddress = state.contracts.l2Wrapper;

      const amountFormatted = formatAmount(amount);
      addLog(`Initiating deposit of ${amountFormatted} USDC with ${deadline}s deadline`);

      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      const publicClient = createL1PublicClient();
      const l1Clients = {
        publicClient,
        walletClient: ethereumConnection.walletClient,
      };

      addLog("Fetching portal configuration...");
      const aztecOutbox = await getAztecOutbox(l1Clients.publicClient, portal);

      const l1Addresses: DepositL1Addresses = {
        portal,
        mockUsdc,
        mockAToken: mockUsdc,
        mockLendingPool,
        aztecOutbox,
      };

      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: DepositL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      addLog("Executing deposit flow...");
      const result = await executeDepositFlow(l1Clients, l1Addresses, l2Context, {
        amount,
        originalDecimals: 6,
        deadlineOffset: deadline,
      });

      addNewPosition({
        intentId: result.intentId,
        assetId: "0x01",
        shares: toBigIntString(result.shares),
        sharesFormatted: formatUSDC(result.shares),
        status: IntentStatus.Confirmed,
      });
      addLog(`Deposit complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Shares received: ${formatAmount(result.shares)}`, LogLevel.SUCCESS);

      await refreshBalances(l1Clients.publicClient, l1Clients.walletClient.account.address, mockUsdc);
    });
  };

  // ---------------------------------------------------------------------------
  // Deposit Phase 1 Handler (L2 request_deposit)
  // ---------------------------------------------------------------------------
  const handleDepositPhase1 = async (amount: bigint, deadline: number) => {
    await withBusy("depositing", async () => {
      if (
        !state.contracts.portal ||
        !state.contracts.mockUsdc ||
        !state.contracts.mockLendingPool ||
        !state.contracts.l2Wrapper
      ) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const portal = state.contracts.portal;
      const mockUsdc = state.contracts.mockUsdc;
      const mockLendingPool = state.contracts.mockLendingPool;
      const l2WrapperAddress = state.contracts.l2Wrapper;

      const amountFormatted = formatAmount(amount);
      addLog(`Initiating deposit Phase 1 of ${amountFormatted} USDC with ${deadline}s deadline`);

      const publicClient = createL1PublicClient();

      const l1Addresses: DepositL1Addresses = {
        portal,
        mockUsdc,
        mockAToken: mockUsdc,
        mockLendingPool,
        aztecOutbox: portal, // Not used in Phase 1, placeholder
      };

      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: DepositL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      addLog("Executing deposit Phase 1 (L2 request_deposit)...");
      const result = await executeDepositPhase1(publicClient, l1Addresses, l2Context, {
        amount,
        originalDecimals: 6,
        deadlineOffset: deadline,
      });

      addNewPosition({
        intentId: result.pendingDeposit.intentId,
        assetId: "0x01",
        shares: toBigIntString(0n),
        sharesFormatted: formatUSDC(0n),
        status: IntentStatus.PendingDeposit,
      });

      addLog(
        `Phase 1 complete! Intent: ${result.pendingDeposit.intentId.slice(0, 16)}...`,
        LogLevel.SUCCESS
      );
      addLog("Pending deposit saved. Phase 2 can be executed now or later.", LogLevel.SUCCESS);
    });
  };

  // ---------------------------------------------------------------------------
  // Deposit Phase 2 Handler (L1 execution + L2 finalization)
  // ---------------------------------------------------------------------------
  const handleDepositPhase2 = async (intentId: string) => {
    await withBusy("executingDeposit", async () => {
      if (
        !state.contracts.portal ||
        !state.contracts.mockUsdc ||
        !state.contracts.l2Wrapper
      ) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const portal = state.contracts.portal;
      const mockUsdc = state.contracts.mockUsdc;
      const l2WrapperAddress = state.contracts.l2Wrapper;

      // Find pending deposit from localStorage
      const pendingDeposits = getPendingDeposits();
      const pending = pendingDeposits.find(
        (d) => d.intentId.toLowerCase() === intentId.toLowerCase()
      );

      if (!pending) {
        addLog(`No pending deposit found for intent: ${intentId.slice(0, 16)}...`, LogLevel.ERROR);
        return;
      }

      addLog(`Initiating deposit Phase 2 for intent: ${intentId.slice(0, 16)}...`);

      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      const publicClient = createL1PublicClient();
      const l1Clients = {
        publicClient,
        walletClient: ethereumConnection.walletClient,
      };

      addLog("Fetching portal configuration...");
      const aztecOutbox = await getAztecOutbox(publicClient, portal);

      const l1Addresses: Phase2L1Addresses = {
        portal: portal as `0x${string}`,
        mockUsdc: mockUsdc as `0x${string}`,
        aztecOutbox: aztecOutbox as `0x${string}`,
      };

      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: Phase2L2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      addLog("Executing deposit Phase 2 (L1 execute + L2 finalize)...");
      const result = await executeDepositPhase2(l1Clients, l1Addresses, l2Context, pending);

      updatePositionStatus(intentId, IntentStatus.Confirmed);
      addLog(`Phase 2 complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Shares received: ${formatAmount(result.shares)}`, LogLevel.SUCCESS);

      await refreshBalances(
        l1Clients.publicClient,
        l1Clients.walletClient.account.address,
        mockUsdc
      );
    });
  };

  // ---------------------------------------------------------------------------
  // Withdraw Handler (L1 Aave → L2)
  // ---------------------------------------------------------------------------
  const handleWithdraw = async (intentId: string) => {
    await withBusy("withdrawing", async () => {
      const position = getPosition(intentId);
      if (!position) {
        addLog(`Position not found: ${intentId}`, LogLevel.ERROR);
        return;
      }

      if (position.status !== IntentStatus.Confirmed) {
        addLog(
          `Position is not in Active status (current: ${getPositionStatusLabel(position.status)}). Cannot withdraw.`,
          LogLevel.ERROR
        );
        return;
      }

      if (!state.contracts.portal || !state.contracts.mockUsdc || !state.contracts.l2Wrapper) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const portal = state.contracts.portal;
      const mockUsdc = state.contracts.mockUsdc;
      const l2WrapperAddress = state.contracts.l2Wrapper;

      addLog(`Initiating withdrawal for position: ${intentId.slice(0, 16)}...`);
      addLog(`Shares: ${position.sharesFormatted}`);

      updatePositionStatus(intentId, IntentStatus.PendingWithdraw);

      try {
        addLog("Connecting to L1 (MetaMask)...");
        const ethereumConnection = await connectEthereumWallet();
        addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

        const publicClient = createL1PublicClient();
        const l1Clients = {
          publicClient,
          walletClient: ethereumConnection.walletClient,
        };

        addLog("Fetching portal configuration...");
        const aztecOutbox = await getAztecOutbox(l1Clients.publicClient, portal);

        const l1Addresses: WithdrawL1Addresses = {
          portal,
          aztecOutbox,
          mockUsdc,
        };

        addLog("Connecting to Aztec L2...");
        const node = await createL2NodeClient();

        addLog("Connecting to Aztec wallet...");
        const { wallet, address: walletAddress } = await connectWallet();

        addLog("Loading AaveWrapper contract...");
        const { contract } = isDevWallet(wallet)
          ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
          : await loadContractWithAzguard(wallet, l2WrapperAddress);

        const { AztecAddress } = await import("@aztec/aztec.js/addresses");
        const { Fr } = await import("@aztec/aztec.js/fields");
        const l2Context: WithdrawL2Context = {
          node,
          wallet: { address: AztecAddress.fromString(walletAddress) },
          contract,
        };

        const depositIntentId = Fr.fromString(intentId);

        addLog("Executing withdraw flow...");
        const result = await executeWithdrawFlow(l1Clients, l1Addresses, l2Context, {
          position: {
            depositIntentId,
            shares: position.shares,
          },
          deadlineOffset: 3600,
        });

        removePositionById(intentId);
        addLog(`Withdrawal complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
        addLog(`Amount withdrawn: ${formatAmount(result.amount)}`, LogLevel.SUCCESS);

        await refreshBalances(
          l1Clients.publicClient,
          l1Clients.walletClient.account.address,
          state.contracts.mockUsdc
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        addLog(`Withdrawal failed: ${message}`, LogLevel.ERROR);
        updatePositionStatus(intentId, IntentStatus.Confirmed);
        throw error;
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Cancel Deposit Handler
  // ---------------------------------------------------------------------------
  const handleCancelDeposit = async (intentId: string, deadline: bigint, netAmount: bigint) => {
    await withBusy("cancelling", async () => {
      if (!state.contracts.l2Wrapper) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const l2WrapperAddress = state.contracts.l2Wrapper;

      addLog(`Initiating cancel for deposit: ${intentId.slice(0, 16)}...`);
      addLog(`Net amount to refund: ${formatAmount(netAmount)} USDC`);

      const publicClient = createL1PublicClient();

      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const { Fr } = await import("@aztec/aztec.js/fields");
      const l2Context: CancelL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      const depositIntentId = Fr.fromString(intentId);

      addLog("Executing cancel deposit flow...");
      const result = await executeCancelDeposit(publicClient, l2Context, {
        pendingDeposit: {
          intentId: depositIntentId,
          deadline,
          netAmount,
        },
      });

      addLog(`Cancel complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Refunded: ${formatAmount(result.refundedAmount)} USDC`, LogLevel.SUCCESS);

      const mockUsdc = state.contracts.mockUsdc;
      if (mockUsdc) {
        const { walletClient: ethWallet } = await connectEthereumWallet();
        await refreshBalances(publicClient, ethWallet.account.address, mockUsdc);
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Claim Refund Handler
  // ---------------------------------------------------------------------------
  const handleClaimRefund = async (
    intentId: string,
    deadline: bigint,
    shares: bigint,
    assetId: string
  ) => {
    await withBusy("claimingRefund", async () => {
      if (!state.contracts.l2Wrapper) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const l2WrapperAddress = state.contracts.l2Wrapper;

      addLog(`Initiating refund claim for withdrawal: ${intentId.slice(0, 16)}...`);
      addLog(`Shares to restore: ${formatAmount(shares)}`);

      const publicClient = createL1PublicClient();

      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const { Fr } = await import("@aztec/aztec.js/fields");
      const l2Context: RefundL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      const nonce = Fr.fromString(intentId);

      addLog("Executing claim refund flow...");
      const result = await executeClaimRefundFlow(publicClient, l2Context, {
        pendingWithdraw: {
          nonce,
          deadline,
          shares,
          assetId: BigInt(assetId),
        },
      });

      updatePositionStatus(intentId, IntentStatus.Confirmed);
      addLog(
        `Refund claimed! Original nonce: ${result.originalNonce.slice(0, 16)}...`,
        LogLevel.SUCCESS
      );
      addLog(`Position restored with ${formatAmount(result.shares)} shares`, LogLevel.SUCCESS);
    });
  };

  // ---------------------------------------------------------------------------
  // Finalize Deposit Handler
  // ---------------------------------------------------------------------------
  const handleFinalizeDeposit = async (intentId: string) => {
    await withBusy("finalizing", async () => {
      if (!state.contracts.l2Wrapper || !state.contracts.portal || !state.contracts.mockUsdc) {
        addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
        return;
      }

      const l2WrapperAddress = state.contracts.l2Wrapper;
      const portal = state.contracts.portal;
      const mockUsdc = state.contracts.mockUsdc;

      addLog(`Initiating finalization for deposit: ${intentId.slice(0, 16)}...`);

      const publicClient = createL1PublicClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading AaveWrapper contract...");
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");
      const l2Context: FinalizeL2Context = {
        wallet: { address: AztecAddress.fromString(walletAddress) },
        contract,
      };

      addLog("Executing finalize deposit flow...");
      const result = await executeFinalizeDepositFlow(
        publicClient,
        portal as `0x${string}`,
        mockUsdc as `0x${string}`,
        l2Context,
        { intentId, walletAddress }
      );

      // Update position status to Confirmed
      updatePositionStatus(intentId, IntentStatus.Confirmed);
      addLog(`Finalize complete! TX: ${result.txHash.slice(0, 16)}...`, LogLevel.SUCCESS);
      addLog(`Position created with ${formatAmount(result.shares)} shares`, LogLevel.SUCCESS);

      await refreshBalances(
        publicClient,
        walletAddress as `0x${string}`,
        mockUsdc as `0x${string}`
      );
    });
  };

  return {
    handleBridge,
    handleDeposit,
    handleDepositPhase1,
    handleDepositPhase2,
    handleWithdraw,
    handleCancelDeposit,
    handleFinalizeDeposit,
    handleClaimRefund,
  };
}
