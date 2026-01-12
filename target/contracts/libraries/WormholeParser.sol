// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title WormholeParser
/// @notice Library for parsing and validating Wormhole VAAs (Verified Action Approvals)
/// @dev VAAs are signed messages from Wormhole guardians that prove a message was emitted on the source chain
library WormholeParser {
    /// @notice Parsed VAA structure (subset of fields needed for verification)
    struct ParsedVAA {
        /// @notice VAA version
        uint8 version;
        /// @notice Guardian set index that signed this VAA
        uint32 guardianSetIndex;
        /// @notice Number of signatures
        uint8 signatureCount;
        /// @notice Timestamp when the message was observed
        uint32 timestamp;
        /// @notice Nonce of the message
        uint32 nonce;
        /// @notice Chain ID where the message originated
        uint16 emitterChainId;
        /// @notice Address of the contract that emitted the message (bytes32 format)
        bytes32 emitterAddress;
        /// @notice Sequence number of the message
        uint64 sequence;
        /// @notice Consistency level required
        uint8 consistencyLevel;
        /// @notice The message payload
        bytes payload;
        /// @notice Hash of the VAA body (used for replay protection)
        bytes32 hash;
    }

    /// @notice Error when VAA is too short
    error VAAInvalidLength();

    /// @notice Error when VAA version is unsupported
    error VAAInvalidVersion(uint8 version);

    /// @notice Minimum VAA length (header + body without signatures)
    uint256 private constant MIN_VAA_LENGTH = 57;

    /// @notice Supported VAA version
    uint8 private constant SUPPORTED_VERSION = 1;

    /// @notice Parse a VAA without verifying signatures
    /// @dev This extracts all fields from the VAA for inspection
    ///      Signature verification should be done by the Wormhole core contract
    /// @param encodedVAA The raw VAA bytes
    /// @return vaa The parsed VAA structure
    function parseVAA(bytes memory encodedVAA) internal pure returns (ParsedVAA memory vaa) {
        if (encodedVAA.length < MIN_VAA_LENGTH) {
            revert VAAInvalidLength();
        }

        uint256 offset = 0;

        // Parse version (1 byte)
        vaa.version = uint8(encodedVAA[offset]);
        offset += 1;

        if (vaa.version != SUPPORTED_VERSION) {
            revert VAAInvalidVersion(vaa.version);
        }

        // Parse guardian set index (4 bytes)
        vaa.guardianSetIndex = _readUint32(encodedVAA, offset);
        offset += 4;

        // Parse signature count (1 byte)
        vaa.signatureCount = uint8(encodedVAA[offset]);
        offset += 1;

        // Skip signatures (66 bytes each: guardianIndex(1) + r(32) + s(32) + v(1))
        offset += uint256(vaa.signatureCount) * 66;

        // Ensure we have enough bytes for the body
        if (encodedVAA.length < offset + 51) {
            revert VAAInvalidLength();
        }

        // Calculate hash of the body (everything after signatures)
        vaa.hash = keccak256(_slice(encodedVAA, offset, encodedVAA.length - offset));

        // Parse timestamp (4 bytes)
        vaa.timestamp = _readUint32(encodedVAA, offset);
        offset += 4;

        // Parse nonce (4 bytes)
        vaa.nonce = _readUint32(encodedVAA, offset);
        offset += 4;

        // Parse emitter chain ID (2 bytes)
        vaa.emitterChainId = _readUint16(encodedVAA, offset);
        offset += 2;

        // Parse emitter address (32 bytes)
        vaa.emitterAddress = _readBytes32(encodedVAA, offset);
        offset += 32;

        // Parse sequence (8 bytes)
        vaa.sequence = _readUint64(encodedVAA, offset);
        offset += 8;

        // Parse consistency level (1 byte)
        vaa.consistencyLevel = uint8(encodedVAA[offset]);
        offset += 1;

        // Remaining bytes are the payload
        if (encodedVAA.length > offset) {
            vaa.payload = _slice(encodedVAA, offset, encodedVAA.length - offset);
        }
    }

    /// @notice Compute the hash of a VAA (used for replay protection)
    /// @param encodedVAA The raw VAA bytes
    /// @return The keccak256 hash of the VAA
    function computeVAAHash(bytes memory encodedVAA) internal pure returns (bytes32) {
        return keccak256(encodedVAA);
    }

    /// @notice Convert an address to bytes32 (Wormhole format)
    /// @dev Wormhole stores addresses as bytes32, left-padded with zeros
    /// @param addr The address to convert
    /// @return The bytes32 representation
    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /// @notice Convert bytes32 to address (extract last 20 bytes)
    /// @param b The bytes32 value
    /// @return The address
    function bytes32ToAddress(bytes32 b) internal pure returns (address) {
        return address(uint160(uint256(b)));
    }

    // ============ Internal Helper Functions ============

    /// @notice Read a uint16 from bytes at a given offset (big-endian)
    function _readUint16(bytes memory data, uint256 offset) private pure returns (uint16) {
        return uint16(uint8(data[offset])) << 8 | uint16(uint8(data[offset + 1]));
    }

    /// @notice Read a uint32 from bytes at a given offset (big-endian)
    function _readUint32(bytes memory data, uint256 offset) private pure returns (uint32) {
        return uint32(uint8(data[offset])) << 24 | uint32(uint8(data[offset + 1])) << 16
            | uint32(uint8(data[offset + 2])) << 8 | uint32(uint8(data[offset + 3]));
    }

    /// @notice Read a uint64 from bytes at a given offset (big-endian)
    function _readUint64(bytes memory data, uint256 offset) private pure returns (uint64) {
        return uint64(uint8(data[offset])) << 56 | uint64(uint8(data[offset + 1])) << 48
            | uint64(uint8(data[offset + 2])) << 40 | uint64(uint8(data[offset + 3])) << 32
            | uint64(uint8(data[offset + 4])) << 24 | uint64(uint8(data[offset + 5])) << 16
            | uint64(uint8(data[offset + 6])) << 8 | uint64(uint8(data[offset + 7]));
    }

    /// @notice Read a bytes32 from bytes at a given offset
    function _readBytes32(bytes memory data, uint256 offset) private pure returns (bytes32 result) {
        assembly {
            result := mload(add(add(data, 32), offset))
        }
    }

    /// @notice Extract a slice of bytes
    function _slice(bytes memory data, uint256 start, uint256 length) private pure returns (bytes memory) {
        bytes memory result = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = data[start + i];
        }
        return result;
    }
}
