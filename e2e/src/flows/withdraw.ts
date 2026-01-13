/**
 * Withdrawal Flow Orchestration Helpers
 *
 * This module provides helper functions for orchestrating the complete withdrawal flow
 * as specified in spec.md §4.2:
 *
 * Flow (L1-only architecture): L2 request → L1 portal → Aave withdraw → L1 confirm → L2 finalize
 *
 * The withdrawal flow consists of 4 steps:
 * 1. User initiates on L2 (private) - request_withdraw consumes receipt, creates L2→L1 message
 * 2. L1 portal executes (public) - consumes message, withdraws from Aave directly
 * 3. L1 portal sends tokens to Aztec - sends L1→L2 message
 * 4. L2 finalizes (private) - consumes message, nullifies pending note, user gets tokens
 *
 * Privacy Property:
 * - The relayer executing L1 steps should be different from the user
 * - L2 owner address is NEVER included in cross-chain messages
 * - Authentication uses secret/secretHash mechanism
 *
 * Note: This is the simplified L1-only architecture where Aave operations
 * happen directly on L1, eliminating the need for Wormhole bridging.
 */

import type { Address, Hex, WalletClient } from "viem";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import type { ChainClient } from "../setup";
import { ConfirmationStatus, type RelayerConfig } from "./deposit";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Withdrawal request parameters for L2 request
 */
export interface WithdrawRequestParams {
  /** Nonce of the PositionReceiptNote (same as intent_id from deposit) */
  nonce: bigint;
  /** Amount of shares to withdraw (must equal total shares for MVP) */
  amount: bigint;
  /** Asset ID (Field element) */
  assetId: bigint;
  /** Deadline timestamp (seconds) */
  deadline: bigint;
  /** Secret hash for authorization */
  secretHash: bigint;
}

/**
 * Result of a withdrawal request on L2
 */
export interface WithdrawRequestResult {
  /** The computed intent ID (same as deposit intent_id for the position) */
  intentId: bigint;
  /** Transaction hash on L2 */
  txHash: string;
  /** Owner hash (privacy-preserving) */
  ownerHash: bigint;
}

/**
 * L1 execution parameters for withdrawal
 */
export interface L1ExecuteWithdrawParams {
  /** The withdraw intent from L2 */
  intent: {
    intentId: Hex;
    ownerHash: Hex;
    amount: bigint;
    deadline: bigint;
  };
  /** L2 block number for outbox proof */
  l2BlockNumber: bigint;
  /** Leaf index in outbox tree */
  leafIndex: bigint;
  /** Sibling path for merkle proof */
  siblingPath: Hex[];
}

/**
 * Result of L1 portal execution for withdrawal (L1-only architecture)
 */
export interface L1ExecuteWithdrawResult {
  /** Transaction hash on L1 */
  txHash: Hex;
  /** Whether execution succeeded */
  success: boolean;
  /** Amount actually withdrawn from Aave */
  withdrawnAmount?: bigint;
}

/**
 * Full withdrawal flow result (L1-only architecture)
 */
export interface FullWithdrawFlowResult {
  /** L2 request result */
  l2Request: WithdrawRequestResult;
  /** L1 execution result (includes Aave withdrawal) */
  l1Execute: L1ExecuteWithdrawResult;
  /** L2 finalization result */
  l2Finalize: { success: boolean; txHash?: string };
  /** Privacy verification passed */
  privacyVerified: boolean;
}

/**
 * Relayer configuration for privacy testing (withdrawal specific)
 * Re-exported from deposit module for consistency
 */
export type { RelayerConfig } from "./deposit";

// =============================================================================
// Withdrawal Flow Orchestrator
// =============================================================================

/**
 * WithdrawFlowOrchestrator manages the complete withdrawal flow for L1-only architecture.
 *
 * This class coordinates:
 * - L2 Aztec contract interactions
 * - L1 portal execution with direct Aave withdrawal
 * - Privacy verification
 *
 * Note: This is the simplified L1-only architecture. Aave operations happen
 * directly on L1, eliminating the need for cross-chain Wormhole messaging.
 *
 * @example
 * ```ts
 * const orchestrator = new WithdrawFlowOrchestrator(l1Client, addresses);
 * await orchestrator.initialize();
 *
 * const result = await orchestrator.executeFullWithdraw(
 *   l2Contract,
 *   userWallet,
 *   {
 *     nonce: depositIntentId,
 *     amount: 1_000_000n,
 *     assetId: 1n,
 *     deadline: deadlineFromOffset(3600),
 *     secretHash: secretHashValue,
 *   },
 *   secret,
 *   relayerConfig,
 *   userAddress
 * );
 *
 * expect(result.privacyVerified).toBe(true);
 * ```
 */
export class WithdrawFlowOrchestrator {
  private l1Client: ChainClient;
  private addresses: {
    l1Portal: Address;
    aavePool: Address;
    l2Contract: Hex;
  };
  private useMock: boolean;

  constructor(
    l1Client: ChainClient,
    addresses: {
      l1Portal: Address;
      aavePool: Address;
      l2Contract: Hex;
    },
    useMock: boolean = true
  ) {
    this.l1Client = l1Client;
    this.addresses = addresses;
    this.useMock = useMock;
  }

  /**
   * Initialize the orchestrator.
   */
  async initialize(): Promise<void> {
    // No Wormhole mock needed in L1-only architecture
    // Just verify we have the required addresses
    if (!this.addresses.l1Portal || !this.addresses.aavePool) {
      throw new Error("L1 portal and Aave pool addresses are required");
    }
  }

  /**
   * Execute the full withdrawal flow from L2 to L1 Aave and back.
   *
   * This implements the L1-only withdrawal flow:
   * 1. L2 request_withdraw
   * 2. L1 executeWithdraw (consumes message, withdraws from Aave, sends confirmation)
   * 3. L2 finalize_withdraw
   *
   * @param l2Contract L2 contract instance
   * @param userWallet User's wallet
   * @param params Withdrawal parameters
   * @param secret Secret for finalization
   * @param relayer Relayer configuration (must be different from user for privacy)
   * @param userAddress User's address (for privacy verification)
   * @returns Full flow result including privacy verification
   */
  async executeFullWithdraw(
    l2Contract: unknown, // Contract instance
    userWallet: unknown, // User wallet
    params: WithdrawRequestParams,
    secret: bigint, // Secret for finalization
    relayer: RelayerConfig,
    userAddress: Address
  ): Promise<FullWithdrawFlowResult> {
    // Step 1: Execute L2 request_withdraw
    const l2Request = await this.executeL2Request(l2Contract, userWallet, params);

    // Step 2: Execute L1 portal withdrawal with direct Aave withdrawal (relayer executes, not user)
    const l1Execute = await this.executeL1Withdraw(
      relayer.l1Relayer,
      l2Request,
      params
    );

    // Privacy check: L1 executor should not be the user
    const l1ExecutorAddress = relayer.l1Relayer.account?.address;
    const privacyCheckL1 = l1ExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 3: L2 finalize_withdraw (user executes)
    const withdrawnAmount = l1Execute.withdrawnAmount || params.amount;
    const l2Finalize = await this.executeL2Finalize(
      l2Contract,
      userWallet,
      l2Request.intentId,
      params.assetId,
      withdrawnAmount,
      secret
    );

    return {
      l2Request,
      l1Execute,
      l2Finalize,
      privacyVerified: privacyCheckL1,
    };
  }

  /**
   * Step 1: Execute withdrawal request on L2.
   */
  private async executeL2Request(
    l2Contract: unknown,
    userWallet: unknown,
    params: WithdrawRequestParams
  ): Promise<WithdrawRequestResult> {
    // Type assertion for aztec.js contract
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = l2Contract as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = userWallet as any;

    const contractWithWallet = contract.withWallet(wallet);
    const methods = contractWithWallet.methods;

    // Create call instance
    const withdrawCall = methods.request_withdraw(
      params.nonce,
      params.amount,
      params.deadline,
      params.secretHash
    );

    // Simulate to get intent ID
    const intentId = await withdrawCall.simulate();

    // Send transaction
    const tx = await withdrawCall.send().wait();

    // Compute owner hash using same logic as contract
    const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");

    const ownerAddress = wallet.getAddress().toBigInt();
    const ownerHash = (await poseidon2Hash([ownerAddress])).toBigInt();

    return {
      intentId: intentId.toBigInt(),
      txHash: tx.txHash?.toString() || "",
      ownerHash,
    };
  }

  /**
   * Step 2: Execute withdrawal on L1 portal with direct Aave withdrawal.
   *
   * In L1-only architecture, the portal:
   * 1. Consumes the L2→L1 message
   * 2. Withdraws tokens directly from Aave on L1
   * 3. Sends L1→L2 confirmation message
   */
  private async executeL1Withdraw(
    l1Relayer: WalletClient,
    l2Request: WithdrawRequestResult,
    params: WithdrawRequestParams
  ): Promise<L1ExecuteWithdrawResult> {
    // In mock mode, we simulate the L1 portal execution with direct Aave withdrawal
    if (this.useMock) {
      // For mock tests, we simulate successful execution
      // The actual L1 portal would:
      // 1. Consume the outbox message
      // 2. Withdraw from Aave directly (no Wormhole bridging)
      // 3. Send L1→L2 confirmation
      const mockTxHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, uint256, uint256"),
          [`0x${l2Request.intentId.toString(16).padStart(64, "0")}`, params.amount, params.deadline]
        )
      );

      // MVP: withdrawnAmount = amount (no yield accounting in mock)
      return {
        txHash: mockTxHash,
        success: true,
        withdrawnAmount: params.amount,
      };
    }

    // Real execution would call the L1 portal contract's executeWithdraw function
    // This requires proper outbox proof generation from Aztec
    throw new Error("Real L1 execution not yet implemented - requires outbox proof generation");
  }

  /**
   * Step 3: Finalize withdrawal on L2.
   */
  private async executeL2Finalize(
    l2Contract: unknown,
    userWallet: unknown,
    intentId: bigint,
    assetId: bigint,
    amount: bigint,
    secret: bigint
  ): Promise<{ success: boolean; txHash?: string }> {
    // Type assertion for aztec.js contract
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = l2Contract as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = userWallet as any;

    try {
      const contractWithWallet = contract.withWallet(wallet);
      const methods = contractWithWallet.methods;

      // Call finalize_withdraw
      // Signature: finalize_withdraw(intent_id, asset_id, amount, secret, message_leaf_index)
      // message_leaf_index is 0 for mock mode (no real L1->L2 message)
      const tx = await methods
        .finalize_withdraw(intentId, assetId, amount, secret, 0n)
        .send()
        .wait();

      return {
        success: true,
        txHash: tx.txHash?.toString(),
      };
    } catch (error) {
      // In mock mode without real L1→L2 messages, finalization will fail
      // This is expected - the mock tests the flow structure, not actual message passing
      if (this.useMock) {
        return {
          success: false,
          txHash: undefined,
        };
      }
      throw error;
    }
  }

  /**
   * Reset the orchestrator state (for test isolation).
   */
  reset(): void {
    // No state to reset in L1-only architecture
    // (Wormhole mock was removed)
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Verify that the relayer address is different from the user.
 *
 * This is a key privacy property of the protocol.
 *
 * Note: In L1-only architecture, there is only one relayer (L1).
 * The targetRelayerAddress parameter is kept for backward compatibility
 * but should be the same as l1RelayerAddress.
 */
export function verifyWithdrawRelayerPrivacy(
  userAddress: Address,
  l1RelayerAddress: Address,
  targetRelayerAddress?: Address
): {
  l1PrivacyOk: boolean;
  targetPrivacyOk: boolean;
  allPrivacyOk: boolean;
} {
  const l1PrivacyOk = userAddress.toLowerCase() !== l1RelayerAddress.toLowerCase();
  // In L1-only mode, targetRelayerAddress is optional or same as L1 relayer
  const targetRelayer = targetRelayerAddress || l1RelayerAddress;
  const targetPrivacyOk = userAddress.toLowerCase() !== targetRelayer.toLowerCase();

  return {
    l1PrivacyOk,
    targetPrivacyOk,
    allPrivacyOk: l1PrivacyOk && targetPrivacyOk,
  };
}

/**
 * Create a withdrawal flow orchestrator with standard configuration.
 */
export function createWithdrawOrchestrator(
  l1Client: ChainClient,
  addresses: {
    l1Portal: Address;
    aavePool: Address;
    l2Contract: Hex;
  },
  useMock: boolean = true
): WithdrawFlowOrchestrator {
  return new WithdrawFlowOrchestrator(l1Client, addresses, useMock);
}
