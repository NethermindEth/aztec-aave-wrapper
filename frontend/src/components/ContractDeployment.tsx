/**
 * Contract Deployment Component
 *
 * Loads pre-deployed contract addresses from .deployments.local.json.
 * Contracts are deployed via `make devnet-up` before running the frontend.
 *
 * Contract addresses are displayed in the collapsible header panel (TopBar).
 * This component only handles loading and error states.
 */

import { createEffect, createSignal, on, Show } from "solid-js";
import { fetchDeploymentAddresses } from "../services/deployments.js";
import { useApp } from "../store/hooks.js";

/**
 * ContractDeployment loads pre-deployed contract addresses into app state.
 *
 * Features:
 * - Automatically loads addresses from .deployments.local.json when networks connect
 * - Shows error if deployment file is missing (devnet not running)
 * - Contract addresses are displayed in the header's collapsible panel
 *
 * Prerequisites:
 * - Run `make devnet-up` to start devnet and deploy contracts
 * - The deployment script writes addresses to .deployments.local.json
 *
 * @example
 * ```tsx
 * <ContractDeployment />
 * ```
 */
export function ContractDeployment() {
  const { state, actions } = useApp();
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Check if contracts are already loaded
   */
  const hasContracts = () =>
    state.contracts.portal !== null &&
    state.contracts.mockUsdc !== null &&
    state.contracts.l2Wrapper !== null;

  /**
   * Load deployment addresses from file
   */
  const loadAddresses = async () => {
    if (isLoading() || hasContracts()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const deployments = await fetchDeploymentAddresses();

      actions.setContracts({
        portal: deployments.l1.portal,
        tokenPortal: deployments.l1.tokenPortal,
        mockUsdc: deployments.l1.mockUsdc,
        mockLendingPool: deployments.l1.mockLendingPool,
        faucet: deployments.l1.faucet,
        l2BridgedToken: deployments.l2.bridgedToken,
        l2Wrapper: deployments.l2.aaveWrapper,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load deployment addresses";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Load addresses when both L1 and L2 are connected
  createEffect(
    on(
      () => state.l1.connected && state.l2.connected,
      (bothConnected) => {
        if (bothConnected && !hasContracts() && !isLoading()) {
          loadAddresses();
        }
      }
    )
  );

  // Only render error states - contract addresses are shown in header
  return (
    <Show when={error()}>
      <div class="glass-card">
        <div class="space-y-2">
          <p class="text-sm text-red-400">{error()}</p>
          <p class="text-xs text-zinc-500">
            Run <code class="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">make devnet-up</code>{" "}
            to deploy contracts.
          </p>
        </div>
      </div>
    </Show>
  );
}
