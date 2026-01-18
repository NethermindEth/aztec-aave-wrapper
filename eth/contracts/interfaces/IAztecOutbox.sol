// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { DataStructures } from "../libraries/DataStructures.sol";

/**
 * @title IAztecOutbox
 * @notice Interface for consuming L2->L1 messages from Aztec
 * @dev Matches the interface from aztec-packages l1-contracts
 *      https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-devnet.20251212/l1-contracts/src/core/messagebridge/Outbox.sol
 *
 * The Aztec outbox is part of the rollup infrastructure. When an L2 contract
 * sends a message to L1, it becomes consumable after the L2 block is proven
 * and finalized on L1.
 */
interface IAztecOutbox {
    /**
     * @notice Consume a message from the outbox
     * @dev Verifies the message is included in the merkle tree and marks it as consumed
     * @param _message The L2 to L1 message to consume
     * @param _l2BlockNumber The L2 block number where the message was created (checkpoint)
     * @param _leafIndex The index of the message in the L2 block's message tree
     * @param _path Merkle proof path from leaf to root
     */
    function consume(
        DataStructures.L2ToL1Msg calldata _message,
        uint256 _l2BlockNumber,
        uint256 _leafIndex,
        bytes32[] calldata _path
    ) external;

    /**
     * @notice Check if a message has already been consumed at a given checkpoint
     * @param _l2BlockNumber The L2 block number (checkpoint)
     * @param _leafIndex The index of the message leaf
     * @return True if the message has been consumed
     */
    function hasMessageBeenConsumedAtCheckpoint(
        uint256 _l2BlockNumber,
        uint256 _leafIndex
    ) external view returns (bool);

    /**
     * @notice Get the root data for a given L2 block (checkpoint)
     * @param _l2BlockNumber The L2 block number
     * @return The root hash and metadata
     */
    function getRootData(
        uint256 _l2BlockNumber
    ) external view returns (bytes32, uint256);
}
