/**
 * Intent Type Definitions
 *
 * Shared message payload structures for cross-chain communication.
 * These types must match the Noir definitions in aztec_contracts/src/types/intent.nr
 * and Solidity definitions in l1/contracts/types/Intent.sol and target/contracts/types/Intent.sol
 */

/**
 * Intent to deposit assets into Aave on a target chain
 *
 * Sent from Aztec L2 → L1 Portal → Target Executor
 * Privacy: Uses hash(ownerL2) instead of plain owner address
 */
export interface DepositIntent {
  /** Unique identifier for this intent (derived from user address + nonce) */
  intentId: string; // bytes32 hex string

  /** Hash of the L2 owner address for privacy preservation
   * Computed as hash(ownerL2) on L2, prevents leaking user identity
   */
  ownerHash: string; // bytes32 hex string

  /** Token address on target chain to deposit */
  asset: string; // address hex string

  /** Amount of tokens to deposit (in token's smallest unit) */
  amount: bigint; // uint128

  /** Original token decimals for Wormhole denormalization
   * Wormhole normalizes to 8 decimals; this allows reconstruction on target
   */
  originalDecimals: number; // uint8

  /** Wormhole chain ID of the target chain for deposit */
  targetChainId: number; // uint32

  /** Unix timestamp after which this intent expires */
  deadline: bigint; // uint64

  /** Random salt for intent uniqueness and replay protection */
  salt: string; // bytes32 hex string
}

/**
 * Intent to withdraw assets from Aave on a target chain
 *
 * Sent from Aztec L2 → L1 Portal → Target Executor
 * Privacy: Uses hash(ownerL2) for consistency with deposits
 */
export interface WithdrawIntent {
  /** Unique identifier for this intent (must match original deposit) */
  intentId: string; // bytes32 hex string

  /** Hash of the L2 owner address for privacy preservation */
  ownerHash: string; // bytes32 hex string

  /** Amount of aTokens/shares to withdraw
   * MVP: Must be full amount (partial withdrawals not supported)
   */
  amount: bigint; // uint128

  /** Unix timestamp after which this intent expires */
  deadline: bigint; // uint64
}

/**
 * Helper functions for encoding and validating intents
 */
export namespace IntentUtils {
  /**
   * Validate that a DepositIntent has all required fields
   * @throws Error if validation fails
   */
  export function validateDepositIntent(intent: DepositIntent): void {
    if (!intent.intentId || !/^0x[0-9a-fA-F]{64}$/.test(intent.intentId)) {
      throw new Error('Invalid intentId: must be 32-byte hex string');
    }
    if (!intent.ownerHash || !/^0x[0-9a-fA-F]{64}$/.test(intent.ownerHash)) {
      throw new Error('Invalid ownerHash: must be 32-byte hex string');
    }
    if (!intent.asset || !/^0x[0-9a-fA-F]{40}$/.test(intent.asset)) {
      throw new Error('Invalid asset: must be 20-byte address hex string');
    }
    if (intent.amount <= 0n) {
      throw new Error('Invalid amount: must be positive');
    }
    if (intent.originalDecimals < 0 || intent.originalDecimals > 255) {
      throw new Error('Invalid originalDecimals: must be 0-255');
    }
    if (intent.targetChainId <= 0 || intent.targetChainId > 0xFFFFFFFF) {
      throw new Error('Invalid targetChainId: must be valid uint32');
    }
    if (intent.deadline <= 0n) {
      throw new Error('Invalid deadline: must be positive');
    }
    if (!intent.salt || !/^0x[0-9a-fA-F]{64}$/.test(intent.salt)) {
      throw new Error('Invalid salt: must be 32-byte hex string');
    }
  }

  /**
   * Validate that a WithdrawIntent has all required fields
   * @throws Error if validation fails
   */
  export function validateWithdrawIntent(intent: WithdrawIntent): void {
    if (!intent.intentId || !/^0x[0-9a-fA-F]{64}$/.test(intent.intentId)) {
      throw new Error('Invalid intentId: must be 32-byte hex string');
    }
    if (!intent.ownerHash || !/^0x[0-9a-fA-F]{64}$/.test(intent.ownerHash)) {
      throw new Error('Invalid ownerHash: must be 32-byte hex string');
    }
    if (intent.amount <= 0n) {
      throw new Error('Invalid amount: must be positive');
    }
    if (intent.deadline <= 0n) {
      throw new Error('Invalid deadline: must be positive');
    }
  }

  /**
   * Encode a DepositIntent for ABI encoding (matches Solidity encoding)
   */
  export function encodeDepositIntent(intent: DepositIntent): {
    intentId: string;
    ownerHash: string;
    asset: string;
    amount: bigint;
    originalDecimals: number;
    targetChainId: number;
    deadline: bigint;
    salt: string;
  } {
    return {
      intentId: intent.intentId,
      ownerHash: intent.ownerHash,
      asset: intent.asset,
      amount: intent.amount,
      originalDecimals: intent.originalDecimals,
      targetChainId: intent.targetChainId,
      deadline: intent.deadline,
      salt: intent.salt,
    };
  }

  /**
   * Encode a WithdrawIntent for ABI encoding (matches Solidity encoding)
   */
  export function encodeWithdrawIntent(intent: WithdrawIntent): {
    intentId: string;
    ownerHash: string;
    amount: bigint;
    deadline: bigint;
  } {
    return {
      intentId: intent.intentId,
      ownerHash: intent.ownerHash,
      amount: intent.amount,
      deadline: intent.deadline,
    };
  }

  /**
   * Generate a random salt for intent uniqueness
   */
  export function generateSalt(): string {
    // Generate 32 random bytes
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      // Fallback for Node.js
      const nodeCrypto = require('crypto');
      nodeCrypto.randomFillSync(bytes);
    }
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
