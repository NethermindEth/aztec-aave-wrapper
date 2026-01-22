/**
 * Deposit Flow Orchestration Helpers
 *
 * This module provides helper functions for orchestrating the complete deposit flow
 * as specified in spec.md §4.1:
 *
 * Flow (L1-only architecture): L2 request → L1 portal → Aave supply → L1 confirm → L2 finalize
 *
 * The deposit flow consists of 5 steps:
 * 1. User initiates on L2 (private) - request_deposit creates intent and L2→L1 message
 * 2. L1 portal executes (public) - consumes message, supplies to Aave directly
 * 3. L1 portal sends confirmation to Aztec - sends L1→L2 message with shares
 * 4. L2 finalizes (private) - creates PositionReceiptNote
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
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import type { ChainClient } from "../setup";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Confirmation status for deposit/withdraw operations
 */
export enum ConfirmationStatus {
  Success = 0,
  Failed = 1,
}

/**
 * Deposit intent parameters for L2 request
 */
export interface DepositRequestParams {
  /** Asset ID (Field element) */
  assetId: bigint;
  /** Amount to deposit */
  amount: bigint;
  /** Original token decimals (e.g., 6 for USDC) */
  originalDecimals: number;
  /** Deadline timestamp (seconds) */
  deadline: bigint;
  /** Secret for authorization */
  secret: bigint;
}

/**
 * Result of a deposit request on L2
 */
export interface DepositRequestResult {
  /** The computed intent ID */
  intentId: bigint;
  /** Transaction hash on L2 */
  txHash: string;
  /** Secret hash for claiming */
  secretHash: bigint;
  /** Owner hash (privacy-preserving) */
  ownerHash: bigint;
}

/**
 * L1 execution parameters
 */
export interface L1ExecuteDepositParams {
  /** The deposit intent from L2 */
  intent: {
    intentId: Hex;
    ownerHash: Hex;
    asset: Address;
    amount: bigint;
    deadline: bigint;
    originalDecimals: number;
  };
  /** L2 block number for outbox proof */
  l2BlockNumber: bigint;
  /** Leaf index in outbox tree */
  leafIndex: bigint;
  /** Sibling path for merkle proof */
  siblingPath: Hex[];
}

/**
 * Result of L1 portal execution
 */
export interface L1ExecuteResult {
  /** Transaction hash on L1 */
  txHash: Hex;
  /** Whether execution succeeded */
  success: boolean;
  /** Shares received from Aave supply */
  shares?: bigint;
  /** Message leaf index for L1→L2 message (needed for finalization) */
  messageLeafIndex?: bigint;
}

/**
 * Full deposit flow result (L1-only architecture)
 */
export interface FullDepositFlowResult {
  /** L2 request result */
  l2Request: DepositRequestResult;
  /** L1 execution result (includes Aave supply) */
  l1Execute: L1ExecuteResult;
  /** L2 finalization result */
  l2Finalize: { success: boolean; txHash?: string };
  /** Privacy verification passed */
  privacyVerified: boolean;
}

/**
 * Relayer configuration for privacy testing
 */
export interface RelayerConfig {
  /** L1 relayer wallet client */
  l1Relayer: WalletClient;
}

// =============================================================================
// Deposit Flow Orchestrator
// =============================================================================

/**
 * DepositFlowOrchestrator manages the complete deposit flow for L1-only architecture.
 *
 * This class coordinates:
 * - L2 Aztec contract interactions
 * - L1 portal execution with direct Aave supply
 * - Privacy verification
 *
 * Note: This is the simplified L1-only architecture. Aave operations happen
 * directly on L1, eliminating the need for cross-chain Wormhole messaging.
 *
 * @example
 * ```ts
 * const orchestrator = new DepositFlowOrchestrator(l1Client, addresses);
 * await orchestrator.initialize();
 *
 * const result = await orchestrator.executeFullDeposit(
 *   l2Contract,
 *   userWallet,
 *   {
 *     assetId: 1n,
 *     amount: 1_000_000n,
 *     originalDecimals: 6,
 *     deadline: deadlineFromOffset(3600),
 *     secret: Fr.random().toBigInt(),
 *   },
 *   relayerConfig,
 *   userAddress
 * );
 *
 * expect(result.privacyVerified).toBe(true);
 * ```
 */
export class DepositFlowOrchestrator {
  private addresses: {
    l1Portal: Address;
    aavePool: Address;
    l2Contract: Hex;
  };
  private useMock: boolean;

  constructor(
    _l1Client: ChainClient,
    addresses: {
      l1Portal: Address;
      aavePool: Address;
      l2Contract: Hex;
    },
    useMock: boolean = true
  ) {
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
   * Execute the full deposit flow from L2 to L1 Aave and back.
   *
   * This implements the L1-only deposit flow:
   * 1. L2 request_deposit
   * 2. L1 executeDeposit (consumes message, supplies to Aave, sends confirmation)
   * 3. L2 finalize_deposit
   *
   * @param l2Contract L2 contract instance
   * @param userWallet User's wallet
   * @param params Deposit parameters
   * @param relayer Relayer configuration (must be different from user for privacy)
   * @param userAddress User's address (for privacy verification)
   * @returns Full flow result including privacy verification
   */
  async executeFullDeposit(
    l2Contract: unknown, // Contract instance
    userWallet: unknown, // User wallet
    params: DepositRequestParams,
    relayer: RelayerConfig,
    userAddress: Address
  ): Promise<FullDepositFlowResult> {
    // Step 1: Execute L2 request_deposit
    const l2Request = await this.executeL2Request(l2Contract, userWallet, params);

    // Step 2: Execute L1 portal deposit with direct Aave supply (relayer executes, not user)
    const l1Execute = await this.executeL1Deposit(
      relayer.l1Relayer,
      l2Request,
      params,
      userAddress
    );

    // Privacy check: L1 executor should not be the user
    const l1ExecutorAddress = relayer.l1Relayer.account?.address;
    const privacyCheckL1 = l1ExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 3: L2 finalize_deposit (user executes)
    const shares = l1Execute.shares || params.amount; // MVP: shares = amount
    const messageLeafIndex = l1Execute.messageLeafIndex ?? 0n;
    const l2Finalize = await this.executeL2Finalize(
      l2Contract,
      userWallet,
      l2Request.intentId,
      params.assetId,
      params.secret,
      shares,
      messageLeafIndex
    );

    return {
      l2Request,
      l1Execute,
      l2Finalize,
      privacyVerified: privacyCheckL1,
    };
  }

  /**
   * Step 1: Execute deposit request on L2.
   */
  private async executeL2Request(
    l2Contract: unknown,
    userWallet: unknown,
    params: DepositRequestParams
  ): Promise<DepositRequestResult> {
    // Type assertion for aztec.js contract
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = l2Contract as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = userWallet as any;

    const contractWithWallet = contract.withWallet(wallet);
    const methods = contractWithWallet.methods;

    // Create call instance
    // Signature: request_deposit(asset, amount, original_decimals, deadline, secret_hash)
    const depositCall = methods.request_deposit(
      params.assetId,
      params.amount,
      params.originalDecimals,
      params.deadline,
      params.secret
    );

    // Simulate to get intent ID
    const intentId = await depositCall.simulate();

    // Send transaction
    const tx = await depositCall.send().wait();

    // Compute secret hash and owner hash using same logic as contract
    const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");
    const { computeSecretHash } = await import("@aztec/stdlib/hash");
    const { Fr } = await import("@aztec/aztec.js/fields");

    const secretHash = (await computeSecretHash(new Fr(params.secret))).toBigInt();
    const ownerAddress = wallet.getAddress().toBigInt();
    const ownerHash = (await poseidon2Hash([ownerAddress])).toBigInt();

    return {
      intentId: intentId.toBigInt(),
      txHash: tx.txHash?.toString() || "",
      secretHash,
      ownerHash,
    };
  }

  /**
   * Step 2: Execute deposit on L1 portal with direct Aave supply.
   *
   * In L1-only architecture, the portal:
   * 1. Consumes the L2→L1 message
   * 2. Supplies tokens directly to Aave on L1
   * 3. Sends L1→L2 confirmation message
   */
  private async executeL1Deposit(
    _l1Relayer: WalletClient,
    l2Request: DepositRequestResult,
    params: DepositRequestParams,
    _userAddress: Address
  ): Promise<L1ExecuteResult> {
    // In mock mode, we simulate the L1 portal execution with direct Aave supply
    if (this.useMock) {
      // For mock tests, we simulate successful execution
      // The actual L1 portal would:
      // 1. Consume the outbox message
      // 2. Supply to Aave directly (no Wormhole bridging)
      // 3. Send L1→L2 confirmation
      const mockTxHash = keccak256(
        encodeAbiParameters(parseAbiParameters("bytes32, uint256, uint256"), [
          `0x${l2Request.intentId.toString(16).padStart(64, "0")}`,
          params.amount,
          params.deadline,
        ])
      );

      // MVP: shares = amount (no yield accounting in mock)
      // Mock message leaf index is 0 (in real execution, this comes from sendL2Message return value)
      return {
        txHash: mockTxHash,
        success: true,
        shares: params.amount,
        messageLeafIndex: 0n,
      };
    }

    // Real execution would call the L1 portal contract's executeDeposit function
    // This requires proper outbox proof generation from Aztec
    throw new Error("Real L1 execution not yet implemented - requires outbox proof generation");
  }

  /**
   * Step 3: Finalize deposit on L2.
   *
   * @param l2Contract L2 contract instance
   * @param userWallet User's wallet
   * @param intentId The intent ID from the deposit request
   * @param assetId The asset ID for the deposit
   * @param secret The secret for message authentication
   * @param shares Number of aToken shares received
   * @param messageLeafIndex Index of the L1→L2 message in the inbox tree
   */
  private async executeL2Finalize(
    l2Contract: unknown,
    userWallet: unknown,
    intentId: bigint,
    assetId: bigint,
    secret: bigint,
    shares: bigint,
    messageLeafIndex: bigint
  ): Promise<{ success: boolean; txHash?: string }> {
    // Type assertion for aztec.js contract
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = l2Contract as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = userWallet as any;

    try {
      const contractWithWallet = contract.withWallet(wallet);
      const methods = contractWithWallet.methods;

      // Call finalize_deposit
      // Signature: finalize_deposit(intent_id, asset_id, shares, secret, message_leaf_index)
      const tx = await methods
        .finalize_deposit(intentId, assetId, shares, secret, messageLeafIndex)
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
 * Compute the expected intent ID for verification.
 *
 * This matches the computation in main.nr.
 */
export async function computeExpectedIntentId(
  caller: bigint,
  asset: bigint,
  amount: bigint,
  originalDecimals: number,
  deadline: bigint,
  salt: bigint
): Promise<bigint> {
  const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");

  const hash = await poseidon2Hash([
    caller,
    asset,
    amount,
    BigInt(originalDecimals),
    deadline,
    salt,
  ]);
  return hash.toBigInt();
}

/**
 * Compute salt for intent ID generation.
 *
 * Matches main.nr:367.
 */
export async function computeSalt(caller: bigint, secretHash: bigint): Promise<bigint> {
  const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");
  const hash = await poseidon2Hash([caller, secretHash]);
  return hash.toBigInt();
}

/**
 * Verify that the relayer address is different from the user.
 *
 * This is a key privacy property of the protocol.
 *
 * Note: In L1-only architecture, there is only one relayer (L1).
 * The targetRelayerAddress parameter is kept for backward compatibility
 * but should be the same as l1RelayerAddress.
 */
export function verifyRelayerPrivacy(
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
 * Wait for a condition with retry logic.
 *
 * Used for waiting for cross-chain messages to propagate.
 */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number = 60_000,
  pollIntervalMs: number = 2_000,
  description: string = "condition"
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      if (await condition()) {
        return true;
      }
    } catch {
      // Condition threw error, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.warn(`Timeout waiting for ${description} after ${timeoutMs}ms`);
  return false;
}

/**
 * Create a deposit flow orchestrator with standard configuration.
 */
export function createDepositOrchestrator(
  l1Client: ChainClient,
  addresses: {
    l1Portal: Address;
    aavePool: Address;
    l2Contract: Hex;
  },
  useMock: boolean = true
): DepositFlowOrchestrator {
  return new DepositFlowOrchestrator(l1Client, addresses, useMock);
}
