// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title MockWormholeCore
 * @notice Mock implementation of Wormhole Core for local testing on L1
 * @dev Provides minimal core functionality needed by MockWormholeRelayer
 *
 * Features:
 * - Message publishing with sequence tracking
 * - Basic guardian set management (mocked)
 * - Chain ID management
 *
 * Note: This is a simplified version for L1. The target chain version
 * includes VAA parsing functionality.
 */
contract MockWormholeCore {
    // ============ State ============

    /// @notice Current guardian set index
    uint32 private guardianSetIndex;

    /// @notice Message sequence counter
    uint64 private sequence;

    /// @notice Chain ID in Wormhole format
    uint16 private immutable _chainId;

    /// @notice Message fee (set to 0 for testing)
    uint256 public constant MESSAGE_FEE = 0;

    // ============ Events ============

    event LogMessagePublished(
        address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel
    );

    // ============ Constructor ============

    constructor(
        uint16 chainId_
    ) {
        _chainId = chainId_;
        guardianSetIndex = 0;
    }

    // ============ Public Functions ============

    /**
     * @notice Publish a message to be attested by guardians
     */
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64) {
        require(msg.value >= MESSAGE_FEE, "Insufficient fee");

        uint64 currentSequence = sequence++;

        emit LogMessagePublished(msg.sender, currentSequence, nonce, payload, consistencyLevel);

        return currentSequence;
    }

    /**
     * @notice Get the current guardian set index
     */
    function getCurrentGuardianSetIndex() external view returns (uint32) {
        return guardianSetIndex;
    }

    /**
     * @notice Get the chain ID
     */
    function chainId() external view returns (uint16) {
        return _chainId;
    }

    /**
     * @notice Get the governance chain ID (mocked)
     */
    function governanceChainId() external pure returns (uint16) {
        return 1; // Ethereum mainnet by convention
    }

    /**
     * @notice Get the governance contract address (mocked)
     */
    function governanceContract() external pure returns (bytes32) {
        return bytes32(0);
    }

    /**
     * @notice Get the message fee
     */
    function messageFee() external pure returns (uint256) {
        return MESSAGE_FEE;
    }

    /**
     * @notice Get current sequence number
     */
    function getCurrentSequence() external view returns (uint64) {
        return sequence;
    }
}
