// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { WithdrawIntent, IntentLib } from "../contracts/types/Intent.sol";
import { IAztecOutbox } from "../contracts/interfaces/IAztecOutbox.sol";
import { IWormholeRelayer } from "../contracts/interfaces/IWormholeRelayer.sol";

/**
 * @title Portal.executeWithdraw Tests
 * @notice Comprehensive tests for executeWithdraw function covering:
 * - Successful execution with valid parameters
 * - Deadline validation (min/max bounds)
 * - Replay attack prevention
 * - Aztec outbox consumption
 * - Wormhole relayer messaging
 * - Edge cases and failure modes
 */
contract PortalExecuteWithdrawTest is Test {
    AztecAavePortalL1 public portal;

    // Mock contracts
    MockAztecOutbox public aztecOutbox;
    MockWormholeRelayer public wormholeRelayer;
    address public wormholeTokenBridge = makeAddr("wormholeTokenBridge");

    // Mock addresses
    address public aztecInbox = makeAddr("aztecInbox");
    address public tokenPortal = makeAddr("tokenPortal");
    bytes32 public l2ContractAddress = bytes32(uint256(1));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(2));

    // Test accounts
    address public relayer = makeAddr("relayer");
    address public user = makeAddr("user");

    // Test intent
    WithdrawIntent public validIntent;
    uint256 public l2BlockNumber = 100;
    uint256 public leafIndex = 5;
    bytes32[] public validSiblingPath;

    function setUp() public {
        // Deploy mock contracts
        aztecOutbox = new MockAztecOutbox();
        wormholeRelayer = new MockWormholeRelayer();

        // Deploy portal
        portal = new AztecAavePortalL1(
            address(aztecOutbox),
            aztecInbox,
            tokenPortal,
            wormholeTokenBridge,
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor
        );

        // Setup valid intent
        validIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_intent_1"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Setup valid Merkle proof
        validSiblingPath = new bytes32[](3);
        validSiblingPath[0] = keccak256("sibling_0");
        validSiblingPath[1] = keccak256("sibling_1");
        validSiblingPath[2] = keccak256("sibling_2");

        // Fund relayer for Wormhole fees
        vm.deal(relayer, 10 ether);
    }

    // ============ Success Cases ============

    function test_executeWithdraw_Success() public {
        // Setup: Configure mocks to accept the intent
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Execute withdrawal
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();

        // Verify intent was consumed
        assertTrue(portal.consumedIntents(validIntent.intentId));

        // Verify outbox consume was called
        assertTrue(aztecOutbox.wasConsumed(messageHash));

        // Verify Wormhole relayer was called
        assertTrue(wormholeRelayer.wasSendCalled());
    }

    function test_executeWithdraw_EmitsEvent() public {
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Expect event emission
        vm.expectEmit(true, false, false, true);
        emit AztecAavePortalL1.WithdrawInitiated(validIntent.intentId, validIntent.amount);

        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    function test_executeWithdraw_MinDeadline() public {
        // Set deadline to exactly minimum (5 minutes)
        validIntent.deadline = uint64(block.timestamp + portal.MIN_DEADLINE());

        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    function test_executeWithdraw_MaxDeadline() public {
        // Set deadline to exactly maximum (24 hours)
        validIntent.deadline = uint64(block.timestamp + portal.MAX_DEADLINE());

        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    function test_executeWithdraw_AnyoneCanExecute() public {
        // Test that any address can execute (relayer model)
        address randomExecutor = makeAddr("randomExecutor");
        vm.deal(randomExecutor, 1 ether);

        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(randomExecutor);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    // ============ Deadline Validation Failures ============

    function test_executeWithdraw_RevertIf_DeadlineTooSoon() public {
        // Set deadline less than minimum (4 minutes)
        validIntent.deadline = uint64(block.timestamp + 4 minutes);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, validIntent.deadline)
        );
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_DeadlineTooFar() public {
        // Set deadline greater than maximum (25 hours)
        validIntent.deadline = uint64(block.timestamp + 25 hours);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, validIntent.deadline)
        );
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_DeadlinePassed() public {
        // Set deadline in the past
        validIntent.deadline = uint64(block.timestamp + 1 hours);

        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Warp past the deadline
        vm.warp(block.timestamp + 2 hours);

        vm.prank(relayer);
        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_DeadlineExactlyAtBlockTimestamp() public {
        // Set deadline to current block timestamp
        validIntent.deadline = uint64(block.timestamp + 1 hours);

        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Warp to exactly the deadline
        vm.warp(validIntent.deadline);

        vm.prank(relayer);
        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    // ============ Replay Protection ============

    function test_executeWithdraw_RevertIf_IntentAlreadyConsumed() public {
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Execute once successfully
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Setup outbox for second attempt (would normally fail, but we allow for testing)
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber + 1, true);

        // Try to execute again - should revert due to replay protection
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validIntent.intentId
            )
        );
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber + 1, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    function test_executeWithdraw_ReplayProtection_BeforeOutboxConsume() public {
        // Verify that replay check happens FIRST, before deadline validation and outbox consumption
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // First execution
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // For second attempt, replay check should fail immediately
        uint256 consumeCountBefore = aztecOutbox.consumeCallCount();

        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validIntent.intentId
            )
        );
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify outbox was not called on second attempt (replay check happens before)
        assertEq(
            aztecOutbox.consumeCallCount(),
            consumeCountBefore,
            "Outbox should not be called for replay attempt"
        );

        vm.stopPrank();
    }

    function test_executeWithdraw_ReplayProtection_BeforeDeadlineCheck() public {
        // Verify that replay check happens before deadline validation
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // First execution with valid deadline
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Warp past the deadline
        vm.warp(validIntent.deadline + 1);

        // Second attempt should fail with replay error, NOT deadline error
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validIntent.intentId
            )
        );
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    // ============ Outbox Consumption Failures ============

    function test_executeWithdraw_RevertIf_OutboxMessageNotAvailable() public {
        // Don't set message as valid in outbox mock
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, false);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_InvalidMerkleProof() public {
        // Message exists but with different block number
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber + 1, true);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent,
            l2BlockNumber, // Wrong block number
            leafIndex,
            validSiblingPath
        );
    }

    function test_executeWithdraw_MessageHashMustMatchL2Encoding() public {
        // Create an intent with different data
        WithdrawIntent memory wrongIntent = validIntent;
        wrongIntent.amount = 999e18; // Different amount

        bytes32 wrongMessageHash = IntentLib.hashWithdrawIntent(wrongIntent);
        bytes32 correctMessageHash = IntentLib.hashWithdrawIntent(validIntent);

        // Only set wrong hash as valid
        aztecOutbox.setMessageValid(wrongMessageHash, l2BlockNumber, true);
        aztecOutbox.setMessageValid(correctMessageHash, l2BlockNumber, false);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, // Using correct intent but hash won't match
            l2BlockNumber,
            leafIndex,
            validSiblingPath
        );
    }

    // ============ Wormhole Integration ============

    function test_executeWithdraw_PassesCorrectPayloadToWormhole() public {
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify Wormhole received correct parameters
        MockWormholeRelayer.SendCall memory call = wormholeRelayer.getLastSend();
        assertEq(call.targetChain, targetChainId);
        assertEq(call.targetAddress, address(uint160(uint256(targetExecutor))));
        assertEq(call.receiverValue, 0);
        assertEq(call.gasLimit, portal.TARGET_GAS_LIMIT());

        // Verify payload encodes the intent correctly
        WithdrawIntent memory decodedIntent = IntentLib.decodeWithdrawIntent(call.payload);
        assertEq(decodedIntent.intentId, validIntent.intentId);
        assertEq(decodedIntent.ownerHash, validIntent.ownerHash);
        assertEq(decodedIntent.amount, validIntent.amount);
        assertEq(decodedIntent.deadline, validIntent.deadline);
    }

    function test_executeWithdraw_UsesMsgValueForWormholeFees() public {
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        uint256 wormholeFee = 0.5 ether;

        vm.prank(relayer);
        portal.executeWithdraw{ value: wormholeFee }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify Wormhole received the fee
        assertEq(wormholeRelayer.lastMsgValue(), wormholeFee);
    }

    function test_executeWithdraw_UsesCorrectGasLimit() public {
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify gas limit is set correctly
        MockWormholeRelayer.SendCall memory call = wormholeRelayer.getLastSend();
        assertEq(call.gasLimit, 200_000); // TARGET_GAS_LIMIT
    }

    // ============ Edge Cases ============

    function test_executeWithdraw_MultipleIntents_DifferentIntentIds() public {
        // Setup first intent
        bytes32 messageHash1 = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash1, l2BlockNumber, true);

        // Create second intent with different ID
        WithdrawIntent memory intent2 = validIntent;
        intent2.intentId = keccak256("test_withdraw_intent_2");

        bytes32 messageHash2 = IntentLib.hashWithdrawIntent(intent2);
        aztecOutbox.setMessageValid(messageHash2, l2BlockNumber + 1, true);

        vm.startPrank(relayer);

        // Execute first intent
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Execute second intent - should succeed
        portal.executeWithdraw{ value: 0.1 ether }(
            intent2, l2BlockNumber + 1, leafIndex, validSiblingPath
        );

        vm.stopPrank();

        // Verify both intents were consumed
        assertTrue(portal.consumedIntents(validIntent.intentId));
        assertTrue(portal.consumedIntents(intent2.intentId));
    }

    function test_executeWithdraw_NoReceiverValueSent() public {
        // Verify that no native tokens are sent to target (receiverValue = 0)
        bytes32 messageHash = IntentLib.hashWithdrawIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        MockWormholeRelayer.SendCall memory call = wormholeRelayer.getLastSend();
        assertEq(call.receiverValue, 0, "No native tokens should be sent to target");
    }
}

// ============ Mock Contracts ============

contract MockAztecOutbox is IAztecOutbox {
    mapping(bytes32 => mapping(uint256 => bool)) public validMessages;
    mapping(bytes32 => bool) public consumed;
    uint256 public consumeCallCount;

    function setMessageValid(bytes32 message, uint256 blockNumber, bool valid) external {
        validMessages[message][blockNumber] = valid;
    }

    function consume(
        bytes32 _message,
        uint256 _l2BlockNumber,
        uint256, /* _leafIndex */
        bytes32[] calldata /* _path */
    ) external returns (bool) {
        consumeCallCount++;

        if (!validMessages[_message][_l2BlockNumber]) {
            return false;
        }

        consumed[_message] = true;
        return true;
    }

    function wasConsumed(
        bytes32 message
    ) external view returns (bool) {
        return consumed[message];
    }

    function hasMessageBeenConsumed(
        bytes32 _message
    ) external view returns (bool) {
        return consumed[_message];
    }

    function getRootForBlock(
        uint256 /* _l2BlockNumber */
    ) external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract MockWormholeRelayer is IWormholeRelayer {
    struct SendCall {
        uint16 targetChain;
        address targetAddress;
        bytes payload;
        uint256 receiverValue;
        uint256 gasLimit;
    }

    SendCall public lastSend;
    uint256 public lastMsgValue;
    bool public sendCalled;

    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable returns (uint64 sequence) {
        sendCalled = true;
        lastMsgValue = msg.value;
        lastSend = SendCall({
            targetChain: targetChain,
            targetAddress: targetAddress,
            payload: payload,
            receiverValue: receiverValue,
            gasLimit: gasLimit
        });
        return 1; // Mock sequence number
    }

    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit,
        uint16, /* refundChain */
        address /* refundAddress */
    ) external payable returns (uint64 sequence) {
        sendCalled = true;
        lastMsgValue = msg.value;
        lastSend = SendCall({
            targetChain: targetChain,
            targetAddress: targetAddress,
            payload: payload,
            receiverValue: receiverValue,
            gasLimit: gasLimit
        });
        return 1;
    }

    function wasSendCalled() external view returns (bool) {
        return sendCalled;
    }

    function getLastSend() external view returns (SendCall memory) {
        return lastSend;
    }

    function quoteEVMDeliveryPrice(
        uint16, /* targetChain */
        uint256, /* receiverValue */
        uint256 /* gasLimit */
    ) external pure returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused) {
        return (0.1 ether, 0);
    }

    function wormhole() external pure returns (address) {
        return address(0);
    }

    function deliveryAttempted(
        bytes32 /* deliveryHash */
    ) external pure returns (bool) {
        return false;
    }

    function deliver(
        bytes[] memory, /* encodedVMs */
        bytes memory, /* encodedDeliveryVAA */
        address payable, /* relayerRefundAddress */
        bytes memory /* deliveryOverrides */
    ) external payable { }
}
