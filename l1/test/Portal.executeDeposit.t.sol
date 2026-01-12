// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { DepositIntent, IntentLib } from "../contracts/types/Intent.sol";
import { IAztecOutbox } from "../contracts/interfaces/IAztecOutbox.sol";
import { IWormholeTokenBridge } from "../contracts/interfaces/IWormholeTokenBridge.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Portal.executeDeposit Tests
 * @notice Comprehensive tests for executeDeposit function covering:
 * - Successful execution with valid parameters
 * - Deadline validation (min/max bounds)
 * - Replay attack prevention
 * - Aztec outbox consumption
 * - Wormhole bridging
 * - Edge cases and failure modes
 */
contract PortalExecuteDepositTest is Test {
    AztecAavePortalL1 public portal;

    // Mock contracts
    MockAztecOutbox public aztecOutbox;
    MockWormholeTokenBridge public wormholeTokenBridge;
    MockERC20 public token;

    // Mock addresses
    address public aztecInbox = makeAddr("aztecInbox");
    address public tokenPortal = makeAddr("tokenPortal");
    address public wormholeRelayer = makeAddr("wormholeRelayer");
    bytes32 public l2ContractAddress = bytes32(uint256(1));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(2));

    // Test accounts
    address public relayer = makeAddr("relayer");
    address public user = makeAddr("user");

    // Test intent
    DepositIntent public validIntent;
    uint256 public l2BlockNumber = 100;
    uint256 public leafIndex = 5;
    bytes32[] public validSiblingPath;

    function setUp() public {
        // Deploy mock contracts
        aztecOutbox = new MockAztecOutbox();
        wormholeTokenBridge = new MockWormholeTokenBridge();
        token = new MockERC20("Test Token", "TEST", 18);

        // Deploy portal
        portal = new AztecAavePortalL1(
            address(aztecOutbox),
            aztecInbox,
            tokenPortal,
            address(wormholeTokenBridge),
            wormholeRelayer,
            l2ContractAddress,
            targetChainId,
            targetExecutor
        );

        // Setup valid intent
        validIntent = DepositIntent({
            intentId: keccak256("test_intent_1"),
            ownerHash: keccak256(abi.encode(user)),
            asset: address(token),
            amount: 1000e18,
            originalDecimals: 18,
            targetChainId: uint32(targetChainId),
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256("salt_1")
        });

        // Setup valid Merkle proof
        validSiblingPath = new bytes32[](3);
        validSiblingPath[0] = keccak256("sibling_0");
        validSiblingPath[1] = keccak256("sibling_1");
        validSiblingPath[2] = keccak256("sibling_2");

        // Mint tokens to portal for testing
        token.mint(address(portal), 10_000e18);

        // Fund relayer for Wormhole fees
        vm.deal(relayer, 10 ether);
    }

    // ============ Success Cases ============

    function test_executeDeposit_Success() public {
        // Setup: Configure mocks to accept the intent
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Execute deposit
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();

        // Verify intent was consumed
        assertTrue(portal.consumedIntents(validIntent.intentId));

        // Verify outbox consume was called
        assertTrue(aztecOutbox.wasConsumed(messageHash));

        // Verify Wormhole bridge was called
        assertTrue(wormholeTokenBridge.wasTransferCalled(validIntent.intentId));
    }

    function test_executeDeposit_EmitsEvent() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Expect event emission
        vm.expectEmit(true, true, false, true);
        emit AztecAavePortalL1.DepositInitiated(
            validIntent.intentId,
            validIntent.asset,
            validIntent.amount,
            uint16(validIntent.targetChainId)
        );

        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    function test_executeDeposit_MinDeadline() public {
        // Set deadline to exactly minimum (5 minutes)
        validIntent.deadline = uint64(block.timestamp + portal.MIN_DEADLINE());

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    function test_executeDeposit_MaxDeadline() public {
        // Set deadline to exactly maximum (24 hours)
        validIntent.deadline = uint64(block.timestamp + portal.MAX_DEADLINE());

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    function test_executeDeposit_AnyoneCanExecute() public {
        // Test that any address can execute (relayer model)
        address randomExecutor = makeAddr("randomExecutor");
        vm.deal(randomExecutor, 1 ether);

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(randomExecutor);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    // ============ Deadline Validation Failures ============

    function test_executeDeposit_RevertIf_DeadlineTooSoon() public {
        // Set deadline less than minimum (4 minutes)
        validIntent.deadline = uint64(block.timestamp + 4 minutes);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, validIntent.deadline)
        );
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeDeposit_RevertIf_DeadlineTooFar() public {
        // Set deadline greater than maximum (25 hours)
        validIntent.deadline = uint64(block.timestamp + 25 hours);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, validIntent.deadline)
        );
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeDeposit_RevertIf_DeadlinePassed() public {
        // Set deadline in the past
        validIntent.deadline = uint64(block.timestamp + 1 hours);

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Warp past the deadline
        vm.warp(block.timestamp + 2 hours);

        vm.prank(relayer);
        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeDeposit_RevertIf_DeadlineExactlyAtBlockTimestamp() public {
        // Set deadline to current block timestamp
        validIntent.deadline = uint64(block.timestamp + 1 hours);

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Warp to exactly the deadline
        vm.warp(validIntent.deadline);

        vm.prank(relayer);
        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    // ============ Replay Protection ============

    function test_executeDeposit_RevertIf_IntentAlreadyConsumed() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // Execute once successfully
        portal.executeDeposit{ value: 0.1 ether }(
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
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber + 1, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    function test_executeDeposit_ReplayProtection_BeforeOutboxConsume() public {
        // Verify that replay check happens FIRST, before deadline validation and outbox consumption
        // This is critical for:
        // 1. Gas efficiency - cheapest check first
        // 2. Security - prevent wasted computation on replays
        // 3. Information leakage - don't reveal deadline status to attackers

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // First execution
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // For second attempt, replay check should fail immediately
        // Neither deadline validation nor outbox consumption should be executed
        uint256 consumeCountBefore = aztecOutbox.consumeCallCount();

        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validIntent.intentId
            )
        );
        portal.executeDeposit{ value: 0.1 ether }(
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

    function test_executeDeposit_ReplayProtection_BeforeDeadlineCheck() public {
        // Verify that replay check happens before deadline validation
        // Even with an expired deadline, replay should be caught first

        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.startPrank(relayer);

        // First execution with valid deadline
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Warp past the deadline
        vm.warp(validIntent.deadline + 1);

        // Second attempt should fail with replay error, NOT deadline error
        // This proves replay check happens before deadline check
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validIntent.intentId
            )
        );
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        vm.stopPrank();
    }

    // ============ Outbox Consumption Failures ============

    function test_executeDeposit_RevertIf_OutboxMessageNotAvailable() public {
        // Don't set message as valid in outbox mock
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, false);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeDeposit_RevertIf_InvalidMerkleProof() public {
        // Message exists but with different block number
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber + 1, true);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent,
            l2BlockNumber, // Wrong block number
            leafIndex,
            validSiblingPath
        );
    }

    function test_executeDeposit_MessageHashMustMatchL2Encoding() public {
        // Create an intent with different data
        DepositIntent memory wrongIntent = validIntent;
        wrongIntent.amount = 999e18; // Different amount

        bytes32 wrongMessageHash = IntentLib.hashDepositIntent(wrongIntent);
        bytes32 correctMessageHash = IntentLib.hashDepositIntent(validIntent);

        // Only set wrong hash as valid
        aztecOutbox.setMessageValid(wrongMessageHash, l2BlockNumber, true);
        aztecOutbox.setMessageValid(correctMessageHash, l2BlockNumber, false);

        vm.prank(relayer);
        vm.expectRevert("Failed to consume outbox message");
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, // Using correct intent but hash won't match
            l2BlockNumber,
            leafIndex,
            validSiblingPath
        );
    }

    // ============ Wormhole Integration ============

    function test_executeDeposit_PassesCorrectPayloadToWormhole() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify Wormhole received correct parameters
        MockWormholeTokenBridge.TransferCall memory call = wormholeTokenBridge.getLastTransfer();
        assertEq(call.token, validIntent.asset);
        assertEq(call.amount, validIntent.amount);
        assertEq(call.recipientChain, uint16(validIntent.targetChainId));
        assertEq(call.recipient, targetExecutor);

        // Verify payload encodes the intent correctly
        DepositIntent memory decodedIntent = IntentLib.decodeDepositIntent(call.payload);
        assertEq(decodedIntent.intentId, validIntent.intentId);
        assertEq(decodedIntent.ownerHash, validIntent.ownerHash);
        assertEq(decodedIntent.amount, validIntent.amount);
    }

    function test_executeDeposit_UsesMsgValueForWormholeFees() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        uint256 wormholeFee = 0.5 ether;

        vm.prank(relayer);
        portal.executeDeposit{ value: wormholeFee }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify Wormhole received the fee
        assertEq(wormholeTokenBridge.lastMsgValue(), wormholeFee);
    }

    // ============ Edge Cases ============

    function test_executeDeposit_MultipleIntents_DifferentIntentIds() public {
        // Setup first intent
        bytes32 messageHash1 = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash1, l2BlockNumber, true);

        // Create second intent with different ID
        DepositIntent memory intent2 = validIntent;
        intent2.intentId = keccak256("test_intent_2");
        intent2.salt = keccak256("salt_2");

        bytes32 messageHash2 = IntentLib.hashDepositIntent(intent2);
        aztecOutbox.setMessageValid(messageHash2, l2BlockNumber + 1, true);

        vm.startPrank(relayer);

        // Execute first intent
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Execute second intent - should succeed
        portal.executeDeposit{ value: 0.1 ether }(
            intent2, l2BlockNumber + 1, leafIndex, validSiblingPath
        );

        vm.stopPrank();

        // Verify both intents were consumed
        assertTrue(portal.consumedIntents(validIntent.intentId));
        assertTrue(portal.consumedIntents(intent2.intentId));
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

contract MockWormholeTokenBridge is IWormholeTokenBridge {
    struct TransferCall {
        address token;
        uint256 amount;
        uint16 recipientChain;
        bytes32 recipient;
        uint32 nonce;
        bytes payload;
    }

    mapping(bytes32 => bool) public transferCalled;
    TransferCall public lastTransfer;
    uint256 public lastMsgValue;
    bool public anyTransferCalled;

    function transferTokensWithPayload(
        address token,
        uint256 amount,
        uint16 recipientChain,
        bytes32 recipient,
        uint32 nonce,
        bytes memory payload
    ) external payable returns (uint64 sequence) {
        // Extract intentId from payload (first 32 bytes of decoded struct)
        bytes32 intentId;
        assembly {
            // Skip length prefix (0x20) and load first 32 bytes of payload data
            intentId := mload(add(payload, 0x20))
        }
        transferCalled[intentId] = true;
        anyTransferCalled = true;

        lastTransfer = TransferCall({
            token: token,
            amount: amount,
            recipientChain: recipientChain,
            recipient: recipient,
            nonce: nonce,
            payload: payload
        });

        lastMsgValue = msg.value;

        return 1; // Mock sequence number
    }

    function wasTransferCalled(
        bytes32 intentId
    ) external view returns (bool) {
        return transferCalled[intentId];
    }

    function getLastTransfer() external view returns (TransferCall memory) {
        return lastTransfer;
    }

    function completeTransferWithPayload(
        bytes memory /* encodedVm */
    ) external pure returns (bytes memory payload) {
        return "";
    }

    function normalizeAmount(
        uint256 amount,
        uint8 /* decimals */
    ) external pure returns (uint256) {
        return amount;
    }

    function denormalizeAmount(
        uint256 amount,
        uint8 /* decimals */
    ) external pure returns (uint256) {
        return amount;
    }

    function isTransferCompleted(
        bytes32 /* hash */
    ) external pure returns (bool) {
        return false;
    }
}

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
