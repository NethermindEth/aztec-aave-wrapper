/**
 * Withdrawal Flow Orchestration Helpers
 *
 * This module provides helper functions for orchestrating the complete withdrawal flow
 * as specified in spec.md §4.2:
 *
 * Flow: L2 request → L1 bridge → Target Aave withdraw → Bridge back → L1 → L2 finalize
 *
 * The withdrawal flow consists of 5 steps:
 * 1. User initiates on L2 (private) - request_withdraw consumes receipt, creates L2→L1 message
 * 2. L1 portal executes (public) - consumes message, sends Wormhole to target
 * 3. Target executor withdraws from Aave - receives message, calls pool.withdraw, bridges tokens back
 * 4. L1 portal receives tokens - bridges tokens to Aztec, sends L1→L2 message
 * 5. L2 finalizes (private) - consumes message, nullifies pending note, user gets tokens
 *
 * Privacy Property:
 * - The relayer executing L1/Target steps should be different from the user
 * - L2 owner address is NEVER included in cross-chain messages
 * - Authentication uses secret/secretHash mechanism
 */

import type { Address, Hex, WalletClient } from "viem";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import type { ChainClient } from "../setup";
import {
  WormholeMock,
  ConfirmationStatus,
} from "../utils/wormhole-mock";
import type { RelayerConfig } from "./deposit";

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
  /** Target chain ID */
  targetChainId: number;
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
    targetChainId: number;
  };
  /** L2 block number for outbox proof */
  l2BlockNumber: bigint;
  /** Leaf index in outbox tree */
  leafIndex: bigint;
  /** Sibling path for merkle proof */
  siblingPath: Hex[];
}

/**
 * Result of L1 portal execution for withdrawal
 */
export interface L1ExecuteWithdrawResult {
  /** Transaction hash on L1 */
  txHash: Hex;
  /** Whether execution succeeded */
  success: boolean;
  /** Wormhole sequence number (for tracking) */
  wormholeSequence?: bigint;
}

/**
 * Target executor withdrawal result
 */
export interface TargetWithdrawResult {
  /** Transaction hash on target chain */
  txHash: Hex;
  /** Whether execution succeeded */
  success: boolean;
  /** Amount actually withdrawn from Aave */
  withdrawnAmount: bigint;
  /** Confirmation status */
  status: ConfirmationStatus;
}

/**
 * Full withdrawal flow result
 */
export interface FullWithdrawFlowResult {
  /** L2 request result */
  l2Request: WithdrawRequestResult;
  /** L1 execution result */
  l1Execute: L1ExecuteWithdrawResult;
  /** Target execution result */
  targetExecute: TargetWithdrawResult;
  /** L1 token bridge back result */
  l1TokenBridge: { success: boolean; txHash?: Hex };
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
 * WithdrawFlowOrchestrator manages the complete withdrawal flow across all chains.
 *
 * This class coordinates:
 * - L2 Aztec contract interactions
 * - L1 portal execution
 * - Wormhole message delivery (mock or testnet)
 * - Target chain Aave withdrawal
 * - Token bridge back to L1
 * - Privacy verification
 *
 * @example
 * ```ts
 * const orchestrator = new WithdrawFlowOrchestrator(harness);
 * await orchestrator.initialize();
 *
 * const result = await orchestrator.executeFullWithdraw({
 *   nonce: depositIntentId,
 *   amount: 1_000_000n,
 *   assetId: 1n,
 *   targetChainId: 23,
 *   deadline: deadlineFromOffset(3600),
 *   secretHash: secretHashValue,
 * }, relayerConfig);
 *
 * expect(result.privacyVerified).toBe(true);
 * ```
 */
export class WithdrawFlowOrchestrator {
  private l1Client: ChainClient;
  private targetClient: ChainClient;
  private wormholeMock: WormholeMock | null = null;
  private addresses: {
    l1Portal: Address;
    targetExecutor: Address;
    l2Contract: Hex;
  };
  private useMock: boolean;

  constructor(
    l1Client: ChainClient,
    targetClient: ChainClient,
    addresses: {
      l1Portal: Address;
      targetExecutor: Address;
      l2Contract: Hex;
    },
    useMock: boolean = true
  ) {
    this.l1Client = l1Client;
    this.targetClient = targetClient;
    this.addresses = addresses;
    this.useMock = useMock;
  }

  /**
   * Initialize the orchestrator and set up Wormhole mock if needed.
   */
  async initialize(): Promise<void> {
    if (this.useMock) {
      this.wormholeMock = new WormholeMock(this.l1Client, this.targetClient);
      this.wormholeMock.initialize({
        l1Portal: this.addresses.l1Portal,
        targetExecutor: this.addresses.targetExecutor,
      });
    }
  }

  /**
   * Execute the full withdrawal flow from L2 to Target and back.
   *
   * This implements the complete spec.md §4.2 withdrawal flow:
   * 1. L2 request_withdraw
   * 2. L1 executeWithdraw
   * 3. Target executeWithdraw (Aave pool.withdraw)
   * 4. Target bridges tokens back to L1
   * 5. L1 receives tokens, bridges to Aztec, sends L1->L2 message
   * 6. L2 finalize_withdraw
   *
   * @param params Withdrawal parameters
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

    // Step 2: Execute L1 portal withdrawal (relayer executes, not user)
    const l1Execute = await this.executeL1Withdraw(
      relayer.l1Relayer,
      l2Request,
      params
    );

    // Privacy check: L1 executor should not be the user
    const l1ExecutorAddress = relayer.l1Relayer.account?.address;
    const privacyCheckL1 = l1ExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 3: Execute target chain Aave withdrawal (via Wormhole delivery)
    const targetExecute = await this.executeTargetWithdraw(
      relayer.targetRelayer,
      l2Request.intentId,
      params
    );

    // Privacy check: Target executor should not be the user
    const targetExecutorAddress = relayer.targetRelayer.account?.address;
    const privacyCheckTarget = targetExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 4: Bridge tokens back to L1 and then to Aztec
    const l1TokenBridge = await this.bridgeTokensToL1(
      l2Request.intentId,
      targetExecute.withdrawnAmount,
      params.assetId
    );

    // Step 5: L2 finalize_withdraw (user executes)
    const l2Finalize = await this.executeL2Finalize(
      l2Contract,
      userWallet,
      l2Request.intentId,
      params.assetId,
      targetExecute.withdrawnAmount,
      params.targetChainId,
      secret
    );

    return {
      l2Request,
      l1Execute,
      targetExecute,
      l1TokenBridge,
      l2Finalize,
      privacyVerified: privacyCheckL1 && privacyCheckTarget,
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
   * Step 2: Execute withdrawal on L1 portal.
   */
  private async executeL1Withdraw(
    l1Relayer: WalletClient,
    l2Request: WithdrawRequestResult,
    params: WithdrawRequestParams
  ): Promise<L1ExecuteWithdrawResult> {
    // In mock mode, we simulate the L1 portal execution
    if (this.useMock) {
      // For mock tests, we simulate successful execution
      // The actual L1 portal would consume the outbox message and bridge via Wormhole
      const mockTxHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, uint256, uint256"),
          [`0x${l2Request.intentId.toString(16).padStart(64, "0")}`, params.amount, params.deadline]
        )
      );

      return {
        txHash: mockTxHash,
        success: true,
        wormholeSequence: BigInt(Math.floor(Math.random() * 1000000)),
      };
    }

    // Real execution would call the L1 portal contract
    // This requires proper outbox proof generation from Aztec
    throw new Error("Real L1 execution not yet implemented - requires outbox proof generation");
  }

  /**
   * Step 3: Execute withdrawal on target chain (Aave withdraw).
   */
  private async executeTargetWithdraw(
    targetRelayer: WalletClient,
    intentId: bigint,
    params: WithdrawRequestParams
  ): Promise<TargetWithdrawResult> {
    // In mock mode, simulate the target execution
    if (this.useMock) {
      // Simulate Wormhole delivery to target
      if (this.wormholeMock) {
        const deliveryResult = await this.wormholeMock.deliverWithdrawToTarget(
          intentId,
          params.amount,
          params.deadline
        );

        if (!deliveryResult.success) {
          return {
            txHash: "0x" as Hex,
            success: false,
            withdrawnAmount: 0n,
            status: ConfirmationStatus.Failed,
          };
        }
      }

      // Mock successful Aave withdrawal
      // In real execution, this would call consumeAndExecuteWithdraw with VAA
      const mockTxHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, uint256"),
          [`0x${intentId.toString(16).padStart(64, "0")}`, params.amount]
        )
      );

      // MVP: withdrawnAmount = amount (no yield accounting)
      return {
        txHash: mockTxHash,
        success: true,
        withdrawnAmount: params.amount,
        status: ConfirmationStatus.Success,
      };
    }

    // Real execution would call AaveExecutorTarget.consumeAndExecuteWithdraw
    throw new Error("Real target execution not yet implemented - requires VAA");
  }

  /**
   * Step 4: Bridge tokens back from target to L1 and then to Aztec.
   */
  private async bridgeTokensToL1(
    intentId: bigint,
    amount: bigint,
    assetId: bigint
  ): Promise<{ success: boolean; txHash?: Hex }> {
    if (this.useMock && this.wormholeMock) {
      // Simulate token bridge back and confirmation to L1
      const result = await this.wormholeMock.deliverWithdrawConfirmation(
        intentId,
        amount,
        ConfirmationStatus.Success
      );
      return {
        success: result.success,
        txHash: result.txHash,
      };
    }

    // Real execution would wait for Wormhole VAA delivery and token bridge
    throw new Error("Real token bridge not yet implemented");
  }

  /**
   * Step 5: Finalize withdrawal on L2.
   */
  private async executeL2Finalize(
    l2Contract: unknown,
    userWallet: unknown,
    intentId: bigint,
    assetId: bigint,
    amount: bigint,
    targetChainId: number,
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
      // message_leaf_index is 0 for mock mode (no real L1->L2 message)
      const tx = await methods
        .finalize_withdraw(intentId, assetId, amount, targetChainId, secret, 0n)
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
    if (this.wormholeMock) {
      this.wormholeMock.reset();
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Verify that the relayer addresses are different from the user.
 *
 * This is a key privacy property of the protocol.
 */
export function verifyWithdrawRelayerPrivacy(
  userAddress: Address,
  l1RelayerAddress: Address,
  targetRelayerAddress: Address
): {
  l1PrivacyOk: boolean;
  targetPrivacyOk: boolean;
  allPrivacyOk: boolean;
} {
  const l1PrivacyOk = userAddress.toLowerCase() !== l1RelayerAddress.toLowerCase();
  const targetPrivacyOk = userAddress.toLowerCase() !== targetRelayerAddress.toLowerCase();

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
  targetClient: ChainClient,
  addresses: {
    l1Portal: Address;
    targetExecutor: Address;
    l2Contract: Hex;
  },
  useMock: boolean = true
): WithdrawFlowOrchestrator {
  return new WithdrawFlowOrchestrator(l1Client, targetClient, addresses, useMock);
}
