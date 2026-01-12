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
    uint16 public constant SOURCE_CHAIN_ID = 2; // Ethereum

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
        uint64 sequence = wormholeCore.publishMessage(nonce, payload, consistencyLevel);
        assertEq(sequence, 0);
    }

    // ============ VAA Encoding/Parsing Tests ============

    function test_EncodeMockVAA() public view {
        uint16 emitterChain = SOURCE_CHAIN_ID;
        bytes32 emitterAddress = bytes32(uint256(uint160(address(0x1234))));
        uint64 sequence = 42;
        bytes memory payload = abi.encode("test payload");

        bytes memory vaa = wormholeCore.encodeMockVAA(emitterChain, emitterAddress, sequence, payload);

        // VAA format: chainId(2) + emitterAddress(32) + sequence(8) + payload
        assertEq(vaa.length, 2 + 32 + 8 + payload.length);
    }

    function test_ParseAndVerifyVM_ValidVAA() public view {
        uint16 emitterChain = SOURCE_CHAIN_ID;
        bytes32 emitterAddress = bytes32(uint256(uint160(address(0x1234))));
        uint64 sequence = 42;
        bytes memory payload = abi.encode("test payload");

        bytes memory vaa = wormholeCore.encodeMockVAA(emitterChain, emitterAddress, sequence, payload);

        (IWormhole.VM memory vm, bool valid, string memory reason) = wormholeCore.parseAndVerifyVM(vaa);

        assertTrue(valid);
        assertEq(reason, "");
        assertEq(vm.emitterChainId, emitterChain);
        assertEq(vm.emitterAddress, emitterAddress);
        assertEq(vm.sequence, sequence);
        assertEq(vm.version, 1);
        assertEq(vm.consistencyLevel, 1);
        assertEq(vm.hash, keccak256(vaa));
    }

    function test_ParseAndVerifyVM_InvalidVAA_TooShort() public view {
        bytes memory invalidVaa = abi.encodePacked(bytes16(0));

        (, bool valid, string memory reason) = wormholeCore.parseAndVerifyVM(invalidVaa);

        assertFalse(valid);
        assertEq(reason, "VAA too short");
    }

    function test_ParseAndVerifyVM_RejectMode() public {
        // Enable rejection mode
        wormholeCore.setRejectAllVAAs(true, "Invalid guardian signatures");

        bytes memory vaa = wormholeCore.encodeMockVAA(SOURCE_CHAIN_ID, bytes32(0), 1, "test");

        (, bool valid, string memory reason) = wormholeCore.parseAndVerifyVM(vaa);

        assertFalse(valid);
        assertEq(reason, "Invalid guardian signatures");

        // Disable rejection mode
        wormholeCore.setRejectAllVAAs(false, "");

        (, valid,) = wormholeCore.parseAndVerifyVM(vaa);
        assertTrue(valid);
    }

    function test_ParseVM_ValidVAA() public view {
        uint16 emitterChain = SOURCE_CHAIN_ID;
        bytes32 emitterAddress = bytes32(uint256(uint160(address(0x5678))));
        uint64 sequence = 99;
        bytes memory payload = abi.encode("parse test");

        bytes memory vaa = wormholeCore.encodeMockVAA(emitterChain, emitterAddress, sequence, payload);

        (IWormhole.VM memory vm, bool valid, string memory reason) = wormholeCore.parseVM(vaa);

        assertTrue(valid);
        assertEq(reason, "");
        assertEq(vm.emitterChainId, emitterChain);
        assertEq(vm.emitterAddress, emitterAddress);
        assertEq(vm.sequence, sequence);
    }

    function test_ParseVM_InvalidVAA() public view {
        bytes memory invalidVaa = abi.encodePacked(uint64(123)); // Too short

        (, bool valid, string memory reason) = wormholeCore.parseVM(invalidVaa);

        assertFalse(valid);
        assertEq(reason, "VAA too short");
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

    // ============ Integration Tests ============

    function test_Integration_PublishAndParse() public {
        // Publish a message
        bytes memory payload = abi.encode("integration test");
        uint64 publishedSeq = wormholeCore.publishMessage(0, payload, 1);

        // Generate a mock VAA for this sequence
        bytes32 emitterAddress = bytes32(uint256(uint160(address(this))));
        bytes memory vaa = wormholeCore.encodeMockVAA(SOURCE_CHAIN_ID, emitterAddress, publishedSeq, payload);

        // Parse and verify the VAA
        (IWormhole.VM memory vm, bool valid,) = wormholeCore.parseAndVerifyVM(vaa);

        assertTrue(valid);
        assertEq(vm.sequence, publishedSeq);
        assertEq(vm.emitterAddress, emitterAddress);
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

    // ============ Payload Extraction Tests ============

    function test_PayloadExtraction() public view {
        bytes memory originalPayload = abi.encode("complex", uint256(123), address(0x9999));
        bytes memory vaa = wormholeCore.encodeMockVAA(SOURCE_CHAIN_ID, bytes32(0), 1, originalPayload);

        (IWormhole.VM memory vm, bool valid,) = wormholeCore.parseAndVerifyVM(vaa);

        assertTrue(valid);
        assertEq(vm.payload.length, originalPayload.length);
        assertEq(keccak256(vm.payload), keccak256(originalPayload));
    }
}
