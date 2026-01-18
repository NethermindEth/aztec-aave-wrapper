// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title DataStructures
 * @notice Data structures for Aztec L1 message bridge
 * @dev Matches the structures from aztec-packages l1-contracts
 *      https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-devnet.20251212/l1-contracts/src/core/libraries/DataStructures.sol
 */
library DataStructures {
    /**
     * @notice An actor on L2
     * @param actor The Aztec address of the actor
     * @param version The Aztec instance version
     */
    struct L2Actor {
        bytes32 actor;
        uint256 version;
    }

    /**
     * @notice An actor on L1
     * @param actor The Ethereum address of the actor
     * @param chainId The chain ID of the L1 chain
     */
    struct L1Actor {
        address actor;
        uint256 chainId;
    }

    /**
     * @notice An L2 to L1 message
     * @param sender The L2 actor sending the message
     * @param recipient The L1 actor receiving the message
     * @param content The message content (application-specific)
     */
    struct L2ToL1Msg {
        L2Actor sender;
        L1Actor recipient;
        bytes32 content;
    }

    /**
     * @notice An L1 to L2 message
     * @param sender The L1 actor sending the message
     * @param recipient The L2 actor receiving the message
     * @param content The message content (application-specific)
     * @param secretHash The hash of the secret for consumption on L2
     */
    struct L1ToL2Msg {
        L1Actor sender;
        L2Actor recipient;
        bytes32 content;
        bytes32 secretHash;
    }
}
