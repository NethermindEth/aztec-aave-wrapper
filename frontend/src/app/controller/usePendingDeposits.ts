/**
 * Pending Deposits Hook
 *
 * Manages pending deposit state with auto-polling for proof readiness.
 * Follows the useBridge.ts pattern (createStore, createEffect with on(), onCleanup).
 *
 * Provides:
 * - Auto-load from localStorage when wallet + portal are available
 * - 30-second proof status polling via checkDepositProofStatus
 * - handleExecuteDeposit(intentId) for Phase 2 execution
 * - handleRefreshPendingDeposits to manually reload from localStorage
 */

import { createEffect, on, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { LogLevel } from "../../components/LogViewer";
import {
  executeDepositPhase2,
  type Phase2L1Addresses,
  type Phase2L2Context,
} from "../../flows/depositPhase2";
import {
  checkDepositProofStatus,
  type DepositProofStatus,
} from "../../services/depositProofPoller";
import { createL1PublicClient, type L1Clients } from "../../services/l1/client";
import { getAztecOutbox } from "../../services/l1/portal";
import { createL2NodeClient } from "../../services/l2/client";
import { loadContractWithAzguard, loadContractWithDevWallet } from "../../services/l2/contract";
import { getPendingDeposits, type PendingDeposit } from "../../services/pendingDeposits";
import { connectEthereumWallet } from "../../services/wallet/ethereum";
import { connectWallet, isDevWallet } from "../../services/wallet/index.js";
import { useApp } from "../../store/hooks";

// =============================================================================
// Constants
// =============================================================================

/** Proof polling interval in milliseconds */
const POLL_INTERVAL_MS = 30_000;

// =============================================================================
// Types
// =============================================================================

/** Proof status for a single pending deposit */
export interface PendingDepositEntry {
  /** The pending deposit data */
  deposit: PendingDeposit;
  /** Current proof readiness status */
  proofStatus: DepositProofStatus | "unknown";
  /** Human-readable status message */
  proofMessage: string;
}

/** Pending deposits hook state */
export interface PendingDepositState {
  /** List of pending deposits with proof status */
  deposits: PendingDepositEntry[];
  /** Whether loading/refreshing deposits */
  isLoading: boolean;
  /** Intent ID currently being executed (guards against concurrent execution) */
  executingIntentId: string | null;
  /** Error message from last operation */
  error: string | null;
}

export interface UsePendingDepositsResult {
  /** Reactive pending deposit state */
  pendingDepositState: PendingDepositState;
  /** Execute Phase 2 for a specific pending deposit */
  handleExecuteDeposit: (
    intentId: string,
    addLog: (message: string, level?: LogLevel) => void
  ) => Promise<void>;
  /** Manually refresh pending deposits from localStorage */
  handleRefreshPendingDeposits: (
    addLog: (message: string, level?: LogLevel) => void
  ) => Promise<void>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing pending deposits and proof polling.
 *
 * Owns the pendingDepositState store and provides handlers for:
 * - Loading pending deposits from localStorage
 * - Polling proof readiness every 30 seconds
 * - Executing Phase 2 (L1 deposit + L2 finalization) for a ready deposit
 */
export function usePendingDeposits(): UsePendingDepositsResult {
  const { state } = useApp();

  const [pendingDepositState, setPendingDepositState] = createStore<PendingDepositState>({
    deposits: [],
    isLoading: false,
    executingIntentId: null,
    error: null,
  });

  // ---------------------------------------------------------------------------
  // Load deposits from localStorage
  // ---------------------------------------------------------------------------

  const loadDeposits = (): PendingDepositEntry[] => {
    const pending = getPendingDeposits();
    return pending.map((deposit) => ({
      deposit,
      proofStatus: "unknown" as const,
      proofMessage: "Not yet checked",
    }));
  };

  // ---------------------------------------------------------------------------
  // Proof polling
  // ---------------------------------------------------------------------------

  const pollProofStatuses = async () => {
    // Skip if no deposits or already executing
    if (pendingDepositState.deposits.length === 0 || pendingDepositState.executingIntentId) {
      return;
    }

    if (!state.contracts.portal) return;

    try {
      const publicClient = createL1PublicClient();
      const node = await createL2NodeClient();
      const outboxAddress = await getAztecOutbox(
        publicClient,
        state.contracts.portal as `0x${string}`
      );

      for (let i = 0; i < pendingDepositState.deposits.length; i++) {
        const entry = pendingDepositState.deposits[i];

        // Skip deposits that are already ready
        if (entry.proofStatus === "ready") continue;

        try {
          const result = await checkDepositProofStatus(
            entry.deposit,
            node,
            publicClient,
            outboxAddress,
            state.contracts.portal as string
          );

          setPendingDepositState("deposits", i, "proofStatus", result.status);
          setPendingDepositState("deposits", i, "proofMessage", result.message);
        } catch {
          // Individual deposit check failure — don't fail the whole poll
        }
      }
    } catch {
      // Silent poll failure — will retry next interval
    }
  };

  // ---------------------------------------------------------------------------
  // Interval management
  // ---------------------------------------------------------------------------

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    stopPolling();
    // Only poll if there are deposits to check
    if (pendingDepositState.deposits.length > 0) {
      // Run immediately, then every POLL_INTERVAL_MS
      pollProofStatuses();
      pollInterval = setInterval(pollProofStatuses, POLL_INTERVAL_MS);
    }
  };

  const stopPolling = () => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  // Clean up interval on component unmount
  onCleanup(stopPolling);

  // ---------------------------------------------------------------------------
  // Public handlers
  // ---------------------------------------------------------------------------

  const handleRefreshPendingDeposits = async (
    addLog: (message: string, level?: LogLevel) => void
  ) => {
    addLog("Loading pending deposits...");
    setPendingDepositState("isLoading", true);
    setPendingDepositState("error", null);

    try {
      const entries = loadDeposits();
      setPendingDepositState("deposits", entries);

      addLog(
        `Found ${entries.length} pending deposit(s)`,
        entries.length > 0 ? LogLevel.SUCCESS : LogLevel.INFO
      );

      // Restart polling with updated deposits
      startPolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to load pending deposits: ${message}`, LogLevel.ERROR);
      setPendingDepositState("error", message);
    } finally {
      setPendingDepositState("isLoading", false);
    }
  };

  const handleExecuteDeposit = async (
    intentId: string,
    addLog: (message: string, level?: LogLevel) => void
  ) => {
    // Guard against concurrent execution
    if (pendingDepositState.executingIntentId) {
      addLog(
        `Already executing deposit ${pendingDepositState.executingIntentId.slice(0, 16)}...`,
        LogLevel.ERROR
      );
      return;
    }

    const entry = pendingDepositState.deposits.find(
      (e) => e.deposit.intentId.toLowerCase() === intentId.toLowerCase()
    );

    if (!entry) {
      addLog(`Pending deposit not found: ${intentId.slice(0, 16)}...`, LogLevel.ERROR);
      return;
    }

    if (!state.contracts.portal || !state.contracts.mockUsdc || !state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const portal = state.contracts.portal;
    const mockUsdc = state.contracts.mockUsdc;
    const l2WrapperAddress = state.contracts.l2Wrapper;

    setPendingDepositState("executingIntentId", intentId);
    setPendingDepositState("error", null);

    try {
      addLog(`Executing Phase 2 for deposit ${intentId.slice(0, 16)}...`);

      addLog("Connecting to L1 (MetaMask)...");
      const ethereumConnection = await connectEthereumWallet();
      addLog(`Connected to MetaMask: ${ethereumConnection.address}`);

      const publicClient = createL1PublicClient();
      const l1Clients: L1Clients = {
        publicClient,
        walletClient: ethereumConnection.walletClient,
      };

      addLog("Fetching portal configuration...");
      const aztecOutbox = await getAztecOutbox(publicClient, portal as `0x${string}`);

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
      const result = await executeDepositPhase2(l1Clients, l1Addresses, l2Context, entry.deposit);

      addLog(`Phase 2 complete! Intent: ${result.intentId.slice(0, 16)}...`, LogLevel.SUCCESS);
      if (result.txHashes.l1Execute) {
        addLog(`L1 TX: ${result.txHashes.l1Execute}`, LogLevel.SUCCESS);
      }
      if (result.txHashes.l2Finalize) {
        addLog(`L2 TX: ${result.txHashes.l2Finalize}`, LogLevel.SUCCESS);
      }

      // Reload deposits from localStorage (Phase 2 removes the completed one)
      const entries = loadDeposits();
      setPendingDepositState("deposits", entries);

      // Restart polling with updated list
      startPolling();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : (JSON.stringify(error) ?? "Unknown error");
      addLog(`Phase 2 failed: ${message}`, LogLevel.ERROR);
      setPendingDepositState("error", message);
    } finally {
      setPendingDepositState("executingIntentId", null);
    }
  };

  // ---------------------------------------------------------------------------
  // Auto-load when wallet + portal are available
  // ---------------------------------------------------------------------------

  createEffect(
    on(
      () => [state.wallet.l2Address, state.contracts.portal] as const,
      ([l2Address, portal]) => {
        if (
          l2Address &&
          portal &&
          pendingDepositState.deposits.length === 0 &&
          !pendingDepositState.isLoading
        ) {
          // Silent auto-load
          const entries = loadDeposits();
          setPendingDepositState("deposits", entries);
          startPolling();
        }
      },
      { defer: true }
    )
  );

  return {
    pendingDepositState,
    handleExecuteDeposit,
    handleRefreshPendingDeposits,
  };
}
