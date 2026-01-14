// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IAztecOutbox
 * @notice Interface for consuming L2->L1 messages from Aztec
 * @dev Messages are created by L2 contracts and proven via the rollup's proof system
 *
 * The Aztec outbox is part of the rollup infrastructure. When an L2 contract
 * sends a message to L1, it becomes consumable after the L2 block is proven
 * and finalized on L1. The message content hash must match exactly.
 */
interface IAztecOutbox {
    /**
     * @notice Consume a message from the outbox
     * @param _message The message content hash
     * @param _l2BlockNumber The L2 block number where the message was created
     * @param _leafIndex The index of the message in the L2 block's message tree
     * @param _path Merkle proof path from leaf to root
     * @return True if the message was successfully consumed
     */
    function consume(
        bytes32 _message,
        uint256 _l2BlockNumber,
        uint256 _leafIndex,
        bytes32[] calldata _path
    ) external returns (bool);

    /**
     * @notice Check if a message has already been consumed
     * @param _message The message content hash
     * @return True if the message has been consumed
     */
    function hasMessageBeenConsumed(
        bytes32 _message
    ) external view returns (bool);

    /**
     * @notice Get the root of the message tree for a given L2 block
     * @param _l2BlockNumber The L2 block number
     * @return The message tree root
     */
    function getRootForBlock(
        uint256 _l2BlockNumber
    ) external view returns (bytes32);
}
