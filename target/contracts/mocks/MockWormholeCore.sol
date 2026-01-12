// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { IWormhole } from "../interfaces/IWormhole.sol";

/**
 * @title MockWormholeCore
 * @notice Mock implementation of Wormhole Core for local testing on target chain
 * @dev Provides VAA parsing and verification with configurable behavior for testing
 *
 * Features:
 * - Configurable emitter chain and address
 * - Configurable validity mode (for testing rejection scenarios)
 * - VAA encoding/decoding helpers for tests
 * - Message publishing with sequence tracking
 *
 * Security: ONLY FOR TESTING - bypasses all signature verification
 */
contract MockWormholeCore is IWormhole {
    // ============ State ============

    /// @notice Current guardian set index
    uint32 private guardianSetIndex;

    /// @notice Message sequence counter
    uint64 private sequence;

    /// @notice Chain ID in Wormhole format
    uint16 private immutable _chainId;

    /// @notice Message fee (set to 0 for testing)
    uint256 public constant MESSAGE_FEE = 0;

    /// @notice Mock guardian set
    GuardianSet private currentGuardianSet;

    /// @notice Whether to return valid=false for all VAAs (for testing rejection)
    bool public rejectAllVAAs;

    /// @notice Custom rejection reason for testing
    string public rejectionReason;

    // ============ Events ============

    event LogMessagePublished(
        address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel
    );

    // ============ Constructor ============

    constructor(uint16 chainId_) {
        _chainId = chainId_;
        guardianSetIndex = 0;
        rejectAllVAAs = false;
        rejectionReason = "";

        // Initialize with a mock guardian set
        address[] memory guardians = new address[](1);
        guardians[0] = address(this); // Mock guardian
        currentGuardianSet = GuardianSet({ keys: guardians, expirationTime: type(uint32).max });
    }

    // ============ IWormhole Implementation ============

    /**
     * @notice Parse and verify a VAA
     * @dev Parses the VAA structure and returns configurable validity
     * @param encodedVM The encoded VAA bytes
     */
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        override
        returns (VM memory vm, bool valid, string memory reason)
    {
        // Check if we should reject all VAAs (for testing)
        if (rejectAllVAAs) {
            return (vm, false, rejectionReason);
        }

        // Parse the mock VAA format
        // Format: emitterChainId (2) + emitterAddress (32) + sequence (8) + payload (remaining)
        if (encodedVM.length < 42) {
            return (vm, false, "VAA too short");
        }

        uint16 emitterChainId = uint16(bytes2(encodedVM[0:2]));
        bytes32 emitterAddress = bytes32(encodedVM[2:34]);
        uint64 seq = uint64(bytes8(encodedVM[34:42]));
        bytes memory payload = encodedVM[42:];

        vm = VM({
            version: 1,
            timestamp: uint32(block.timestamp),
            nonce: 0,
            emitterChainId: emitterChainId,
            emitterAddress: emitterAddress,
            sequence: seq,
            consistencyLevel: 1,
            payload: payload,
            guardianSetIndex: guardianSetIndex,
            signatures: new Signature[](0),
            hash: keccak256(encodedVM)
        });

        return (vm, true, "");
    }

    /**
     * @notice Publish a message to be attested by guardians
     */
    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        override
        returns (uint64)
    {
        require(msg.value >= MESSAGE_FEE, "Insufficient fee");

        uint64 currentSequence = sequence++;

        emit LogMessagePublished(msg.sender, currentSequence, nonce, payload, consistencyLevel);

        return currentSequence;
    }

    /**
     * @notice Get the current guardian set index
     */
    function getCurrentGuardianSetIndex() external view override returns (uint32) {
        return guardianSetIndex;
    }

    /**
     * @notice Get guardian set info
     */
    function getGuardianSet(uint32 index) external view override returns (GuardianSet memory) {
        require(index == guardianSetIndex, "Invalid guardian set index");
        return currentGuardianSet;
    }

    /**
     * @notice Get the chain ID
     */
    function chainId() external view override returns (uint16) {
        return _chainId;
    }

    /**
     * @notice Get the governance chain ID (mocked)
     */
    function governanceChainId() external pure override returns (uint16) {
        return 1; // Ethereum mainnet by convention
    }

    /**
     * @notice Get the governance contract address (mocked)
     */
    function governanceContract() external pure override returns (bytes32) {
        return bytes32(0);
    }

    /**
     * @notice Get the message fee
     */
    function messageFee() external pure override returns (uint256) {
        return MESSAGE_FEE;
    }

    /**
     * @notice Parse VM without state checks (signature verification bypassed)
     */
    function parseVM(bytes memory encodedVM)
        external
        pure
        override
        returns (VM memory vm, bool valid, string memory reason)
    {
        if (encodedVM.length < 42) {
            return (vm, false, "VAA too short");
        }

        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 seq;

        assembly {
            emitterChainId := shr(240, mload(add(encodedVM, 32)))
            emitterAddress := mload(add(encodedVM, 34))
            seq := shr(192, mload(add(encodedVM, 66)))
        }

        bytes memory payload = new bytes(encodedVM.length - 42);
        for (uint256 i = 0; i < payload.length; i++) {
            payload[i] = encodedVM[42 + i];
        }

        vm = VM({
            version: 1,
            timestamp: 0,
            nonce: 0,
            emitterChainId: emitterChainId,
            emitterAddress: emitterAddress,
            sequence: seq,
            consistencyLevel: 1,
            payload: payload,
            guardianSetIndex: 0,
            signatures: new Signature[](0),
            hash: keccak256(encodedVM)
        });

        return (vm, true, "");
    }

    // ============ Mock-Specific Functions ============

    /**
     * @notice Encode a mock VAA for testing
     * @param emitterChainId The chain ID to include in the VAA
     * @param emitterAddress The emitter address to include
     * @param seq The sequence number
     * @param payload The message payload
     * @return The encoded VAA bytes
     */
    function encodeMockVAA(uint16 emitterChainId, bytes32 emitterAddress, uint64 seq, bytes memory payload)
        external
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(emitterChainId, emitterAddress, seq, payload);
    }

    /**
     * @notice Get current sequence number
     */
    function getCurrentSequence() external view returns (uint64) {
        return sequence;
    }

    /**
     * @notice Update guardian set (for testing)
     */
    function updateGuardianSet(address[] memory newGuardians) external {
        guardianSetIndex++;
        currentGuardianSet = GuardianSet({ keys: newGuardians, expirationTime: type(uint32).max });
    }

    /**
     * @notice Set whether to reject all VAAs (for testing invalid VAA scenarios)
     * @param reject True to reject all VAAs, false to accept
     * @param reason The rejection reason to return
     */
    function setRejectAllVAAs(bool reject, string memory reason) external {
        rejectAllVAAs = reject;
        rejectionReason = reason;
    }
}
