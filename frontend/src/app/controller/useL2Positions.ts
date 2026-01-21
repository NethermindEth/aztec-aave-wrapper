/**
 * L2 Positions Hook
 *
 * Handles refreshing positions from L2 contract.
 * Orchestrates wallet connection, contract loading, and position refresh.
 */

import { LogLevel } from "../../components/LogViewer";
import { usePositions } from "../../hooks/usePositions.js";
import { getBalance, loadBridgedTokenWithAzguard } from "../../services/l2/bridgedToken";
import { loadContractWithAzguard } from "../../services/l2/contract";
import { connectAztecWallet } from "../../services/wallet/aztec";
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
  const { refreshFromL2 } = positionHooks;

  const handleRefreshPositions = async (addLog: (message: string, level?: LogLevel) => void) => {
    if (!state.contracts.l2Wrapper) {
      addLog("Contracts not loaded. Please wait for deployment.", LogLevel.ERROR);
      return;
    }

    const l2WrapperAddress = state.contracts.l2Wrapper;
    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;

    addLog("Refreshing positions from L2...");

    try {
      const { wallet, address: walletAddress } = await connectAztecWallet();
      const { contract } = await loadContractWithAzguard(wallet, l2WrapperAddress);

      await refreshFromL2(contract, wallet, walletAddress);

      if (l2BridgedTokenAddress) {
        try {
          const { contract: bridgedTokenContract } = await loadBridgedTokenWithAzguard(
            wallet,
            l2BridgedTokenAddress
          );
          const { AztecAddress } = await import("@aztec/aztec.js/addresses");
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          setL2UsdcBalance(l2Balance.toString());
          addLog(`L2 USDC balance: ${formatUSDC(l2Balance)}`);
        } catch (balanceError) {
          console.error("[handleRefreshPositions] Balance error:", balanceError);
        }
      }

      addLog("Positions refreshed from L2", LogLevel.SUCCESS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to refresh positions: ${message}`, LogLevel.ERROR);
    }
  };

  return { positionHooks, handleRefreshPositions };
}
