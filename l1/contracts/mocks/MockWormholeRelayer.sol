// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { IWormholeRelayer } from "../interfaces/IWormholeRelayer.sol";

/**
 * @title MockWormholeRelayer
 * @notice Mock implementation of Wormhole Relayer for local testing
 * @dev Simulates automatic cross-chain message delivery
 *
 * Features:
 * - Manual message delivery (no automatic relaying in devnet)
 * - Message queueing with sequence tracking
 * - Delivery cost estimation
 * - Support for both address and bytes32 targets
 *
 * Usage in tests:
 * 1. Call sendPayloadToEvm() to queue a message
 * 2. Call manualDeliver() to trigger delivery on target chain
 */
contract MockWormholeRelayer is IWormholeRelayer {
    // ============ State ============

    /// @notice Sequence counter for messages
    uint64 private sequence;

    /// @notice Mock Wormhole core contract address
    address public immutable wormholeCore;

    /// @notice Fixed delivery price for testing (0.1 ether)
    uint256 public constant DELIVERY_PRICE = 0.1 ether;

    /// @notice Pending messages waiting for delivery
    mapping(uint64 => PendingMessage) public pendingMessages;

    /// @notice Delivery attempt tracking
    mapping(bytes32 => bool) public deliveryAttempts;

    /// @notice Struct to track pending messages
    struct PendingMessage {
        uint16 targetChain;
        address targetAddress;
        bytes payload;
        uint256 receiverValue;
        uint256 gasLimit;
        uint16 refundChain;
        address refundAddress;
        bool exists;
    }

    // ============ Events ============

    event MessageSent(
        uint64 indexed sequence,
        uint16 indexed targetChain,
        address indexed targetAddress,
        bytes payload,
        uint256 receiverValue,
        uint256 gasLimit
    );

    event MessageDelivered(uint64 indexed sequence, address indexed targetAddress);

    // ============ Constructor ============

    constructor(
        address _wormholeCore
    ) {
        wormholeCore = _wormholeCore;
    }

    // ============ IWormholeRelayer Implementation ============

    /**
     * @notice Send a payload to EVM chain with automatic delivery
     * @dev Simplified version without refund parameters
     */
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable override returns (uint64) {
        // Check payment covers delivery cost
        require(msg.value >= DELIVERY_PRICE, "Insufficient delivery fee");

        uint64 currentSequence = sequence++;

        // Store pending message
        pendingMessages[currentSequence] = PendingMessage({
            targetChain: targetChain,
            targetAddress: targetAddress,
            payload: payload,
            receiverValue: receiverValue,
            gasLimit: gasLimit,
            refundChain: 0,
            refundAddress: address(0),
            exists: true
        });

        emit MessageSent(
            currentSequence, targetChain, targetAddress, payload, receiverValue, gasLimit
        );

        return currentSequence;
    }

    /**
     * @notice Send a payload to EVM chain with refund parameters
     */
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress
    ) external payable override returns (uint64) {
        require(msg.value >= DELIVERY_PRICE, "Insufficient delivery fee");

        uint64 currentSequence = sequence++;

        pendingMessages[currentSequence] = PendingMessage({
            targetChain: targetChain,
            targetAddress: targetAddress,
            payload: payload,
            receiverValue: receiverValue,
            gasLimit: gasLimit,
            refundChain: refundChain,
            refundAddress: refundAddress,
            exists: true
        });

        emit MessageSent(
            currentSequence, targetChain, targetAddress, payload, receiverValue, gasLimit
        );

        return currentSequence;
    }

    /**
     * @notice Quote the cost of sending a message
     */
    function quoteEVMDeliveryPrice(
        uint16,
        uint256,
        uint256
    )
        external
        pure
        override
        returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused)
    {
        return (DELIVERY_PRICE, 0);
    }

    /**
     * @notice Get the Wormhole core contract address
     */
    function wormhole() external view override returns (address) {
        return wormholeCore;
    }

    /**
     * @notice Check if delivery was attempted for a given hash
     */
    function deliveryAttempted(
        bytes32 deliveryHash
    ) external view override returns (bool) {
        return deliveryAttempts[deliveryHash];
    }

    /**
     * @notice Deliver messages (not implemented in mock - use manualDeliver)
     */
    function deliver(
        bytes[] memory,
        bytes memory,
        address payable,
        bytes memory
    ) external payable override {
        revert("Use manualDeliver() for testing");
    }

    // ============ Mock-Specific Functions ============

    /**
     * @notice Manually deliver a queued message (for testing)
     * @dev In production, Wormhole relayers do this automatically
     * @param seq Sequence number of the message to deliver
     */
    function manualDeliver(
        uint64 seq
    ) external {
        PendingMessage memory message = pendingMessages[seq];
        require(message.exists, "Message does not exist");

        // Create delivery hash
        bytes32 deliveryHash =
            keccak256(abi.encodePacked(seq, message.targetChain, message.targetAddress));

        require(!deliveryAttempts[deliveryHash], "Already delivered");

        // Mark as delivered
        deliveryAttempts[deliveryHash] = true;

        // Call the target contract's receiveWormholeMessages function
        // The target should implement this interface
        (bool success,) = message.targetAddress.call{
            value: message.receiverValue,
            gas: message.gasLimit
        }(
            abi.encodeWithSignature(
                "receiveWormholeMessages(bytes,bytes[],bytes32,uint16,bytes32)",
                message.payload,
                new bytes[](0), // empty additional VAAs
                address(this), // source address (this relayer)
                message.targetChain, // source chain
                bytes32(uint256(seq)) // delivery hash
            )
        );

        require(success, "Message delivery failed");

        emit MessageDelivered(seq, message.targetAddress);
    }

    /**
     * @notice Get current sequence number
     */
    function getCurrentSequence() external view returns (uint64) {
        return sequence;
    }

    /**
     * @notice Get pending message details
     */
    function getPendingMessage(
        uint64 seq
    )
        external
        view
        returns (
            uint16 targetChain,
            address targetAddress,
            bytes memory payload,
            uint256 receiverValue,
            uint256 gasLimit
        )
    {
        PendingMessage memory message = pendingMessages[seq];
        require(message.exists, "Message does not exist");
        return (
            message.targetChain,
            message.targetAddress,
            message.payload,
            message.receiverValue,
            message.gasLimit
        );
    }
}
