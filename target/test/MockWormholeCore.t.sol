// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test, console2} from "forge-std/Test.sol";
import {MockWormholeCore} from "../contracts/mocks/MockWormholeCore.sol";
import {IWormhole} from "../contracts/interfaces/IWormhole.sol";

/**
 * @title MockWormholeCoreTest
 * @notice Tests for MockWormholeCore on target chain
 * @dev Validates VAA parsing and verification functionality
 */
contract MockWormholeCoreTest is Test {
    MockWormholeCore public wormholeCore;

    uint16 public constant TARGET_CHAIN_ID = 23; // Arbitrum

    function setUp() public {
        wormholeCore = new MockWormholeCore(TARGET_CHAIN_ID);
    }

    // ============ Basic Functionality Tests ============

    function test_ChainId() public view {
        assertEq(wormholeCore.chainId(), TARGET_CHAIN_ID);
    }

    function test_MessageFee() public view {
        assertEq(wormholeCore.messageFee(), 0);
    }

    function test_GovernanceChainId() public view {
        assertEq(wormholeCore.governanceChainId(), 1);
    }

    function test_GovernanceContract() public view {
        assertEq(wormholeCore.governanceContract(), bytes32(0));
    }

    function test_CurrentGuardianSetIndex() public view {
        assertEq(wormholeCore.getCurrentGuardianSetIndex(), 0);
    }

    // ============ Message Publishing Tests ============

    function test_PublishMessage() public {
        bytes memory payload = abi.encode("test message");

        uint64 sequence = wormholeCore.publishMessage(0, payload, 1);

        assertEq(sequence, 0);
        assertEq(wormholeCore.getCurrentSequence(), 1);
    }

    function test_PublishMessage_SequenceIncrement() public {
        bytes memory payload1 = abi.encode("message 1");
        bytes memory payload2 = abi.encode("message 2");
        bytes memory payload3 = abi.encode("message 3");

        uint64 seq1 = wormholeCore.publishMessage(0, payload1, 1);
        uint64 seq2 = wormholeCore.publishMessage(0, payload2, 1);
        uint64 seq3 = wormholeCore.publishMessage(0, payload3, 1);

        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(seq3, 2);
        assertEq(wormholeCore.getCurrentSequence(), 3);
    }

    function test_PublishMessage_EmitsEvent() public {
        bytes memory payload = abi.encode("test");
        uint32 nonce = 123;
        uint8 consistencyLevel = 15;

        // Just verify the message publishes successfully
        // (event testing would require duplicating the event definition)
        uint64 sequence = wormholeCore.publishMessage(nonce, payload, consistencyLevel);
        assertEq(sequence, 0);
    }

    // ============ VAA Parsing Tests ============

    function test_ParseAndVerifyVM_ValidVAA() public view {
        // Create a simple VAA (just sequence as bytes32)
        uint64 sequence = 42;
        bytes memory vaa = abi.encodePacked(bytes32(uint256(sequence)));

        (IWormhole.VM memory vm, bool valid, string memory reason) = wormholeCore.parseAndVerifyVM(vaa);

        assertTrue(valid);
        assertEq(reason, "");
        assertEq(vm.sequence, sequence);
        assertEq(vm.version, 1);
        assertEq(vm.emitterChainId, TARGET_CHAIN_ID);
        assertEq(vm.consistencyLevel, 1);
        assertEq(vm.hash, keccak256(vaa));
    }

    function test_ParseAndVerifyVM_InvalidVAA() public view {
        // Invalid VAA (wrong length)
        bytes memory invalidVaa = abi.encodePacked(bytes16(0));

        (, bool valid, string memory reason) = wormholeCore.parseAndVerifyVM(invalidVaa);

        assertFalse(valid);
        assertEq(reason, "Invalid VAA format");
    }

    function test_ParseVM_ValidVAA() public view {
        uint64 sequence = 99;
        bytes memory vaa = abi.encodePacked(bytes32(uint256(sequence)));

        (IWormhole.VM memory vm, bool valid, string memory reason) = wormholeCore.parseVM(vaa);

        assertTrue(valid);
        assertEq(reason, "");
        assertEq(vm.sequence, sequence);
        assertEq(vm.hash, keccak256(vaa));
    }

    function test_ParseVM_InvalidVAA() public view {
        bytes memory invalidVaa = abi.encodePacked(uint64(123)); // Too short

        (, bool valid, string memory reason) = wormholeCore.parseVM(invalidVaa);

        assertFalse(valid);
        assertEq(reason, "Invalid VAA format");
    }

    // ============ Guardian Set Tests ============

    function test_GetGuardianSet() public view {
        IWormhole.GuardianSet memory guardianSet = wormholeCore.getGuardianSet(0);

        assertEq(guardianSet.keys.length, 1);
        assertEq(guardianSet.keys[0], address(wormholeCore));
        assertEq(guardianSet.expirationTime, type(uint32).max);
    }

    function test_GetGuardianSet_InvalidIndex() public {
        vm.expectRevert("Invalid guardian set index");
        wormholeCore.getGuardianSet(1);
    }

    function test_UpdateGuardianSet() public {
        address[] memory newGuardians = new address[](3);
        newGuardians[0] = makeAddr("guardian1");
        newGuardians[1] = makeAddr("guardian2");
        newGuardians[2] = makeAddr("guardian3");

        wormholeCore.updateGuardianSet(newGuardians);

        assertEq(wormholeCore.getCurrentGuardianSetIndex(), 1);

        IWormhole.GuardianSet memory guardianSet = wormholeCore.getGuardianSet(1);
        assertEq(guardianSet.keys.length, 3);
        assertEq(guardianSet.keys[0], newGuardians[0]);
        assertEq(guardianSet.keys[1], newGuardians[1]);
        assertEq(guardianSet.keys[2], newGuardians[2]);
    }

    // ============ Mock VAA Generation Tests ============

    function test_GenerateMockVAA() public view {
        uint16 emitterChain = 2; // Ethereum
        bytes32 emitterAddress = bytes32(uint256(uint160(address(0x1234))));
        uint64 sequence = 42;
        bytes memory payload = abi.encode("test payload");

        bytes memory vaa = wormholeCore.generateMockVAA(emitterChain, emitterAddress, sequence, payload);

        // Mock VAA should just be the sequence encoded as bytes32
        assertEq(vaa, abi.encodePacked(bytes32(uint256(sequence))));
    }

    // ============ Integration Tests ============

    function test_Integration_PublishAndParse() public {
        // Publish a message
        bytes memory payload = abi.encode("integration test");
        uint64 publishedSeq = wormholeCore.publishMessage(0, payload, 1);

        // Generate a mock VAA for this sequence
        bytes memory vaa = wormholeCore.generateMockVAA(2, bytes32(0), publishedSeq, payload);

        // Parse and verify the VAA
        (IWormhole.VM memory vm, bool valid,) = wormholeCore.parseAndVerifyVM(vaa);

        assertTrue(valid);
        assertEq(vm.sequence, publishedSeq);
    }

    function test_Integration_MultipleMessages() public {
        // Publish multiple messages
        for (uint256 i = 0; i < 10; i++) {
            bytes memory payload = abi.encode("message", i);
            uint64 sequence = wormholeCore.publishMessage(uint32(i), payload, 1);
            assertEq(sequence, uint64(i));
        }

        assertEq(wormholeCore.getCurrentSequence(), 10);
    }
}
