// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IAztecInbox
 * @notice Interface for sending L1->L2 messages to Aztec
 * @dev Messages sent via this interface will be consumable by L2 contracts
 *      after the corresponding L1 block is included in an Aztec epoch proof
 *
 * The Aztec inbox is part of the rollup infrastructure. When an L1 contract
 * sends a message to L2, the message becomes consumable on L2 after the
 * rollup processes the L1 block containing the message.
 */
interface IAztecInbox {
    /**
     * @notice Send a message to an L2 contract
     * @param _recipient The L2 contract address to receive the message (as bytes32)
     * @param _content The message content hash
     * @return The message leaf in the inbox tree
     * @dev The message will be available for consumption on L2 after the rollup
     *      processes the L1 block containing this transaction
     */
    function sendL2Message(bytes32 _recipient, bytes32 _content) external returns (bytes32);

    /**
     * @notice Get the current inbox tree root
     * @return The root of the inbox message tree
     */
    function getRoot() external view returns (bytes32);

    /**
     * @notice Get the number of messages in the inbox
     * @return The total number of L1->L2 messages sent
     */
    function getSize() external view returns (uint256);
}
