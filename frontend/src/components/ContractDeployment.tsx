/**
 * Contract Deployment Component
 *
 * Displays pre-deployed contract addresses loaded from .deployments.local.json.
 * Contracts are deployed via `make devnet-up` before running the frontend.
 */

import { createEffect, createSignal, For, on, Show } from "solid-js";
import { fetchDeploymentAddresses } from "../services/deployments.js";
import { useApp } from "../store/hooks.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/**
 * Truncate an address for display
 * Shows first 6 and last 4 characters: 0x1234...abcd
 */
function truncateAddress(address: string): string {
  if (address.length <= 13) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Contract address entry for display
 */
interface ContractEntry {
  name: string;
  address: string;
}

/**
 * ContractDeployment displays pre-deployed contract addresses.
 *
 * Features:
 * - Automatically loads addresses from .deployments.local.json on mount
 * - Shows loading state while fetching
 * - Displays error if deployment file is missing (devnet not running)
 * - Lists all contract addresses after successful load
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
   * Get list of contract addresses for display
   */
  const contractEntries = (): ContractEntry[] => {
    const entries: ContractEntry[] = [];

    if (state.contracts.portal) {
      entries.push({ name: "Portal (L1)", address: state.contracts.portal });
    }
    if (state.contracts.mockUsdc) {
      entries.push({ name: "Mock USDC (L1)", address: state.contracts.mockUsdc });
    }
    if (state.contracts.mockLendingPool) {
      entries.push({ name: "Lending Pool (L1)", address: state.contracts.mockLendingPool });
    }
    if (state.contracts.l2Wrapper) {
      entries.push({ name: "AaveWrapper (L2)", address: state.contracts.l2Wrapper });
    }

    return entries;
  };

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

  return (
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-lg">Deployed Contracts</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <Show when={error()}>
            <div class="space-y-2">
              <p class="text-sm text-destructive">{error()}</p>
              <p class="text-xs text-muted-foreground">
                Run <code class="bg-muted px-1 rounded">make devnet-up</code> to deploy contracts.
              </p>
            </div>
          </Show>

          <Show when={isLoading()}>
            <p class="text-sm text-muted-foreground">Loading contract addresses...</p>
          </Show>

          <Show when={!state.l1.connected || !state.l2.connected}>
            <p class="text-sm text-muted-foreground">Waiting for L1 and L2 connections...</p>
          </Show>

          <Show when={hasContracts()}>
            <div class="space-y-2">
              <For each={contractEntries()}>
                {(contract) => (
                  <div class="flex justify-between text-sm">
                    <span class="text-muted-foreground">{contract.name}</span>
                    <span class="font-mono" title={contract.address}>
                      {truncateAddress(contract.address)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </CardContent>
    </Card>
  );
}
