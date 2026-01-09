// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title WormholeConstants
 * @notice Shared constants for Wormhole integration across L1 and target chains
 * @dev Chain IDs follow Wormhole's numbering scheme (NOT Ethereum chain IDs)
 */
library WormholeConstants {
    // Wormhole Chain IDs (not Ethereum chain IDs!)
    // See: https://docs.wormhole.com/wormhole/reference/constants#chain-ids
    uint16 public constant CHAIN_ID_ETHEREUM = 2;
    uint16 public constant CHAIN_ID_BSC = 4;
    uint16 public constant CHAIN_ID_POLYGON = 5;
    uint16 public constant CHAIN_ID_AVALANCHE = 6;
    uint16 public constant CHAIN_ID_ARBITRUM = 23;
    uint16 public constant CHAIN_ID_OPTIMISM = 24;
    uint16 public constant CHAIN_ID_BASE = 30;

    // Local devnet chain IDs (for testing)
    uint16 public constant CHAIN_ID_LOCAL_L1 = 2; // Use Ethereum ID for local L1
    uint16 public constant CHAIN_ID_LOCAL_TARGET = 23; // Use Arbitrum ID for local target

    // Wormhole finality (number of confirmations required)
    uint8 public constant FINALITY_ETHEREUM = 15;
    uint8 public constant FINALITY_ARBITRUM = 1;
    uint8 public constant FINALITY_LOCAL = 1; // Instant finality for local devnet

    // Gas limits for cross-chain execution
    uint256 public constant GAS_LIMIT_DEPOSIT = 300000;
    uint256 public constant GAS_LIMIT_WITHDRAW = 350000;
    uint256 public constant GAS_LIMIT_CONFIRMATION = 150000;

    // Consistency levels (for VAA generation)
    uint8 public constant CONSISTENCY_LEVEL_INSTANT = 200; // Unsafe, instant
    uint8 public constant CONSISTENCY_LEVEL_SAFE = 201; // Wait for finality
}
