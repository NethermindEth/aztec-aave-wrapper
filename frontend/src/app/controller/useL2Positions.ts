/**
 * L2 Positions Hook
 *
 * Handles refreshing positions from L2 contract.
 * Orchestrates wallet connection, contract loading, and position refresh.
 */

import { createEffect, on } from "solid-js";
import type { Address } from "viem";
import { LogLevel } from "../../components/LogViewer";
import { usePositions } from "../../hooks/usePositions.js";
import { createL1PublicClient } from "../../services/l1/client.js";
import {
  getBalance,
  loadBridgedTokenWithAzguard,
  loadBridgedTokenWithDevWallet,
} from "../../services/l2/bridgedToken";
import { loadContractWithAzguard, loadContractWithDevWallet } from "../../services/l2/contract";
import { connectWallet, isDevWallet } from "../../services/wallet/index.js";
import { setL2UsdcBalance } from "../../store";
import { useApp } from "../../store/hooks";
import { formatUSDC } from "../../types/state.js";

export interface UseL2PositionsResult {
  /** Positions hook (delegates to usePositions) */
  positionHooks: ReturnType<typeof usePositions>;
  /**
   * Refresh positions from L2 contract.
   * Queries private notes and updates L2 USDC balance.
   *
   * @param addLog - Logger function for status messages
   */
  handleRefreshPositions: (addLog: (message: string, level?: LogLevel) => void) => Promise<void>;
}

/**
 * Hook for L2 position management.
 *
 * Wraps usePositions and adds the refresh orchestration logic
 * that requires wallet connection and contract loading.
 *
 * @example
 * const { positionHooks, handleRefreshPositions } = useL2Positions();
 * await handleRefreshPositions(addLog);
 */
export function useL2Positions(): UseL2PositionsResult {
  const { state } = useApp();
  const positionHooks = usePositions();
  const { refreshFromL2, filterClaimedWithdrawals } = positionHooks;

  const handleRefreshPositions = async (addLog: (message: string, level?: LogLevel) => void) => {
    if (!state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;
    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;

    addLog("Refreshing positions from L2...");

    try {
      const { wallet, address: walletAddress } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      await refreshFromL2(contract, wallet, walletAddress);

      // Filter out PendingWithdraw positions where tokens were already claimed
      const portalAddress = state.contracts.portal;
      if (portalAddress) {
        try {
          const publicClient = createL1PublicClient();
          await filterClaimedWithdrawals(publicClient, portalAddress as Address, walletAddress);
        } catch {
          // Non-critical - continue
        }
      }

      if (l2BridgedTokenAddress) {
        try {
          const { contract: bridgedTokenContract } = isDevWallet(wallet)
            ? await loadBridgedTokenWithDevWallet(wallet, l2BridgedTokenAddress)
            : await loadBridgedTokenWithAzguard(wallet, l2BridgedTokenAddress);
          const { AztecAddress } = await import("@aztec/aztec.js/addresses");
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          setL2UsdcBalance(l2Balance.toString());
          addLog(`L2 USDC balance: ${formatUSDC(l2Balance)}`);
        } catch {
          // Non-critical
        }
      }

      addLog("Positions refreshed from L2", LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to refresh positions: ${message}`, LogLevel.ERROR);
    }
  };

  // Auto-load positions when wallet is connected and contracts are available
  createEffect(
    on(
      () => [state.wallet.l2Address, state.contracts.l2Wrapper] as const,
      ([l2Address, l2Wrapper]) => {
        // Only auto-load if wallet connected and contracts deployed
        if (l2Address && l2Wrapper && !positionHooks.isRefreshing()) {
          // Silent auto-load
          handleRefreshPositionsSilent();
        }
      },
      { defer: true }
    )
  );

  /**
   * Silent refresh for auto-loading (no logging)
   */
  const handleRefreshPositionsSilent = async () => {
    if (!state.contracts.l2Wrapper) {
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;
    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;

    try {
      const { wallet, address: walletAddress } = await connectWallet();
      const { contract } = isDevWallet(wallet)
        ? await loadContractWithDevWallet(wallet, l2WrapperAddress)
        : await loadContractWithAzguard(wallet, l2WrapperAddress);

      await refreshFromL2(contract, wallet, walletAddress);

      // Filter out PendingWithdraw positions where tokens were already claimed
      const portalAddress = state.contracts.portal;
      if (portalAddress) {
        try {
          const publicClient = createL1PublicClient();
          await filterClaimedWithdrawals(publicClient, portalAddress as Address, walletAddress);
        } catch {
          // Non-critical
        }
      }

      if (l2BridgedTokenAddress) {
        try {
          const { contract: bridgedTokenContract } = isDevWallet(wallet)
            ? await loadBridgedTokenWithDevWallet(wallet, l2BridgedTokenAddress)
            : await loadBridgedTokenWithAzguard(wallet, l2BridgedTokenAddress);
          const { AztecAddress } = await import("@aztec/aztec.js/addresses");
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          setL2UsdcBalance(l2Balance.toString());
        } catch {
          // Non-critical
        }
      }
    } catch {
      // Silent auto-load failure
    }
  };

  return { positionHooks, handleRefreshPositions };
}
