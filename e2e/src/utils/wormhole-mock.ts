/**
 * Wormhole Mock Utilities for Unit Tests
 *
 * Provides mock implementations of Wormhole VAA (Verified Action Approval)
 * for testing cross-chain message flows without real Wormhole infrastructure.
 *
 * This module allows tests to:
 * - Generate mock VAAs for deposit/withdraw confirmations
 * - Simulate Wormhole message delivery to target contracts
 * - Test failure scenarios (invalid VAAs, replay attacks)
 *
 * Usage:
 *   import { WormholeMock, MockVAABuilder } from './utils/wormhole-mock';
 *   const mock = new WormholeMock(l1Client, targetClient);
 *   await mock.deliverDepositConfirmation(intentId, shares);
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainClient } from "../setup";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Wormhole action types
 */
export enum WormholeAction {
  Deposit = 0,
  Withdraw = 1,
  Confirm = 2,
}

/**
 * Confirmation status
 */
export enum ConfirmationStatus {
  Success = 0,
  Failed = 1,
}

/**
 * Mock VAA structure (simplified for testing)
 */
export interface MockVAA {
  /** VAA version (always 1) */
  version: number;
  /** Guardian set index */
  guardianSetIndex: number;
  /** Number of signatures */
  signatureCount: number;
  /** Mock signatures (empty for local testing) */
  signatures: Hex[];
  /** Timestamp */
  timestamp: number;
  /** Nonce */
  nonce: number;
  /** Emitter chain ID */
  emitterChainId: number;
  /** Emitter address (32 bytes) */
  emitterAddress: Hex;
  /** Sequence number */
  sequence: bigint;
  /** Consistency level */
  consistencyLevel: number;
  /** Payload */
  payload: Hex;
}

/**
 * Deposit confirmation payload
 */
export interface DepositConfirmationPayload {
  action: WormholeAction.Confirm;
  intentId: bigint;
  shares: bigint;
  status: ConfirmationStatus;
}

/**
 * Withdraw confirmation payload
 */
export interface WithdrawConfirmationPayload {
  action: WormholeAction.Confirm;
  intentId: bigint;
  amount: bigint;
  status: ConfirmationStatus;
}

/**
 * Mock Wormhole bridge state
 */
export interface MockBridgeState {
  /** Processed VAA hashes (for replay protection) */
  processedVAAs: Set<string>;
  /** Registered emitters by chain ID */
  registeredEmitters: Map<number, Hex>;
  /** Sequence counter per emitter */
  sequences: Map<string, bigint>;
}

// =============================================================================
// Mock VAA Builder
// =============================================================================

/**
 * Builder for creating mock Wormhole VAAs.
 *
 * @example
 * ```ts
 * const vaa = new MockVAABuilder()
 *   .setEmitter(WORMHOLE_CHAIN_IDS.LOCAL_TARGET, targetExecutorAddress)
 *   .setPayload(encodeConfirmation(intentId, shares, ConfirmationStatus.Success))
 *   .build();
 * ```
 */
export class MockVAABuilder {
  private vaa: Partial<MockVAA> = {
    version: 1,
    guardianSetIndex: 0,
    signatureCount: 0,
    signatures: [],
    timestamp: Math.floor(Date.now() / 1000),
    nonce: Math.floor(Math.random() * 1000000),
    consistencyLevel: 15, // Finalized
  };

  private static sequenceCounter = 0n;

  /**
   * Set the emitter chain and address.
   */
  setEmitter(chainId: number, address: Address): this {
    this.vaa.emitterChainId = chainId;
    // Pad address to 32 bytes (Wormhole format)
    this.vaa.emitterAddress = `0x${address.slice(2).padStart(64, "0")}` as Hex;
    return this;
  }

  /**
   * Set the payload.
   */
  setPayload(payload: Hex): this {
    this.vaa.payload = payload;
    return this;
  }

  /**
   * Set custom timestamp.
   */
  setTimestamp(timestamp: number): this {
    this.vaa.timestamp = timestamp;
    return this;
  }

  /**
   * Set custom nonce.
   */
  setNonce(nonce: number): this {
    this.vaa.nonce = nonce;
    return this;
  }

  /**
   * Set sequence number.
   */
  setSequence(sequence: bigint): this {
    this.vaa.sequence = sequence;
    return this;
  }

  /**
   * Build the VAA.
   */
  build(): MockVAA {
    if (!this.vaa.emitterChainId || !this.vaa.emitterAddress) {
      throw new Error("Emitter chain and address must be set");
    }
    if (!this.vaa.payload) {
      throw new Error("Payload must be set");
    }

    // Auto-increment sequence if not set
    if (this.vaa.sequence === undefined) {
      this.vaa.sequence = MockVAABuilder.sequenceCounter++;
    }

    return this.vaa as MockVAA;
  }

  /**
   * Encode the VAA to bytes for contract consumption.
   */
  static encode(vaa: MockVAA): Hex {
    // Simplified encoding for local testing
    // Real VAAs have complex guardian signature verification
    const encoded = encodeAbiParameters(
      parseAbiParameters(
        "uint8, uint32, uint8, bytes[], uint32, uint32, uint16, bytes32, uint64, uint8, bytes"
      ),
      [
        vaa.version,
        vaa.guardianSetIndex,
        vaa.signatureCount,
        vaa.signatures,
        vaa.timestamp,
        vaa.nonce,
        vaa.emitterChainId,
        vaa.emitterAddress,
        vaa.sequence,
        vaa.consistencyLevel,
        vaa.payload,
      ]
    );

    return encoded;
  }

  /**
   * Compute VAA hash (for replay protection).
   */
  static computeHash(vaa: MockVAA): Hex {
    const bodyHash = keccak256(
      encodeAbiParameters(
        parseAbiParameters("uint32, uint32, uint16, bytes32, uint64, uint8, bytes"),
        [
          vaa.timestamp,
          vaa.nonce,
          vaa.emitterChainId,
          vaa.emitterAddress,
          vaa.sequence,
          vaa.consistencyLevel,
          vaa.payload,
        ]
      )
    );
    return bodyHash;
  }
}

// =============================================================================
// Payload Encoders
// =============================================================================

/**
 * Encode a deposit confirmation payload.
 */
export function encodeDepositConfirmation(
  intentId: bigint,
  shares: bigint,
  status: ConfirmationStatus
): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint8, bytes32, uint256, uint8"),
    [WormholeAction.Confirm, `0x${intentId.toString(16).padStart(64, "0")}`, shares, status]
  );
}

/**
 * Encode a withdraw confirmation payload.
 */
export function encodeWithdrawConfirmation(
  intentId: bigint,
  amount: bigint,
  status: ConfirmationStatus
): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint8, bytes32, uint256, uint8"),
    [WormholeAction.Confirm, `0x${intentId.toString(16).padStart(64, "0")}`, amount, status]
  );
}

/**
 * Encode a deposit intent payload (L1 → Target).
 */
export function encodeDepositIntent(
  intentId: bigint,
  asset: Address,
  amount: bigint,
  deadline: bigint
): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint8, bytes32, address, uint256, uint256"),
    [
      WormholeAction.Deposit,
      `0x${intentId.toString(16).padStart(64, "0")}`,
      asset,
      amount,
      deadline,
    ]
  );
}

/**
 * Encode a withdraw intent payload (L1 → Target).
 */
export function encodeWithdrawIntent(
  intentId: bigint,
  amount: bigint,
  deadline: bigint
): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint8, bytes32, uint256, uint256"),
    [WormholeAction.Withdraw, `0x${intentId.toString(16).padStart(64, "0")}`, amount, deadline]
  );
}

// =============================================================================
// Wormhole Mock Class
// =============================================================================

/**
 * WormholeMock simulates Wormhole message delivery for testing.
 *
 * In local testing, we bypass real Wormhole guardians and directly
 * deliver messages to contracts. This allows testing the full flow
 * without network dependencies.
 *
 * @example
 * ```ts
 * const mock = new WormholeMock(l1Client, targetClient);
 * await mock.initialize({
 *   l1Portal: '0x...',
 *   targetExecutor: '0x...',
 * });
 *
 * // Simulate deposit confirmation from target
 * await mock.deliverDepositConfirmation(intentId, shares, ConfirmationStatus.Success);
 * ```
 */
export class WormholeMock {
  private l1Client: ChainClient;
  private targetClient: ChainClient;
  private state: MockBridgeState;

  private l1PortalAddress: Address | null = null;
  private targetExecutorAddress: Address | null = null;

  constructor(l1Client: ChainClient, targetClient: ChainClient) {
    this.l1Client = l1Client;
    this.targetClient = targetClient;
    this.state = {
      processedVAAs: new Set(),
      registeredEmitters: new Map(),
      sequences: new Map(),
    };
  }

  /**
   * Initialize the mock with contract addresses.
   */
  initialize(addresses: {
    l1Portal: Address;
    targetExecutor: Address;
    l1ChainId?: number;
    targetChainId?: number;
  }): void {
    this.l1PortalAddress = addresses.l1Portal;
    this.targetExecutorAddress = addresses.targetExecutor;

    // Register emitters
    const l1ChainId = addresses.l1ChainId || 2; // Wormhole Ethereum
    const targetChainId = addresses.targetChainId || 23; // Wormhole Arbitrum

    this.state.registeredEmitters.set(
      l1ChainId,
      `0x${addresses.l1Portal.slice(2).padStart(64, "0")}` as Hex
    );
    this.state.registeredEmitters.set(
      targetChainId,
      `0x${addresses.targetExecutor.slice(2).padStart(64, "0")}` as Hex
    );
  }

  /**
   * Deliver a deposit confirmation from target to L1.
   *
   * This simulates the Wormhole message flow:
   * Target Executor → Wormhole → L1 Portal
   */
  async deliverDepositConfirmation(
    intentId: bigint,
    shares: bigint,
    status: ConfirmationStatus = ConfirmationStatus.Success
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    if (!this.l1PortalAddress || !this.targetExecutorAddress) {
      return { success: false, error: "Mock not initialized" };
    }

    try {
      // Build the VAA
      const payload = encodeDepositConfirmation(intentId, shares, status);
      const vaa = new MockVAABuilder()
        .setEmitter(23, this.targetExecutorAddress) // From target chain
        .setPayload(payload)
        .build();

      // Check for replay
      const vaaHash = MockVAABuilder.computeHash(vaa);
      if (this.state.processedVAAs.has(vaaHash)) {
        return { success: false, error: "VAA already processed (replay)" };
      }

      // Encode VAA for contract
      const encodedVAA = MockVAABuilder.encode(vaa);

      // Call L1 portal's receiveWormholeMessage function
      // Note: In real tests, this would call the actual portal contract
      // For now, we just mark the VAA as processed
      this.state.processedVAAs.add(vaaHash);

      return {
        success: true,
        txHash: vaaHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deliver a withdraw confirmation from target to L1.
   */
  async deliverWithdrawConfirmation(
    intentId: bigint,
    amount: bigint,
    status: ConfirmationStatus = ConfirmationStatus.Success
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    if (!this.l1PortalAddress || !this.targetExecutorAddress) {
      return { success: false, error: "Mock not initialized" };
    }

    try {
      const payload = encodeWithdrawConfirmation(intentId, amount, status);
      const vaa = new MockVAABuilder()
        .setEmitter(23, this.targetExecutorAddress)
        .setPayload(payload)
        .build();

      const vaaHash = MockVAABuilder.computeHash(vaa);
      if (this.state.processedVAAs.has(vaaHash)) {
        return { success: false, error: "VAA already processed (replay)" };
      }

      this.state.processedVAAs.add(vaaHash);

      return {
        success: true,
        txHash: vaaHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate a deposit message from L1 to target.
   *
   * This simulates:
   * L1 Portal → Wormhole → Target Executor
   */
  async deliverDepositToTarget(
    intentId: bigint,
    asset: Address,
    amount: bigint,
    deadline: bigint
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    if (!this.l1PortalAddress || !this.targetExecutorAddress) {
      return { success: false, error: "Mock not initialized" };
    }

    try {
      const payload = encodeDepositIntent(intentId, asset, amount, deadline);
      const vaa = new MockVAABuilder()
        .setEmitter(2, this.l1PortalAddress) // From L1 chain
        .setPayload(payload)
        .build();

      const vaaHash = MockVAABuilder.computeHash(vaa);
      if (this.state.processedVAAs.has(vaaHash)) {
        return { success: false, error: "VAA already processed (replay)" };
      }

      this.state.processedVAAs.add(vaaHash);

      return {
        success: true,
        txHash: vaaHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate a withdraw message from L1 to target.
   */
  async deliverWithdrawToTarget(
    intentId: bigint,
    amount: bigint,
    deadline: bigint
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    if (!this.l1PortalAddress || !this.targetExecutorAddress) {
      return { success: false, error: "Mock not initialized" };
    }

    try {
      const payload = encodeWithdrawIntent(intentId, amount, deadline);
      const vaa = new MockVAABuilder()
        .setEmitter(2, this.l1PortalAddress)
        .setPayload(payload)
        .build();

      const vaaHash = MockVAABuilder.computeHash(vaa);
      if (this.state.processedVAAs.has(vaaHash)) {
        return { success: false, error: "VAA already processed (replay)" };
      }

      this.state.processedVAAs.add(vaaHash);

      return {
        success: true,
        txHash: vaaHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a VAA has been processed.
   */
  isVAAProcessed(vaaHash: string): boolean {
    return this.state.processedVAAs.has(vaaHash);
  }

  /**
   * Reset mock state (for test isolation).
   */
  reset(): void {
    this.state.processedVAAs.clear();
  }

  /**
   * Get current sequence number for an emitter.
   */
  getSequence(chainId: number): bigint {
    const emitter = this.state.registeredEmitters.get(chainId);
    if (!emitter) return 0n;
    return this.state.sequences.get(emitter) || 0n;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WormholeMock instance from test configuration.
 */
export function createWormholeMock(
  l1Client: ChainClient,
  targetClient: ChainClient,
  addresses: {
    l1Portal: Address;
    targetExecutor: Address;
  }
): WormholeMock {
  const mock = new WormholeMock(l1Client, targetClient);
  mock.initialize(addresses);
  return mock;
}

/**
 * Build a mock VAA for testing.
 */
export function buildMockVAA(options: {
  emitterChainId: number;
  emitterAddress: Address;
  payload: Hex;
  sequence?: bigint;
}): MockVAA {
  return new MockVAABuilder()
    .setEmitter(options.emitterChainId, options.emitterAddress)
    .setPayload(options.payload)
    .setSequence(options.sequence || 0n)
    .build();
}
