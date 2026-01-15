/**
 * TransactionLink Component
 *
 * Displays a clickable link to a block explorer for transaction hashes.
 * Supports multiple chains with appropriate explorer URLs.
 */

import { CHAIN_IDS } from "@aztec-aave-wrapper/shared";
import { Show } from "solid-js";

/**
 * Block explorer URLs by chain ID
 */
const BLOCK_EXPLORER_URLS: Record<number, string> = {
  [CHAIN_IDS.ETHEREUM_MAINNET]: "https://etherscan.io",
  [CHAIN_IDS.ETHEREUM_SEPOLIA]: "https://sepolia.etherscan.io",
  [CHAIN_IDS.ANVIL_L1]: "", // Local chain has no explorer
};

/**
 * Props for TransactionLink component
 */
export interface TransactionLinkProps {
  /** Transaction hash (0x-prefixed) */
  txHash: string;
  /** Chain ID for selecting the correct explorer */
  chainId?: number;
  /** Whether to show a truncated version of the hash */
  truncate?: boolean;
  /** Optional CSS class */
  class?: string;
}

/**
 * Get the block explorer transaction URL for a given chain
 */
function getExplorerUrl(chainId: number, txHash: string): string | null {
  const baseUrl = BLOCK_EXPLORER_URLS[chainId];
  if (!baseUrl) return null;
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Truncate a transaction hash for display
 */
function truncateHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

/**
 * TransactionLink renders a transaction hash as a clickable link to a block explorer.
 *
 * Features:
 * - Automatic chain detection for explorer URL
 * - Truncated hash display option
 * - Opens link in new tab
 * - Falls back to plain text for local chains without explorers
 *
 * @example
 * ```tsx
 * <TransactionLink
 *   txHash="0x1234...abcd"
 *   chainId={1}
 *   truncate
 * />
 * ```
 */
export function TransactionLink(props: TransactionLinkProps) {
  const chainId = () => props.chainId ?? CHAIN_IDS.ANVIL_L1;
  const explorerUrl = () => getExplorerUrl(chainId(), props.txHash);
  const displayHash = () => (props.truncate ? truncateHash(props.txHash) : props.txHash);

  return (
    <Show
      when={explorerUrl()}
      fallback={
        <span class={`font-mono text-blue-600 dark:text-blue-400 ${props.class ?? ""}`}>
          {displayHash()}
        </span>
      }
    >
      <a
        href={explorerUrl()!}
        target="_blank"
        rel="noopener noreferrer"
        class={`font-mono text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 ${props.class ?? ""}`}
        title={`View transaction on block explorer: ${props.txHash}`}
      >
        {displayHash()}
      </a>
    </Show>
  );
}
