/**
 * Deposit Flow Orchestration Helpers
 *
 * This module provides helper functions for orchestrating the complete deposit flow
 * as specified in spec.md §4.1:
 *
 * Flow: L2 request → L1 bridge → Target Aave supply → L1 confirm → L2 finalize
 *
 * The deposit flow consists of 6 steps:
 * 1. User initiates on L2 (private) - request_deposit creates intent and L2→L1 message
 * 2. L1 portal executes (public) - consumes message, bridges via Wormhole
 * 3. Target executor supplies to Aave - receives tokens, supplies to pool
 * 4. Target executor returns confirmation - sends Wormhole message back to L1
 * 5. L1 portal posts completion to Aztec - sends L1→L2 message
 * 6. L2 finalizes (private) - creates PositionReceiptNote
 *
 * Privacy Property:
 * - The relayer executing L1/Target steps should be different from the user
 * - L2 owner address is NEVER included in cross-chain messages
 * - Authentication uses secret/secretHash mechanism
 */

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { encodeFunctionData, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import type { ChainClient } from "../setup";
import {
  WormholeMock,
  ConfirmationStatus,
  encodeDepositConfirmation,
} from "../utils/wormhole-mock";

// =============================================================================
// Type Definitions
// =============================================================================

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
    targetChainId: number;
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
  /** Wormhole sequence number (for tracking) */
  wormholeSequence?: bigint;
}

/**
 * Target executor result
 */
export interface TargetExecuteResult {
  /** Transaction hash on target chain */
  txHash: Hex;
  /** Whether execution succeeded */
  success: boolean;
  /** Shares received from Aave supply */
  shares: bigint;
  /** Confirmation status */
  status: ConfirmationStatus;
}

/**
 * Full deposit flow result
 */
export interface FullDepositFlowResult {
  /** L2 request result */
  l2Request: DepositRequestResult;
  /** L1 execution result */
  l1Execute: L1ExecuteResult;
  /** Target execution result */
  targetExecute: TargetExecuteResult;
  /** L1 confirmation result */
  l1Confirmation: { success: boolean; txHash?: Hex };
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
  /** Target chain relayer wallet client */
  targetRelayer: WalletClient;
}

// =============================================================================
// Deposit Flow Orchestrator
// =============================================================================

/**
 * DepositFlowOrchestrator manages the complete deposit flow across all chains.
 *
 * This class coordinates:
 * - L2 Aztec contract interactions
 * - L1 portal execution
 * - Wormhole message delivery (mock or testnet)
 * - Target chain Aave operations
 * - Privacy verification
 *
 * @example
 * ```ts
 * const orchestrator = new DepositFlowOrchestrator(harness);
 * await orchestrator.initialize();
 *
 * const result = await orchestrator.executeFullDeposit({
 *   assetId: 1n,
 *   amount: 1_000_000n,
 *   targetChainId: 23,
 *   deadline: deadlineFromOffset(3600),
 *   secret: Fr.random().toBigInt(),
 * }, relayerConfig);
 *
 * expect(result.privacyVerified).toBe(true);
 * ```
 */
export class DepositFlowOrchestrator {
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
   * Execute the full deposit flow from L2 to Target and back.
   *
   * This implements the complete spec.md §4.1 deposit flow:
   * 1. L2 request_deposit
   * 2. L1 executeDeposit
   * 3. Target consumeAndExecuteDeposit
   * 4. Target sends confirmation
   * 5. L1 receives and sends to L2
   * 6. L2 finalize_deposit
   *
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

    // Step 2: Execute L1 portal deposit (relayer executes, not user)
    const l1Execute = await this.executeL1Deposit(
      relayer.l1Relayer,
      l2Request,
      params,
      userAddress
    );

    // Privacy check: L1 executor should not be the user
    const l1ExecutorAddress = relayer.l1Relayer.account?.address;
    const privacyCheckL1 = l1ExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 3: Execute target chain Aave supply (via Wormhole delivery)
    const targetExecute = await this.executeTargetDeposit(
      relayer.targetRelayer,
      l2Request.intentId,
      params
    );

    // Privacy check: Target executor should not be the user
    const targetExecutorAddress = relayer.targetRelayer.account?.address;
    const privacyCheckTarget = targetExecutorAddress?.toLowerCase() !== userAddress.toLowerCase();

    // Step 4: Send confirmation back to L1
    const l1Confirmation = await this.sendConfirmationToL1(
      l2Request.intentId,
      targetExecute.shares,
      targetExecute.status
    );

    // Step 5: L2 finalize_deposit (user executes)
    const l2Finalize = await this.executeL2Finalize(
      l2Contract,
      userWallet,
      l2Request.intentId,
      params.secret,
      targetExecute.shares
    );

    return {
      l2Request,
      l1Execute,
      targetExecute,
      l1Confirmation,
      l2Finalize,
      privacyVerified: privacyCheckL1 && privacyCheckTarget,
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
   * Step 2: Execute deposit on L1 portal.
   */
  private async executeL1Deposit(
    l1Relayer: WalletClient,
    l2Request: DepositRequestResult,
    params: DepositRequestParams,
    _userAddress: Address
  ): Promise<L1ExecuteResult> {
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
   * Step 3: Execute deposit on target chain (Aave supply).
   */
  private async executeTargetDeposit(
    targetRelayer: WalletClient,
    intentId: bigint,
    params: DepositRequestParams
  ): Promise<TargetExecuteResult> {
    // In mock mode, simulate the target execution
    if (this.useMock) {
      // Mock successful Aave supply
      // In real execution, this would call consumeAndExecuteDeposit with VAA
      const mockTxHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, uint256"),
          [`0x${intentId.toString(16).padStart(64, "0")}`, params.amount]
        )
      );

      // MVP: shares = amount (no yield accounting)
      return {
        txHash: mockTxHash,
        success: true,
        shares: params.amount,
        status: ConfirmationStatus.Success,
      };
    }

    // Real execution would call AaveExecutorTarget.consumeAndExecuteDeposit
    throw new Error("Real target execution not yet implemented - requires VAA");
  }

  /**
   * Step 4: Send confirmation from target back to L1.
   */
  private async sendConfirmationToL1(
    intentId: bigint,
    shares: bigint,
    status: ConfirmationStatus
  ): Promise<{ success: boolean; txHash?: Hex }> {
    if (this.useMock && this.wormholeMock) {
      const result = await this.wormholeMock.deliverDepositConfirmation(intentId, shares, status);
      return {
        success: result.success,
        txHash: result.txHash,
      };
    }

    // Real execution would wait for Wormhole VAA delivery
    throw new Error("Real confirmation delivery not yet implemented");
  }

  /**
   * Step 6: Finalize deposit on L2.
   */
  private async executeL2Finalize(
    l2Contract: unknown,
    userWallet: unknown,
    intentId: bigint,
    secret: bigint,
    shares: bigint
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
      const tx = await methods.finalize_deposit(intentId, shares, secret).send().wait();

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
 * Compute the expected intent ID for verification.
 *
 * This matches the computation in main.nr:38-46.
 */
export async function computeExpectedIntentId(
  caller: bigint,
  asset: bigint,
  amount: bigint,
  originalDecimals: number,
  targetChainId: number,
  deadline: bigint,
  salt: bigint
): Promise<bigint> {
  const { poseidon2Hash } = await import("@aztec/foundation/crypto/poseidon");

  const hash = await poseidon2Hash([
    caller,
    asset,
    amount,
    BigInt(originalDecimals),
    BigInt(targetChainId),
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
 * Verify that the relayer addresses are different from the user.
 *
 * This is a key privacy property of the protocol.
 */
export function verifyRelayerPrivacy(
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
  targetClient: ChainClient,
  addresses: {
    l1Portal: Address;
    targetExecutor: Address;
    l2Contract: Hex;
  },
  useMock: boolean = true
): DepositFlowOrchestrator {
  return new DepositFlowOrchestrator(l1Client, targetClient, addresses, useMock);
}
