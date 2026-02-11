/**
 * Pending Bridges Service
 *
 * Derives pending bridge state from on-chain data + stored secrets.
 * NO localStorage for bridge state - everything comes from the chain.
 *
 * The only local storage is for secrets (in secrets.ts) because
 * secrets are never posted on-chain for privacy.
 */

import type { Address, Chain, PublicClient, Transport } from "viem";
import { getDepositToAztecPrivateEvents } from "./l1/tokenPortal.js";
import type { AztecNodeClient } from "./l2/client.js";
import { getAllSecrets } from "./secrets.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a pending bridge (derived from chain state)
 */
export type PendingBridgeStatus = "pending" | "ready" | "unknown";

/**
 * A pending bridge derived from chain data + stored secret
 */
export interface PendingBridge {
  /** L1→L2 message key (content hash) */
  messageKey: string;
  /** L1→L2 message index from event */
  messageIndex: string;
  /** Amount bridged (in smallest unit) */
  amount: string;
  /** L1 deposit transaction hash */
  l1TxHash: string;
  /** Block number of L1 deposit */
  l1BlockNumber: bigint;
  /** Secret hash from L1 event */
  secretHash: string;
  /** The secret (from local storage) */
  secret: string;
  /** Current status (derived from L2 node) */
  status: PendingBridgeStatus;
  /** Actual leaf index in L2 tree (if ready) */
  leafIndex?: bigint;
  /** Current L2 block number */
  currentL2Block?: bigint;
  /** L2 block number at which message will be ready to claim */
  targetL2Block?: bigint;
}

/**
 * Result of scanning for pending bridges
 */
export interface PendingBridgeScanResult {
  /** Bridges that can be claimed (have matching secrets) */
  bridges: PendingBridge[];
  /** Total L1 deposit events found */
  totalEvents: number;
  /** Events that have matching secrets */
  matchedEvents: number;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Scan for pending bridges by querying L1 events and matching with stored secrets.
 *
 * This is the main entry point - it derives all pending bridge state from:
 * 1. L1 TokenPortal DepositToAztecPrivate events
 * 2. Locally stored secrets (matched by secretHash)
 * 3. L2 node for message readiness
 *
 * @param publicClient - L1 public client
 * @param tokenPortalAddress - TokenPortal contract address
 * @param l2Node - Aztec node client (optional, for checking readiness)
 * @param l2WalletAddress - L2 wallet address (for decrypting secrets)
 * @param fromBlock - Starting block to scan (default: 0)
 * @returns Pending bridges with their status
 */
export async function scanPendingBridges(
  publicClient: PublicClient<Transport, Chain>,
  tokenPortalAddress: Address,
  l2WalletAddress: string,
  l2Node?: AztecNodeClient,
  fromBlock: bigint = 0n
): Promise<PendingBridgeScanResult> {
  // 1. Get all L1 deposit events
  const events = await getDepositToAztecPrivateEvents(publicClient, tokenPortalAddress, fromBlock);

  // 2. Get all stored secrets and build a lookup by intentId (messageKey)
  const secrets = await getAllSecrets(l2WalletAddress);

  const secretsByMessageKey = new Map<string, string>();

  for (const entry of secrets) {
    // Secrets are stored with messageKey as intentId
    secretsByMessageKey.set(entry.intentId.toLowerCase(), entry.secretHex);
  }

  // 3. Match events with secrets by messageKey
  const bridges: PendingBridge[] = [];

  for (const event of events) {
    const eventMessageKey = event.messageKey.toLowerCase();
    const secret = secretsByMessageKey.get(eventMessageKey);

    if (secret) {
      // We have the secret for this event - it's a claimable bridge
      let status: PendingBridgeStatus = "unknown";
      let leafIndex: bigint | undefined;
      let currentL2Block: bigint | undefined;
      let targetL2Block: bigint | undefined;

      // 4. Check L2 readiness if node is provided
      if (l2Node) {
        const readiness = await checkMessageReadiness(l2Node, event.messageKey, event.messageIndex);
        status = readiness.ready ? "ready" : "pending";
        leafIndex = readiness.leafIndex;
        currentL2Block = readiness.currentL2Block;
        targetL2Block = readiness.targetL2Block;
      }

      bridges.push({
        messageKey: event.messageKey,
        messageIndex: event.messageIndex.toString(),
        amount: event.amount.toString(),
        l1TxHash: event.txHash,
        l1BlockNumber: event.blockNumber,
        secretHash: event.secretHash,
        secret,
        status,
        leafIndex,
        currentL2Block,
        targetL2Block,
      });
    }
  }

  return {
    bridges,
    totalEvents: events.length,
    matchedEvents: bridges.length,
  };
}

/**
 * Get claimable bridges (convenience wrapper that returns just the bridges array)
 */
export async function getClaimableBridges(
  publicClient: PublicClient<Transport, Chain>,
  tokenPortalAddress: Address,
  l2WalletAddress: string,
  l2Node?: AztecNodeClient,
  fromBlock: bigint = 0n
): Promise<PendingBridge[]> {
  const result = await scanPendingBridges(
    publicClient,
    tokenPortalAddress,
    l2WalletAddress,
    l2Node,
    fromBlock
  );
  return result.bridges;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an L1→L2 message is ready to be consumed on L2
 *
 * @param node - Aztec node client
 * @param messageKey - The message key (content hash)
 * @param messageIndex - The message index from L1 event (used as leafIndex fallback)
 */
interface MessageReadinessResult {
  ready: boolean;
  leafIndex?: bigint;
  currentL2Block?: bigint;
  targetL2Block?: bigint;
}

async function checkMessageReadiness(
  node: AztecNodeClient,
  messageKey: string,
  _messageIndex: bigint
): Promise<MessageReadinessResult> {
  try {
    const { Fr } = await import("@aztec/aztec.js/fields");
    const messageLeafFr = Fr.fromString(messageKey);

    const currentBlock = await node.getBlockNumber();
    const messageBlockNumber = await node.getL1ToL2MessageBlock(messageLeafFr);

    // Always include current block info
    const baseResult: MessageReadinessResult = {
      ready: false,
      currentL2Block: BigInt(currentBlock),
      targetL2Block: messageBlockNumber !== undefined ? BigInt(messageBlockNumber) : undefined,
    };

    if (messageBlockNumber === undefined || currentBlock < messageBlockNumber) {
      return baseResult;
    }

    // Get membership witness which includes the actual leaf index
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeAny = node as any;

    if (typeof nodeAny.getL1ToL2MessageMembershipWitness === "function") {
      try {
        const witness = await nodeAny.getL1ToL2MessageMembershipWitness(
          currentBlock,
          messageLeafFr
        );

        if (witness && witness.length >= 2) {
          const leafIndexRaw = witness[0];
          // Handle case where leafIndex might be an object with a value property
          let leafIndex: bigint;
          if (typeof leafIndexRaw === "bigint") {
            leafIndex = leafIndexRaw;
          } else if (typeof leafIndexRaw === "object" && leafIndexRaw !== null) {
            // Try to extract value from object (e.g., Fr type)
            const val =
              (leafIndexRaw as Record<string, unknown>).value ??
              (leafIndexRaw as Record<string, unknown>).inner ??
              leafIndexRaw;
            leafIndex = BigInt(String(val));
          } else {
            leafIndex = BigInt(leafIndexRaw?.toString?.() ?? leafIndexRaw);
          }

          return {
            ...baseResult,
            ready: true,
            leafIndex,
          };
        }
      } catch (err) {
        console.error("[checkMessageReadiness] Error getting witness:", err);
        return baseResult;
      }
    }

    return baseResult;
  } catch {
    return { ready: false };
  }
}

// =============================================================================
// Legacy exports for compatibility (to be removed)
// =============================================================================

/** @deprecated Use scanPendingBridges instead */
export function getPendingBridges(_l2WalletAddress: string): PendingBridge[] {
  console.warn("getPendingBridges is deprecated - use scanPendingBridges instead");
  return [];
}

/** @deprecated Pending bridges are now derived from chain state */
export function addPendingBridge(_l2WalletAddress: string, _bridge: unknown): void {
  console.warn("addPendingBridge is deprecated - bridges are derived from chain state");
}

/** @deprecated Status is derived from chain state */
export function updateBridgeStatus(
  _l2WalletAddress: string,
  _messageKey: string,
  _status: string
): void {
  console.warn("updateBridgeStatus is deprecated - status is derived from chain state");
}

/** @deprecated Status is derived from chain state */
export function markBridgeReady(_l2WalletAddress: string, _messageKey: string): void {
  console.warn("markBridgeReady is deprecated - status is derived from chain state");
}

/** @deprecated Status is derived from chain state */
export function markBridgeClaimed(
  _l2WalletAddress: string,
  _messageKey: string,
  _l2TxHash: string
): void {
  console.warn("markBridgeClaimed is deprecated - use removeSecret after successful claim");
}

/** @deprecated Status is derived from chain state */
export function markBridgeFailed(
  _l2WalletAddress: string,
  _messageKey: string,
  _error: string
): void {
  console.warn("markBridgeFailed is deprecated - status is derived from chain state");
}

/** @deprecated No longer needed */
export function removePendingBridge(_l2WalletAddress: string, _messageKey: string): void {
  console.warn("removePendingBridge is deprecated - use removeSecret after successful claim");
}

/** @deprecated No longer needed */
export function clearPendingBridges(_l2WalletAddress: string): void {
  console.warn("clearPendingBridges is deprecated - bridges are derived from chain state");
}

/** @deprecated Use scanPendingBridges instead */
export function addRecoveredBridge(_l2WalletAddress: string, _bridge: unknown): void {
  console.warn("addRecoveredBridge is deprecated - use scanPendingBridges instead");
}

/** @deprecated Use scanPendingBridges instead */
export function getPendingClaimCount(_l2WalletAddress: string): number {
  console.warn("getPendingClaimCount is deprecated - use scanPendingBridges instead");
  return 0;
}
