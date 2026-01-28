// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
pragma solidity ^0.8.33;

/**
 * @title Hash
 * @notice Cryptographic hash utilities for Aztec L1↔L2 messaging
 * @dev Matches the Aztec protocol hash patterns exactly for cross-chain message content.
 *      Based on aztec-packages/l1-contracts/src/core/libraries/crypto/Hash.sol
 */
library Hash {
    /**
     * @notice Computes SHA256 and truncates to fit in a field element (~254 bits)
     * @dev Truncates one byte to convert the hash to a field element.
     *      We prepend a byte rather than cast bytes31(bytes32) to match Noir's to_be_bytes.
     * @param _data The data to hash
     * @return The hash truncated to field element size
     */
    function sha256ToField(bytes memory _data) internal pure returns (bytes32) {
        return bytes32(bytes.concat(new bytes(1), bytes31(sha256(_data))));
    }
}
