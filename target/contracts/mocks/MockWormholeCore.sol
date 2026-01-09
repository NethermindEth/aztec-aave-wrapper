// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IWormhole} from "../interfaces/IWormhole.sol";

/**
 * @title MockWormholeCore
 * @notice Mock implementation of Wormhole Core for local testing on target chain
 * @dev Provides VAA parsing and verification with signature bypass mode for testing
 *
 * Features:
 * - Signature bypass mode (all VAAs considered valid in devnet)
 * - VAA parsing without cryptographic verification
 * - Message publishing with sequence tracking
 * - Guardian set management (mocked)
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

    // ============ Events ============

    event LogMessagePublished(
        address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel
    );

    // ============ Constructor ============

    constructor(uint16 chainId_) {
        _chainId = chainId_;
        guardianSetIndex = 0;

        // Initialize with a mock guardian set
        address[] memory guardians = new address[](1);
        guardians[0] = address(this); // Mock guardian
        currentGuardianSet = GuardianSet({keys: guardians, expirationTime: type(uint32).max});
    }

    // ============ IWormhole Implementation ============

    /**
     * @notice Parse and verify a VAA
     * @dev In mock mode, we skip signature verification and just parse the structure
     * @param encodedVM The encoded VAA bytes
     */
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        override
        returns (VM memory vm, bool valid, string memory reason)
    {
        // For simplicity in testing, we accept a minimal VAA format:
        // bytes32(sequence) as the VAA
        if (encodedVM.length == 32) {
            uint64 seq = uint64(uint256(bytes32(encodedVM)));

            vm = VM({
                version: 1,
                timestamp: uint32(block.timestamp),
                nonce: 0,
                emitterChainId: _chainId,
                emitterAddress: bytes32(uint256(uint160(address(this)))),
                sequence: seq,
                consistencyLevel: 1,
                payload: encodedVM,
                guardianSetIndex: guardianSetIndex,
                signatures: new Signature[](0),
                hash: keccak256(encodedVM)
            });

            return (vm, true, "");
        }

        return (vm, false, "Invalid VAA format");
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
        // Simple parsing - in production this would verify signatures
        if (encodedVM.length == 32) {
            uint64 seq = uint64(uint256(bytes32(encodedVM)));

            vm = VM({
                version: 1,
                timestamp: 0, // Mock timestamp
                nonce: 0,
                emitterChainId: 0,
                emitterAddress: bytes32(0),
                sequence: seq,
                consistencyLevel: 1,
                payload: encodedVM,
                guardianSetIndex: 0,
                signatures: new Signature[](0),
                hash: keccak256(encodedVM)
            });

            return (vm, true, "");
        }

        return (vm, false, "Invalid VAA format");
    }

    // ============ Mock-Specific Functions ============

    /**
     * @notice Generate a mock VAA for testing
     * @dev Returns a simple encoded VAA (just the sequence number)
     */
    function generateMockVAA(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        uint64 seq,
        bytes memory payload
    ) external pure returns (bytes memory) {
        // For testing, we just return the sequence as bytes32
        return abi.encodePacked(bytes32(uint256(seq)));
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
        currentGuardianSet = GuardianSet({keys: newGuardians, expirationTime: type(uint32).max});
    }
}
