/**
 * Deposit Proof Status Poller
 *
 * Single-shot async function that checks whether a pending deposit's L2 block
 * has been proven on L1. Called by the UI hook on a ~30-second interval.
 *
 * Status progression:
 *   'waiting_for_proof'      — L2→L1 message proof not yet available
 *   'waiting_for_checkpoint'  — Proof obtained but L2 block not yet checkpointed on L1
 *   'ready'                   — Checkpoint proven, deposit can be executed on L1
 *   'error'                   — Unexpected failure
 */

import type { Chain, PublicClient, Transport } from "viem";
import type { AztecNodeClient } from "./l2/client.js";
import { bigIntToBytes32, sha256ToField } from "./l2/crypto.js";
import { getOutboxVersion, waitForL2ToL1MessageProof } from "./l2/messageProof.js";
import type { PendingDeposit } from "./pendingDeposits.js";

// =============================================================================
// Types
// =============================================================================

/** Proof readiness status for a pending deposit */
export type DepositProofStatus = "waiting_for_proof" | "waiting_for_checkpoint" | "ready" | "error";

/** Result of a single proof status check */
export interface DepositProofCheckResult {
  /** Current status of the deposit proof */
  status: DepositProofStatus;
  /** Human-readable description */
  message: string;
  /** L2 block number where the message was found (if proof obtained) */
  l2BlockNumber?: bigint;
}

// =============================================================================
// Constants
// =============================================================================

/** Short timeout for non-blocking proof check (5 seconds, single poll) */
const PROOF_CHECK_TIMEOUT_MS = 5_000;

/** Single poll cycle — we only want one attempt per check */
const PROOF_CHECK_POLL_INTERVAL_MS = 5_000;

// =============================================================================
// getRootData ABI fragment (inline to avoid extra imports)
// =============================================================================

const GET_ROOT_DATA_ABI = [
  {
    name: "getRootData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_l2BlockNumber", type: "uint256" }],
    outputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "uint256" },
    ],
  },
] as const;

// =============================================================================
// Main check function
// =============================================================================

/**
 * Check the proof status of a pending deposit.
 *
 * Performs a quick, non-blocking check:
 * 1. Computes the L2→L1 message hash from PendingDeposit fields
 * 2. Attempts to fetch the message proof (5s timeout, 1 poll)
 * 3. If proof found, checks whether the L2 block is checkpointed on L1
 *
 * @param pending - The pending deposit to check
 * @param node - Aztec node client for L2 queries
 * @param publicClient - Viem public client for L1 queries
 * @param outboxAddress - L1 Aztec outbox address
 * @param portalAddress - L1 portal contract address
 * @returns Proof status check result
 */
export async function checkDepositProofStatus(
  pending: PendingDeposit,
  node: AztecNodeClient,
  publicClient: PublicClient<Transport, Chain>,
  outboxAddress: string,
  portalAddress: string
): Promise<DepositProofCheckResult> {
  try {
    // =========================================================================
    // Step 1: Compute L2→L1 message hash
    // =========================================================================

    // Get rollup version and chain ID for message hash computation
    const rollupVersion = await getOutboxVersion(publicClient, outboxAddress);
    const chainId = BigInt(await publicClient.getChainId());

    // Compute content hash matching L2 contract's compute_deposit_message_content
    // Field order: [intentId, ownerHash, asset, netAmount, originalDecimals, deadline, salt, secretHash]
    const contentFields = [
      BigInt(pending.intentId),
      BigInt(pending.ownerHash),
      BigInt(pending.asset),
      BigInt(pending.netAmount),
      BigInt(pending.originalDecimals),
      BigInt(pending.deadline),
      BigInt(pending.salt),
      BigInt(pending.secretHash),
    ];

    const packedData = new Uint8Array(contentFields.length * 32);
    for (let i = 0; i < contentFields.length; i++) {
      packedData.set(bigIntToBytes32(contentFields[i]), i * 32);
    }
    const contentHash = await sha256ToField(packedData);

    // Compute L2→L1 message hash
    const { Fr: FrClass } = await import("@aztec/aztec.js/fields");
    const { computeL2ToL1MessageHash } = await import("@aztec/stdlib/hash");
    const { EthAddress } = await import("@aztec/foundation/eth-address");
    const { AztecAddress: AztecAddressClass } = await import("@aztec/stdlib/aztec-address");

    const l2ToL1Message = await computeL2ToL1MessageHash({
      l2Sender: AztecAddressClass.fromString(pending.l2ContractAddress),
      l1Recipient: EthAddress.fromString(portalAddress),
      content: contentHash,
      rollupVersion: new FrClass(rollupVersion),
      chainId: new FrClass(chainId),
    });

    // =========================================================================
    // Step 2: Quick-check for L2→L1 message proof
    // =========================================================================

    const l2TxBlockNumber = Number(pending.l2BlockNumber) || (await node.getBlockNumber());

    const proofResult = await waitForL2ToL1MessageProof(
      node,
      l2ToL1Message,
      l2TxBlockNumber,
      PROOF_CHECK_TIMEOUT_MS,
      PROOF_CHECK_POLL_INTERVAL_MS
    );

    if (!proofResult.success) {
      return {
        status: "waiting_for_proof",
        message: "L2→L1 message proof not yet available",
      };
    }

    // =========================================================================
    // Step 3: Check if L2 block checkpoint is proven on L1
    // =========================================================================

    try {
      await publicClient.readContract({
        address: outboxAddress as `0x${string}`,
        abi: GET_ROOT_DATA_ABI,
        functionName: "getRootData",
        args: [proofResult.l2BlockNumber!],
      });

      // getRootData succeeded — checkpoint is proven
      return {
        status: "ready",
        message: `Deposit ready for L1 execution (L2 block ${proofResult.l2BlockNumber} proven)`,
        l2BlockNumber: proofResult.l2BlockNumber,
      };
    } catch {
      // getRootData reverts with Outbox__CheckpointNotProven when not yet proven
      return {
        status: "waiting_for_checkpoint",
        message: `L2 block ${proofResult.l2BlockNumber} not yet checkpointed on L1`,
        l2BlockNumber: proofResult.l2BlockNumber,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[depositProofPoller] Error checking proof status:", message);
    return {
      status: "error",
      message: `Proof check failed: ${message}`,
    };
  }
}
