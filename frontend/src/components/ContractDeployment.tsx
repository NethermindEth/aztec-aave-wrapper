/**
 * Contract Deployment Component
 *
 * Displays deploy button and deployed contract addresses list.
 * Handles deployment loading state and prevents duplicate deployments.
 */

import { createSignal, For, Show } from "solid-js";
import {
  createL1PublicClient,
  createL1WalletClient,
  DevnetAccounts,
} from "../services/l1/client.js";
import { deployL1Contracts, fetchAllArtifacts } from "../services/l1/deploy.js";
import { createL2NodeClient } from "../services/l2/client.js";
import { deployL2Contract } from "../services/l2/deploy.js";
import { createTestWallet } from "../services/l2/wallet.js";
import { useApp } from "../store/hooks.js";
import { Button } from "./ui/button";
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
 * ContractDeployment displays the deploy button and deployed contract addresses.
 *
 * Features:
 * - Deploy button to deploy all contracts (L1 + L2)
 * - Loading state during deployment (button disabled, shows "Deploying...")
 * - Lists deployed contract addresses after successful deployment
 * - Prevents duplicate deployments while deployment is in progress
 * - Error display if deployment fails
 *
 * @example
 * ```tsx
 * <ContractDeployment />
 * ```
 */
export function ContractDeployment() {
  const { state, actions } = useApp();
  const [isDeploying, setIsDeploying] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Check if contracts are already deployed
   */
  const hasDeployedContracts = () =>
    state.contracts.portal !== null ||
    state.contracts.mockUsdc !== null ||
    state.contracts.l2Wrapper !== null;

  /**
   * Get list of deployed contract addresses for display
   */
  const deployedContracts = (): ContractEntry[] => {
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
   * Check if deployment is possible (both L1 and L2 must be connected)
   */
  const canDeploy = () => state.l1.connected && state.l2.connected;

  /**
   * Handle deploy button click
   * Deploys L2 contract first, then L1 contracts with L2 address
   */
  const handleDeploy = async () => {
    if (isDeploying() || hasDeployedContracts()) {
      return;
    }

    setIsDeploying(true);
    setError(null);

    try {
      // Create L2 node client and test wallet
      const node = await createL2NodeClient();
      const { wallet, address: walletAddress } = await createTestWallet(node);

      // Deploy L2 contract first (we need a placeholder portal address)
      // For now, use a zero address placeholder - will be updated after L1 deployment
      const { address: l2Address } = await deployL2Contract(wallet, walletAddress, {
        portalAddress: "0x0000000000000000000000000000000000000000",
      });

      // Update L2 wrapper address in state
      actions.setContracts({ l2Wrapper: l2Address.toString() });

      // Set wallet addresses
      const publicClient = createL1PublicClient();
      const walletClient = createL1WalletClient({ privateKey: DevnetAccounts.deployer });
      const l1Address = walletClient.account.address;

      actions.setWallet({
        l1Address,
        l2Address: walletAddress.toString(),
      });

      // Fetch artifacts and deploy L1 contracts
      const artifacts = await fetchAllArtifacts("/artifacts");
      const l1Addresses = await deployL1Contracts(publicClient, walletClient, artifacts, {
        l2ContractAddress: l2Address.toString() as `0x${string}`,
        ownerAddress: l1Address,
      });

      // Update L1 contract addresses in state
      actions.setContracts({
        portal: l1Addresses.portal,
        mockUsdc: l1Addresses.mockUsdc,
        mockLendingPool: l1Addresses.mockLendingPool,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deployment failed";
      setError(message);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="text-lg">Contract Deployment</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <Show when={error()}>
            <p class="text-sm text-destructive">{error()}</p>
          </Show>

          <Show
            when={hasDeployedContracts()}
            fallback={
              <div class="space-y-3">
                <Show when={!canDeploy()}>
                  <p class="text-sm text-muted-foreground">
                    Connect to both L1 and L2 before deploying contracts.
                  </p>
                </Show>
                <Button
                  onClick={handleDeploy}
                  disabled={isDeploying() || !canDeploy()}
                  class="w-full"
                >
                  {isDeploying() ? "Deploying..." : "Deploy Contracts"}
                </Button>
              </div>
            }
          >
            <div class="space-y-2">
              <p class="text-sm text-muted-foreground mb-3">Deployed Contracts</p>
              <For each={deployedContracts()}>
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
