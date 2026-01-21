/**
 * L2→L1 Message Proof Service
 *
 * Provides utilities for computing L2→L1 message membership witnesses
 * needed to consume messages on L1 via the Aztec outbox.
 *
 * When an L2 contract sends a message to L1 (e.g., via message_portal()),
 * the message is included in the L2 block's out_hash tree. To consume
 * this message on L1, we need:
 * 1. The L2 block number where the message was included
 * 2. The leaf index of the message in the tree
 * 3. The sibling path (Merkle proof) to the root
 *
 * This service computes these values using the Aztec SDK.
 */

import type { Fr } from "@aztec/aztec.js/fields";
import type { SiblingPath } from "@aztec/foundation/trees";
import type { AztecNodeClient } from "./client.js";

// =============================================================================
// Types
// =============================================================================

/**
 * L2→L1 membership witness containing proof data for outbox consumption
 */
export interface L2ToL1MembershipWitness {
  /** Root of the message tree (for verification) */
  root: Fr;
  /** Leaf index in the combined tree */
  leafIndex: bigint;
  /** Sibling path for Merkle proof */
  siblingPath: SiblingPath<number>;
}

/**
 * Parameters for computing the deposit intent message hash
 */
export interface DepositIntentMessageParams {
  /** L2 sender contract address */
  l2Sender: string;
  /** L1 recipient (portal) address */
  l1Recipient: string;
  /** Intent ID */
  intentId: bigint;
  /** Owner hash (privacy-preserving) */
  ownerHash: bigint;
  /** Asset address on L1 */
  asset: string;
  /** Amount to deposit */
  amount: bigint;
  /** Deadline timestamp */
  deadline: bigint;
  /** Original decimals of the token */
  originalDecimals: number;
}

/**
 * Parameters for computing the withdraw intent message hash
 */
export interface WithdrawIntentMessageParams {
  /** L2 sender contract address */
  l2Sender: string;
  /** L1 recipient (portal) address */
  l1Recipient: string;
  /** Intent ID (same as deposit intent ID for the position) */
  intentId: bigint;
  /** Owner hash (privacy-preserving) */
  ownerHash: bigint;
  /** Amount to withdraw */
  amount: bigint;
  /** Deadline timestamp */
  deadline: bigint;
}

/**
 * Result of waiting for and fetching L2→L1 message proof
 */
export interface L2ToL1MessageProofResult {
  /** Whether the proof was successfully obtained */
  success: boolean;
  /** L2 block number where the message was included */
  l2BlockNumber?: bigint;
  /** Leaf index in the message tree */
  leafIndex?: bigint;
  /** Sibling path as hex strings for L1 contract call */
  siblingPath?: string[];
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Message Hash Computation
// =============================================================================

/**
 * Compute the L2→L1 message hash for a deposit intent.
 *
 * This matches the message content computed by the L2 contract's
 * message_portal() call in request_deposit.
 *
 * @param params - Deposit intent parameters
 * @param chainId - L1 chain ID
 * @param rollupVersion - Aztec rollup version
 * @returns Message hash as Fr
 */
export async function computeDepositIntentMessageHash(
  params: DepositIntentMessageParams,
  chainId: bigint,
  rollupVersion: bigint
): Promise<Fr> {
  const { Fr } = await import("@aztec/aztec.js/fields");
  const { EthAddress } = await import("@aztec/foundation/eth-address");
  const { AztecAddress } = await import("@aztec/stdlib/aztec-address");
  const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
  const { sha256ToField } = await import("@aztec/foundation/crypto/sha256");

  // Compute the message content - matches the intent hash computed in Solidity
  // This is the sha256 hash of the deposit intent fields
  const content = sha256ToField([
    // Function selector for executeDeposit
    Buffer.from(
      "executeDeposit(bytes32,bytes32,address,uint128,uint64,uint8,uint256,uint256,bytes32[])",
      "utf-8"
    ),
    new Fr(params.intentId).toBuffer(),
    new Fr(params.ownerHash).toBuffer(),
    EthAddress.fromString(params.asset).toBuffer32(),
    new Fr(params.amount).toBuffer(),
    new Fr(params.deadline).toBuffer(),
    new Fr(params.originalDecimals).toBuffer(),
  ]);

  return computeL2ToL1MessageHash({
    l2Sender: AztecAddress.fromString(params.l2Sender),
    l1Recipient: EthAddress.fromString(params.l1Recipient),
    content,
    rollupVersion: new Fr(rollupVersion),
    chainId: new Fr(chainId),
  });
}

/**
 * Compute the L2→L1 message hash for a withdraw intent.
 *
 * This matches the message content computed by the L2 contract's
 * message_portal() call in request_withdraw.
 *
 * @param params - Withdraw intent parameters
 * @param chainId - L1 chain ID
 * @param rollupVersion - Aztec rollup version
 * @returns Message hash as Fr
 */
export async function computeWithdrawIntentMessageHash(
  params: WithdrawIntentMessageParams,
  chainId: bigint,
  rollupVersion: bigint
): Promise<Fr> {
  const { Fr } = await import("@aztec/aztec.js/fields");
  const { EthAddress } = await import("@aztec/foundation/eth-address");
  const { AztecAddress } = await import("@aztec/stdlib/aztec-address");
  const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
  const { sha256ToField } = await import("@aztec/foundation/crypto/sha256");

  // Compute the message content - matches the intent hash computed in Solidity
  const content = sha256ToField([
    // Function selector for executeWithdraw
    Buffer.from(
      "executeWithdraw(bytes32,bytes32,uint128,uint64,bytes32,uint256,uint256,bytes32[])",
      "utf-8"
    ),
    new Fr(params.intentId).toBuffer(),
    new Fr(params.ownerHash).toBuffer(),
    new Fr(params.amount).toBuffer(),
    new Fr(params.deadline).toBuffer(),
  ]);

  return computeL2ToL1MessageHash({
    l2Sender: AztecAddress.fromString(params.l2Sender),
    l1Recipient: EthAddress.fromString(params.l1Recipient),
    content,
    rollupVersion: new Fr(rollupVersion),
    chainId: new Fr(chainId),
  });
}

// =============================================================================
// Membership Witness Computation
// =============================================================================

/**
 * Compute the L2→L1 membership witness for a message.
 *
 * This fetches all L2→L1 messages from the specified block and computes
 * the Merkle proof for the target message.
 *
 * @param node - Aztec node client
 * @param l2BlockNumber - L2 block number where the message was included
 * @param message - The message hash to prove
 * @returns Membership witness or undefined if message not found
 */
export async function computeL2ToL1MembershipWitness(
  node: AztecNodeClient,
  l2BlockNumber: number,
  message: Fr
): Promise<L2ToL1MembershipWitness | undefined> {
  const { computeL2ToL1MembershipWitness: computeWitness } = await import(
    "@aztec/stdlib/messaging"
  );

  // Cast to BlockNumber type expected by the SDK
  return computeWitness(node, l2BlockNumber as Parameters<typeof computeWitness>[1], message);
}

// =============================================================================
// Full Proof Fetching
// =============================================================================

/**
 * Wait for an L2→L1 message to be available and fetch its proof.
 *
 * This polls the Aztec node until the message is found in an L2 block,
 * then computes the membership witness.
 *
 * @param node - Aztec node client
 * @param message - The message hash to find
 * @param startBlock - Block number to start searching from (usually the tx block)
 * @param maxWaitMs - Maximum time to wait for the message
 * @param pollIntervalMs - Polling interval
 * @returns Proof result with block number, leaf index, and sibling path
 */
export async function waitForL2ToL1MessageProof(
  node: AztecNodeClient,
  message: Fr,
  startBlock: number,
  maxWaitMs = 180_000,
  pollIntervalMs = 3000
): Promise<L2ToL1MessageProofResult> {
  const startTime = Date.now();
  let currentBlock = startBlock;

  console.log(`[messageProof] Waiting for L2→L1 message proof starting from block ${startBlock}`);
  console.log(`[messageProof] Message hash: ${message.toString()}`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Get the latest block number
      const latestBlock = await node.getBlockNumber();
      console.log(`[messageProof] Checking blocks ${currentBlock} to ${latestBlock}`);

      // Search from current block to latest
      for (let blockNum = currentBlock; blockNum <= latestBlock; blockNum++) {
        const witness = await computeL2ToL1MembershipWitness(node, blockNum, message);

        if (witness) {
          console.log(`[messageProof] Found message in block ${blockNum}`);
          console.log(`[messageProof] Leaf index: ${witness.leafIndex}`);
          console.log(`[messageProof] Sibling path length: ${witness.siblingPath.pathSize}`);

          return {
            success: true,
            l2BlockNumber: BigInt(blockNum),
            leafIndex: witness.leafIndex,
            siblingPath: witness.siblingPath
              .toBufferArray()
              .map((buf: Buffer) => `0x${buf.toString("hex")}`),
          };
        }
      }

      // Update current block to avoid re-checking
      currentBlock = latestBlock + 1;

      console.log(`[messageProof] Message not found yet, waiting ${pollIntervalMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.log(
        `[messageProof] Error checking blocks: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  return {
    success: false,
    error: `Timeout after ${elapsed}s waiting for L2→L1 message proof`,
  };
}

/**
 * Get the rollup version from the outbox contract.
 *
 * @param publicClient - Viem public client
 * @param outboxAddress - Aztec outbox address
 * @returns Rollup version
 */
export async function getOutboxVersion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any,
  outboxAddress: string
): Promise<bigint> {
  const version = await publicClient.readContract({
    address: outboxAddress,
    abi: [
      {
        name: "VERSION",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
      },
    ] as const,
    functionName: "VERSION",
  });

  return version as bigint;
}

/**
 * Check if a message has been consumed at a specific checkpoint.
 *
 * @param publicClient - Viem public client
 * @param outboxAddress - Aztec outbox address
 * @param l2BlockNumber - L2 block number
 * @param leafId - Leaf ID (computed from leafIndex and siblingPath)
 * @returns True if the message has been consumed
 */
export async function hasMessageBeenConsumed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any,
  outboxAddress: string,
  l2BlockNumber: bigint,
  leafId: bigint
): Promise<boolean> {
  const consumed = await publicClient.readContract({
    address: outboxAddress,
    abi: [
      {
        name: "hasMessageBeenConsumedAtCheckpoint",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "_l2BlockNumber", type: "uint256" },
          { name: "_leafId", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ] as const,
    functionName: "hasMessageBeenConsumedAtCheckpoint",
    args: [l2BlockNumber, leafId],
  });

  return consumed as boolean;
}

/**
 * Compute the leaf ID from a membership witness.
 *
 * The leaf ID is: 2^pathSize + leafIndex
 * This ensures stability across different proof lengths.
 *
 * @param leafIndex - Leaf index in the tree
 * @param pathSize - Size of the sibling path
 * @returns Leaf ID
 */
export function computeLeafId(leafIndex: bigint, pathSize: number): bigint {
  return 2n ** BigInt(pathSize) + leafIndex;
}
