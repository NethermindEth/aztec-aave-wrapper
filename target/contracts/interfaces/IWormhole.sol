// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IWormhole
 * @notice Core Wormhole interface for VAA parsing and message publishing
 * @dev Used on target chain to parse and verify Wormhole messages (VAAs)
 *
 * VAA = Verified Action Approval - a signed message from Wormhole guardians
 * that proves a message was emitted on the source chain.
 */
interface IWormhole {
    /**
     * @notice Signature data structure
     */
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    /**
     * @notice Verified Action Approval structure
     */
    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    /**
     * @notice Parse and verify a VAA
     * @param encodedVM The encoded VAA bytes
     * @return vm The parsed and verified VM struct
     * @return valid Whether the VAA is valid and verified
     * @return reason Reason for invalidity (if valid is false)
     */
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason);

    /**
     * @notice Publish a message to be attested by guardians
     * @param nonce Unique nonce for this message
     * @param payload Message payload
     * @param consistencyLevel Number of confirmations required
     * @return sequence Sequence number of the published message
     */
    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence);

    /**
     * @notice Get the current guardian set index
     * @return Guardian set index
     */
    function getCurrentGuardianSetIndex() external view returns (uint32);

    /**
     * @notice Get guardian set info
     * @param index Guardian set index
     * @return guardianSet Guardian set addresses and expiration time
     */
    function getGuardianSet(uint32 index) external view returns (GuardianSet memory);

    /**
     * @notice Guardian set structure
     */
    struct GuardianSet {
        address[] keys;
        uint32 expirationTime;
    }

    /**
     * @notice Get the chain ID of this chain in Wormhole format
     * @return Chain ID
     */
    function chainId() external view returns (uint16);

    /**
     * @notice Get the governance chain ID
     * @return Governance chain ID
     */
    function governanceChainId() external view returns (uint16);

    /**
     * @notice Get the governance contract address
     * @return Governance contract address
     */
    function governanceContract() external view returns (bytes32);

    /**
     * @notice Get the message fee
     * @return Message fee in native token
     */
    function messageFee() external view returns (uint256);

    /**
     * @notice Verify VM signatures only (without state checks)
     * @param encodedVM The encoded VAA bytes
     * @return vm The parsed VM struct
     * @return valid Whether signatures are valid
     * @return reason Reason for invalidity
     */
    function parseVM(bytes memory encodedVM)
        external
        pure
        returns (VM memory vm, bool valid, string memory reason);
}
