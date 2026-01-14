/**
 * L2 Node Client Service
 *
 * Creates and manages Aztec node client connections.
 * Matches the pattern from e2e/scripts/full-flow.ts:399-409.
 */

import { getDefaultL2Chain, isLocalDevelopment } from "../../config/chains.js";
import { type AztecModules, loadAztecModules } from "./modules.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Aztec node client type (inferred from createAztecNodeClient return)
 */
export type AztecNodeClient = Awaited<ReturnType<AztecModules["createAztecNodeClient"]>>;

/**
 * Re-export NodeInfo from the SDK for consumers
 * NodeInfo contains: nodeVersion, l1ChainId, rollupVersion, enr, l1ContractAddresses, protocolContractAddresses
 */
import type { NodeInfo } from "@aztec/stdlib/contract";
export type { NodeInfo };

export interface L2ClientConfig {
  /** PXE/Node URL override (defaults to chain config) */
  rpcUrl?: string;
  /** Timeout for waitForNode in milliseconds */
  waitTimeout?: number;
}

// =============================================================================
// Client Creation
// =============================================================================

/**
 * Create an Aztec node client and wait for it to be ready.
 *
 * This matches the e2e pattern:
 * ```ts
 * const node = aztec.createAztecNodeClient(CONFIG.l2RpcUrl);
 * await aztec.waitForNode(node);
 * ```
 *
 * @param config - Optional configuration overrides
 * @returns Connected Aztec node client
 *
 * @example
 * ```ts
 * const node = await createL2NodeClient();
 * const nodeInfo = await node.getNodeInfo();
 * console.log('Connected to Aztec', nodeInfo.nodeVersion);
 * ```
 */
export async function createL2NodeClient(config?: L2ClientConfig): Promise<AztecNodeClient> {
  const chainConfig = getDefaultL2Chain();
  const rpcUrl = config?.rpcUrl ?? chainConfig.rpcUrl;

  const aztec = await loadAztecModules();

  const node = aztec.createAztecNodeClient(rpcUrl);
  await aztec.waitForNode(node);

  return node;
}

/**
 * Create an Aztec node client without waiting for readiness.
 * Use this when you want to manually control the wait/retry logic.
 *
 * @param config - Optional configuration overrides
 * @returns Aztec node client (may not be ready yet)
 */
export async function createL2NodeClientNoWait(config?: L2ClientConfig): Promise<AztecNodeClient> {
  const chainConfig = getDefaultL2Chain();
  const rpcUrl = config?.rpcUrl ?? chainConfig.rpcUrl;

  const aztec = await loadAztecModules();
  return aztec.createAztecNodeClient(rpcUrl);
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check if an Aztec node is healthy and responsive.
 *
 * @param node - Aztec node client to check
 * @returns Node info if healthy
 * @throws Error if node is not responsive
 *
 * @example
 * ```ts
 * const node = await createL2NodeClient();
 * const info = await checkL2NodeHealth(node);
 * console.log('Node version:', info.nodeVersion);
 * ```
 */
export async function checkL2NodeHealth(node: AztecNodeClient): Promise<NodeInfo> {
  return node.getNodeInfo();
}

/**
 * Wait for an Aztec node to become ready.
 * Useful when node may not be immediately available after devnet start.
 *
 * @param node - Aztec node client to wait for
 *
 * @example
 * ```ts
 * const node = await createL2NodeClientNoWait();
 * await waitForL2Node(node);
 * ```
 */
export async function waitForL2Node(node: AztecNodeClient): Promise<void> {
  const aztec = await loadAztecModules();
  await aztec.waitForNode(node);
}

// =============================================================================
// Convenience Functions for Local Development
// =============================================================================

/**
 * Create an Aztec node client for local development.
 * Logs a warning if called outside local development environment.
 *
 * @returns Connected Aztec node client
 *
 * @example
 * ```ts
 * const node = await createDevnetL2NodeClient();
 * ```
 */
export async function createDevnetL2NodeClient(): Promise<AztecNodeClient> {
  if (!isLocalDevelopment()) {
    console.warn("createDevnetL2NodeClient() called outside local development environment");
  }

  return createL2NodeClient();
}

/**
 * Verify L2 connection by fetching node info.
 *
 * @param node - Node client to verify
 * @returns Node info if connected
 * @throws Error if connection fails
 */
export async function verifyL2Connection(node: AztecNodeClient): Promise<NodeInfo> {
  return checkL2NodeHealth(node);
}
