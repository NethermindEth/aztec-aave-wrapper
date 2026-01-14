/**
 * L1 Block Mining Utility
 *
 * Implements evm_mine RPC call for Anvil block advancement.
 * Matches the pattern from e2e/scripts/full-flow.ts:481-495.
 */

import { type PublicClient, type Chain, type Transport } from "viem";
import { getDefaultL1Chain } from "../../config/chains.js";
import { logInfo, logSuccess } from "../../store/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface MineBlockResult {
  /** Block number after mining */
  blockNumber: bigint;
  /** Whether the operation succeeded */
  success: boolean;
}

export interface MineBlocksResult {
  /** Initial block number before mining */
  startBlock: bigint;
  /** Final block number after mining */
  endBlock: bigint;
  /** Number of blocks mined */
  blocksMined: number;
  /** Whether the operation succeeded */
  success: boolean;
}

// =============================================================================
// RPC Call Implementation
// =============================================================================

/**
 * Call evm_mine RPC method on Anvil.
 * This is a low-level function that directly calls the RPC endpoint.
 *
 * @param rpcUrl - The RPC URL to call (defaults to chain config)
 * @throws Error if the RPC call fails
 */
async function evmMine(rpcUrl?: string): Promise<void> {
  const chainConfig = getDefaultL1Chain();
  const url = rpcUrl ?? chainConfig.rpcUrl;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_mine",
      params: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`evm_mine RPC call failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`evm_mine RPC error: ${result.error.message}`);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Mine a single L1 block on Anvil.
 *
 * WARNING: Mining during a pending transaction may cause unexpected behavior.
 * Ensure no transactions are in-flight before calling this function.
 *
 * @param publicClient - Viem public client for querying block number
 * @param rpcUrl - Optional RPC URL override
 * @returns Result containing the new block number
 *
 * @example
 * ```ts
 * const result = await mineL1Block(publicClient);
 * console.log(`Mined block ${result.blockNumber}`);
 * ```
 */
export async function mineL1Block(
  publicClient: PublicClient<Transport, Chain>,
  rpcUrl?: string
): Promise<MineBlockResult> {
  logInfo("Mining L1 block...");

  await evmMine(rpcUrl);

  const blockNumber = await publicClient.getBlockNumber();

  logSuccess(`Mined L1 block ${blockNumber}`);

  return {
    blockNumber,
    success: true,
  };
}

/**
 * Mine multiple L1 blocks on Anvil.
 *
 * Useful for advancing time in tests or when waiting for message finalization.
 *
 * WARNING: Mining many blocks at once may affect pending transactions.
 * Use with caution in production-like environments.
 *
 * @param publicClient - Viem public client for querying block number
 * @param count - Number of blocks to mine
 * @param rpcUrl - Optional RPC URL override
 * @returns Result containing start/end block numbers
 *
 * @example
 * ```ts
 * const result = await mineL1Blocks(publicClient, 5);
 * console.log(`Mined ${result.blocksMined} blocks`);
 * ```
 */
export async function mineL1Blocks(
  publicClient: PublicClient<Transport, Chain>,
  count: number,
  rpcUrl?: string
): Promise<MineBlocksResult> {
  if (count <= 0) {
    const currentBlock = await publicClient.getBlockNumber();
    return {
      startBlock: currentBlock,
      endBlock: currentBlock,
      blocksMined: 0,
      success: true,
    };
  }

  logInfo(`Mining ${count} L1 blocks...`);

  const startBlock = await publicClient.getBlockNumber();

  for (let i = 0; i < count; i++) {
    await evmMine(rpcUrl);
  }

  const endBlock = await publicClient.getBlockNumber();

  logSuccess(`Mined ${count} L1 blocks (${startBlock} -> ${endBlock})`);

  return {
    startBlock,
    endBlock,
    blocksMined: count,
    success: true,
  };
}

/**
 * Get the current L1 block number.
 *
 * @param publicClient - Viem public client
 * @returns Current block number
 */
export async function getL1BlockNumber(
  publicClient: PublicClient<Transport, Chain>
): Promise<bigint> {
  return await publicClient.getBlockNumber();
}
