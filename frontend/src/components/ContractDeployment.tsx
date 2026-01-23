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
 * L1 icon (Ethereum-style)
 */
function L1Icon() {
  return (
    <svg
      class="contract-pill-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M12 2L2 12l10 10 10-10L12 2z" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

/**
 * L2 icon (Aztec-style with layers)
 */
function L2Icon() {
  return (
    <svg
      class="contract-pill-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

/**
 * Contract address entry for display
 */
interface ContractEntry {
  name: string;
  address: string;
  layer: "L1" | "L2";
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
      entries.push({ name: "Portal", address: state.contracts.portal, layer: "L1" });
    }
    if (state.contracts.mockUsdc) {
      entries.push({ name: "Mock USDC", address: state.contracts.mockUsdc, layer: "L1" });
    }
    if (state.contracts.mockLendingPool) {
      entries.push({ name: "Lending Pool", address: state.contracts.mockLendingPool, layer: "L1" });
    }
    if (state.contracts.l2BridgedToken) {
      entries.push({ name: "BridgedToken", address: state.contracts.l2BridgedToken, layer: "L2" });
    }
    if (state.contracts.l2Wrapper) {
      entries.push({ name: "AaveWrapper", address: state.contracts.l2Wrapper, layer: "L2" });
    }

    return entries;
  };

  /**
   * Copy address to clipboard with visual feedback
   */
  const copyToClipboard = async (address: string, event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    try {
      // Check if clipboard API is available (requires secure context)
      if (!navigator.clipboard) {
        throw new Error("Clipboard API not available");
      }
      await navigator.clipboard.writeText(address);
      target.setAttribute("data-copied", "true");
      setTimeout(() => {
        target.removeAttribute("data-copied");
      }, 1500);
    } catch (err) {
      // Fallback: select text for manual copy (useful in dev/insecure contexts)
      console.warn("Clipboard copy failed, address:", address, err);
    }
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
            <div class="contracts-grid">
              <For each={contractEntries()}>
                {(contract) => (
                  <button
                    type="button"
                    class="contract-pill"
                    title={`Click to copy: ${contract.address}`}
                    onClick={(e) => copyToClipboard(contract.address, e)}
                  >
                    {contract.layer === "L1" ? <L1Icon /> : <L2Icon />}
                    <span class="contract-name">{contract.name}</span>
                    <span class="contract-address">{truncateAddress(contract.address)}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </CardContent>
    </Card>
  );
}
