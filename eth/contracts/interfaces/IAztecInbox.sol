// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {DataStructures} from "../libraries/DataStructures.sol";

/**
 * @title IAztecInbox
 * @notice Interface for sending L1->L2 messages to Aztec
 * @dev Matches the interface from aztec-packages l1-contracts
 *      https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-devnet.20251212/l1-contracts/src/core/messagebridge/Inbox.sol
 *
 * The Aztec inbox is part of the rollup infrastructure. When an L1 contract
 * sends a message to L2, the message becomes consumable on L2 after the
 * rollup processes the L1 block containing the message.
 */
interface IAztecInbox {
    /**
     * @notice Send a message to an L2 contract
     * @param _recipient The L2 recipient actor (address + version)
     * @param _content The message content hash
     * @param _secretHash Hash for message consumption privacy on L2
     * @return entryKey The message leaf hash in the inbox tree
     * @return index The position of the message in the tree
     */
    function sendL2Message(
        DataStructures.L2Actor memory _recipient,
        bytes32 _content,
        bytes32 _secretHash
    ) external returns (bytes32 entryKey, uint256 index);

    /**
     * @notice Get the Aztec instance version
     * @return The version number for this Aztec instance
     */
    function VERSION() external view returns (uint256);

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
