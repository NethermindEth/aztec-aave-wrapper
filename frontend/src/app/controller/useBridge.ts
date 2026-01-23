/**
 * Bridge Hook
 *
 * Manages bridge state (pending bridges, claiming) and bridge operations.
 * Handles scanning for pending bridges and claiming L2 tokens.
 */

import { createEffect, createMemo, on } from "solid-js";
import { createStore } from "solid-js/store";
import { LogLevel } from "../../components/LogViewer";
import { type ClaimL2Context, executeBridgeClaim } from "../../flows/claim";
import { createL1PublicClient } from "../../services/l1/client";
import {
  getBalance,
  loadBridgedTokenWithAzguard,
  loadBridgedTokenWithDevWallet,
} from "../../services/l2/bridgedToken";
import { createL2NodeClient } from "../../services/l2/client";
import { type PendingBridge, scanPendingBridges } from "../../services/pendingBridges";
import { connectWallet, isDevWallet } from "../../services/wallet/index.js";
import { formatAmount } from "../../shared/format/usdc";
import { setL2UsdcBalance } from "../../store";
import { useApp } from "../../store/hooks";

/** Bridge claim state */
export interface BridgeState {
  pendingBridges: PendingBridge[];
  isLoading: boolean;
  claimingKey: string | null;
  error: string | null;
}

export interface UseBridgeResult {
  /** Reactive bridge state */
  bridgeState: BridgeState;
  /** Count of bridges ready to claim */
  readyClaimsCount: () => number;
  /**
   * Refresh (scan) for pending bridges.
   *
   * @param addLog - Logger function for status messages
   */
  handleRefreshBridges: (addLog: (message: string, level?: LogLevel) => void) => Promise<void>;
  /**
   * Claim a pending bridge on L2.
   *
   * @param bridge - The pending bridge to claim
   * @param addLog - Logger function for status messages
   */
  handleClaimBridge: (
    bridge: PendingBridge,
    addLog: (message: string, level?: LogLevel) => void
  ) => Promise<void>;
}

/**
 * Hook for managing bridge state and operations.
 *
 * Owns the bridgeState store and provides handlers for:
 * - Scanning for pending bridges from L1 events
 * - Claiming bridges on L2 via BridgedToken contract
 *
 * @example
 * const { bridgeState, handleRefreshBridges, handleClaimBridge } = useBridge();
 * await handleRefreshBridges(addLog);
 * await handleClaimBridge(bridge, addLog);
 */
export function useBridge(): UseBridgeResult {
  const { state } = useApp();

  const [bridgeState, setBridgeState] = createStore<BridgeState>({
    pendingBridges: [],
    isLoading: false,
    claimingKey: null,
    error: null,
  });

  const readyClaimsCount = createMemo(() => {
    return bridgeState.pendingBridges.filter((b) => b.status === "ready").length;
  });

  const handleRefreshBridges = async (addLog: (message: string, level?: LogLevel) => void) => {
    addLog("Scanning for pending bridges...");
    setBridgeState("isLoading", true);
    setBridgeState("error", null);

    try {
      const { address: walletAddress } = await connectWallet();
      const node = await createL2NodeClient();
      const publicClient = createL1PublicClient();

      if (!state.contracts.tokenPortal) {
        throw new Error("Deployment addresses not loaded");
      }

      const result = await scanPendingBridges(
        publicClient,
        state.contracts.tokenPortal as `0x${string}`,
        walletAddress,
        node
      );

      setBridgeState("pendingBridges", result.bridges);

      const readyCount = result.bridges.filter((b) => b.status === "ready").length;
      addLog(
        `Found ${result.bridges.length} pending bridge(s), ${readyCount} ready to claim`,
        LogLevel.SUCCESS
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to scan bridges: ${message}`, LogLevel.ERROR);
      setBridgeState("error", message);
    } finally {
      setBridgeState("isLoading", false);
    }
  };

  const handleClaimBridge = async (
    bridge: PendingBridge,
    addLog: (message: string, level?: LogLevel) => void
  ) => {
    setBridgeState("claimingKey", bridge.messageKey);
    setBridgeState("error", null);

    if (!state.contracts.l2BridgedToken) {
      addLog("BridgedToken contract not loaded. Please wait for deployment.", LogLevel.ERROR);
      setBridgeState("claimingKey", null);
      return;
    }

    const l2BridgedTokenAddress = state.contracts.l2BridgedToken;
    addLog(`Claiming bridge: ${bridge.messageKey.slice(0, 16)}...`);
    addLog(`Amount: ${formatAmount(BigInt(bridge.amount))} USDC`);

    try {
      addLog("Connecting to Aztec L2...");
      const node = await createL2NodeClient();

      addLog("Connecting to Aztec wallet...");
      const { wallet, address: walletAddress } = await connectWallet();

      addLog("Loading BridgedToken contract...");
      console.log("[handleClaimBridge] l2BridgedTokenAddress:", l2BridgedTokenAddress);
      console.log(
        "[handleClaimBridge] wallet type:",
        isDevWallet(wallet) ? "DevWallet" : "Azguard"
      );

      if (!l2BridgedTokenAddress) {
        throw new Error(
          "BridgedToken contract address not found in state. Ensure contracts are deployed."
        );
      }

      const { contract: bridgedTokenContract } = isDevWallet(wallet)
        ? await loadBridgedTokenWithDevWallet(wallet, l2BridgedTokenAddress)
        : await loadBridgedTokenWithAzguard(wallet, l2BridgedTokenAddress);

      console.log("[handleClaimBridge] bridgedTokenContract loaded:", !!bridgedTokenContract);
      console.log(
        "[handleClaimBridge] bridgedTokenContract.address:",
        bridgedTokenContract?.address?.toString?.()
      );

      const { AztecAddress } = await import("@aztec/aztec.js/addresses");

      if (!walletAddress) {
        throw new Error("Wallet address not available");
      }

      const l2Context: ClaimL2Context = {
        node,
        wallet: { address: AztecAddress.fromString(walletAddress) },
        bridgedTokenContract,
      };

      console.log(
        "[handleClaimBridge] l2Context.wallet.address:",
        l2Context.wallet.address.toString()
      );

      addLog("Executing claim...");
      const result = await executeBridgeClaim(l2Context, bridge);

      if (result.success) {
        addLog(`Bridge claimed successfully! TX: ${result.txHash}`, LogLevel.SUCCESS);

        try {
          const l2Balance = await getBalance(
            bridgedTokenContract,
            AztecAddress.fromString(walletAddress)
          );
          setL2UsdcBalance(l2Balance.toString());
        } catch {
          console.warn("Failed to refresh L2 USDC balance");
        }

        await handleRefreshBridges(addLog);
      } else {
        addLog(`Claim failed: ${result.error}`, LogLevel.ERROR);
        setBridgeState("error", result.error || "Claim failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addLog(`Claim failed: ${message}`, LogLevel.ERROR);
      setBridgeState("error", message);
    } finally {
      setBridgeState("claimingKey", null);
    }
  };

  // Auto-load bridges when wallet is connected and contracts are available
  createEffect(
    on(
      () => [state.wallet.l2Address, state.contracts.tokenPortal] as const,
      ([l2Address, tokenPortal]) => {
        // Only auto-load if wallet connected and contracts deployed
        if (l2Address && tokenPortal && bridgeState.pendingBridges.length === 0 && !bridgeState.isLoading) {
          // Silent auto-load (no logging)
          handleRefreshBridgesSilent();
        }
      },
      { defer: true }
    )
  );

  /**
   * Silent refresh for auto-loading (no logging)
   */
  const handleRefreshBridgesSilent = async () => {
    setBridgeState("isLoading", true);
    setBridgeState("error", null);

    try {
      const { address: walletAddress } = await connectWallet();
      const node = await createL2NodeClient();
      const publicClient = createL1PublicClient();

      if (!state.contracts.tokenPortal) {
        return;
      }

      const result = await scanPendingBridges(
        publicClient,
        state.contracts.tokenPortal as `0x${string}`,
        walletAddress,
        node
      );

      setBridgeState("pendingBridges", result.bridges);
    } catch (error) {
      console.warn("[useBridge] Auto-load failed:", error);
    } finally {
      setBridgeState("isLoading", false);
    }
  };

  return {
    bridgeState,
    readyClaimsCount,
    handleRefreshBridges,
    handleClaimBridge,
  };
}
