/**
 * Balances Hook
 *
 * Handles L1 balance refresh operations.
 * Keeps balance setters encapsulated from the main controller.
 */

import type { Address, Chain, PublicClient, Transport } from "viem";
import { balanceOf } from "../../services/l1/tokens";
import { setATokenBalance, setEthBalance, setUsdcBalance } from "../../store";

export interface UseBalancesResult {
  /**
   * Refresh L1 balances (ETH and USDC).
   *
   * @param publicClient - Viem public client for L1
   * @param userAddress - User's L1 address
   * @param mockUsdc - Mock USDC contract address (null to skip USDC refresh)
   */
  refreshBalances: (
    publicClient: PublicClient<Transport, Chain>,
    userAddress: Address,
    mockUsdc: Address | null
  ) => Promise<void>;
}

/**
 * Hook for managing L1 balance refresh.
 *
 * Encapsulates all balance-related store updates in one place.
 * Note: The aTokenBalance is set to USDC balance as a placeholder -
 * actual aToken exposure is tracked via positions, not wallet balance.
 *
 * @example
 * const { refreshBalances } = useBalances();
 * await refreshBalances(publicClient, userAddress, mockUsdcAddress);
 */
export function useBalances(): UseBalancesResult {
  const refreshBalances = async (
    publicClient: PublicClient<Transport, Chain>,
    userAddress: Address,
    mockUsdc: Address | null
  ) => {
    try {
      const ethBalance = await publicClient.getBalance({ address: userAddress });
      setEthBalance(ethBalance.toString());

      if (mockUsdc) {
        const usdcBalance = await balanceOf(publicClient, mockUsdc, userAddress);
        setUsdcBalance(usdcBalance.toString());
        // Note: aTokenBalance is a UI placeholder. Real aToken exposure
        // is tracked through positions, not wallet holdings.
        setATokenBalance(usdcBalance.toString());
      }
    } catch (error) {
      console.warn("Failed to refresh balances:", error);
    }
  };

  return { refreshBalances };
}
