// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { TokenPortal } from "../contracts/TokenPortal.sol";
import { IAztecInbox } from "../contracts/interfaces/IAztecInbox.sol";
import { IAztecOutbox } from "../contracts/interfaces/IAztecOutbox.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { DataStructures } from "../contracts/libraries/DataStructures.sol";
import { Hash } from "../contracts/libraries/Hash.sol";

/**
 * @title TokenPortalTest
 * @notice Unit tests for TokenPortal contract
 * @dev Tests deposit and withdraw flows with mock Aztec infrastructure
 */
contract TokenPortalTest is Test {
    TokenPortal public portal;

    // Mock contracts
    MockAztecInboxForPortal public inbox;
    MockAztecOutboxForPortal public outbox;
    MockERC20 public token;

    // Configuration
    bytes32 public l2Bridge = bytes32(uint256(0xdeadbeef));

    // Test accounts
    address public depositor = makeAddr("depositor");
    address public recipient = makeAddr("recipient");
    address public relayer = makeAddr("relayer");

    // Test data
    bytes32 public testSecretHash = keccak256("test_secret");
    bytes32 public testTo = bytes32(uint256(0x12345));
    uint256 public testAmount = 1000e18;

    function setUp() public {
        // Deploy mock contracts
        inbox = new MockAztecInboxForPortal();
        outbox = new MockAztecOutboxForPortal();
        token = new MockERC20("Test Token", "TEST", 18);

        // Deploy portal
        portal = new TokenPortal(address(token), address(inbox), address(outbox), l2Bridge);

        // Mint tokens to depositor
        token.mint(depositor, 100_000e18);

        // Approve portal to spend tokens
        vm.prank(depositor);
        token.approve(address(portal), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(portal.underlying(), address(token));
        assertEq(portal.inbox(), address(inbox));
        assertEq(portal.outbox(), address(outbox));
        assertEq(portal.l2Bridge(), l2Bridge);
        assertEq(portal.aztecVersion(), inbox.VERSION());
    }

    function test_Constructor_RevertIf_ZeroUnderlying() public {
        vm.expectRevert(TokenPortal.ZeroAddress.selector);
        new TokenPortal(address(0), address(inbox), address(outbox), l2Bridge);
    }

    function test_Constructor_RevertIf_ZeroInbox() public {
        vm.expectRevert(TokenPortal.ZeroAddress.selector);
        new TokenPortal(address(token), address(0), address(outbox), l2Bridge);
    }

    function test_Constructor_RevertIf_ZeroOutbox() public {
        vm.expectRevert(TokenPortal.ZeroAddress.selector);
        new TokenPortal(address(token), address(inbox), address(0), l2Bridge);
    }

    function test_Constructor_AllowsZeroL2Bridge() public {
        // L2 bridge can be zero (will be set later or is valid bytes32(0))
        TokenPortal p = new TokenPortal(address(token), address(inbox), address(outbox), bytes32(0));
        assertEq(p.l2Bridge(), bytes32(0));
    }

    // ============ depositToAztecPublic Tests ============

    function test_depositToAztecPublic_Success() public {
        uint256 balanceBefore = token.balanceOf(address(portal));

        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPublic(testTo, testAmount, testSecretHash);

        // Verify tokens locked
        assertEq(token.balanceOf(address(portal)), balanceBefore + testAmount);
        assertEq(token.balanceOf(depositor), 100_000e18 - testAmount);

        // Verify message sent
        assertTrue(inbox.messageSent());
        assertEq(inbox.lastRecipientActor(), l2Bridge);
        assertEq(inbox.lastRecipientVersion(), inbox.VERSION());
        assertEq(inbox.lastSecretHash(), testSecretHash);

        // Verify message content (public deposit includes recipient)
        bytes32 expectedContent =
            Hash.sha256ToField(abi.encodePacked(testTo, testAmount, testSecretHash));
        assertEq(inbox.lastContent(), expectedContent);

        // Verify return values
        assertTrue(messageKey != bytes32(0));
        assertEq(messageIndex, 0);
    }

    function test_depositToAztecPublic_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        // We need to compute expected values
        bytes32 expectedContent =
            Hash.sha256ToField(abi.encodePacked(testTo, testAmount, testSecretHash));
        bytes32 expectedMessageKey =
            keccak256(abi.encode(l2Bridge, inbox.VERSION(), expectedContent, testSecretHash));

        emit TokenPortal.DepositToAztecPublic(
            testTo, testAmount, testSecretHash, expectedMessageKey, 0
        );

        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, testAmount, testSecretHash);
    }

    function test_depositToAztecPublic_MultipleDeposits() public {
        // First deposit
        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, testAmount, testSecretHash);

        // Second deposit with different params
        bytes32 secondTo = bytes32(uint256(0x98765));
        bytes32 secondSecret = keccak256("another_secret");
        uint256 secondAmount = 500e18;

        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPublic(secondTo, secondAmount, secondSecret);

        // Verify total tokens locked
        assertEq(token.balanceOf(address(portal)), testAmount + secondAmount);

        // Verify second message index incremented
        assertEq(messageIndex, 1);
        assertTrue(messageKey != bytes32(0));
    }

    function test_depositToAztecPublic_RevertIf_ZeroAmount() public {
        vm.expectRevert(TokenPortal.ZeroAmount.selector);
        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, 0, testSecretHash);
    }

    function test_depositToAztecPublic_RevertIf_InsufficientBalance() public {
        address poorUser = makeAddr("poorUser");
        token.mint(poorUser, 100e18);
        vm.prank(poorUser);
        token.approve(address(portal), type(uint256).max);

        vm.expectRevert(); // ERC20 transfer failure
        vm.prank(poorUser);
        portal.depositToAztecPublic(testTo, 1000e18, testSecretHash);
    }

    function test_depositToAztecPublic_RevertIf_NotApproved() public {
        address noApprovalUser = makeAddr("noApprovalUser");
        token.mint(noApprovalUser, 1000e18);

        vm.expectRevert(); // ERC20 approval failure
        vm.prank(noApprovalUser);
        portal.depositToAztecPublic(testTo, 100e18, testSecretHash);
    }

    // ============ depositToAztecPrivate Tests ============

    function test_depositToAztecPrivate_Success() public {
        uint256 balanceBefore = token.balanceOf(address(portal));

        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPrivate(testAmount, testSecretHash);

        // Verify tokens locked
        assertEq(token.balanceOf(address(portal)), balanceBefore + testAmount);
        assertEq(token.balanceOf(depositor), 100_000e18 - testAmount);

        // Verify message sent
        assertTrue(inbox.messageSent());
        assertEq(inbox.lastRecipientActor(), l2Bridge);
        assertEq(inbox.lastSecretHash(), testSecretHash);

        // Verify message content (private deposit does NOT include recipient)
        bytes32 expectedContent = Hash.sha256ToField(abi.encodePacked(testAmount, testSecretHash));
        assertEq(inbox.lastContent(), expectedContent);

        // Verify return values
        assertTrue(messageKey != bytes32(0));
        assertEq(messageIndex, 0);
    }

    function test_depositToAztecPrivate_EmitsEvent() public {
        bytes32 expectedContent = Hash.sha256ToField(abi.encodePacked(testAmount, testSecretHash));
        bytes32 expectedMessageKey =
            keccak256(abi.encode(l2Bridge, inbox.VERSION(), expectedContent, testSecretHash));

        vm.expectEmit(false, false, false, true);
        emit TokenPortal.DepositToAztecPrivate(testAmount, testSecretHash, expectedMessageKey, 0);

        vm.prank(depositor);
        portal.depositToAztecPrivate(testAmount, testSecretHash);
    }

    function test_depositToAztecPrivate_ContentDiffersFromPublic() public {
        // Public deposit
        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, testAmount, testSecretHash);
        bytes32 publicContent = inbox.lastContent();

        // Private deposit with same amount and secret
        vm.prank(depositor);
        portal.depositToAztecPrivate(testAmount, testSecretHash);
        bytes32 privateContent = inbox.lastContent();

        // Content should be different (private excludes recipient)
        assertTrue(publicContent != privateContent);
    }

    function test_depositToAztecPrivate_RevertIf_ZeroAmount() public {
        vm.expectRevert(TokenPortal.ZeroAmount.selector);
        vm.prank(depositor);
        portal.depositToAztecPrivate(0, testSecretHash);
    }

    function test_depositToAztecPrivate_RevertIf_InsufficientBalance() public {
        address poorUser = makeAddr("poorUser");
        token.mint(poorUser, 100e18);
        vm.prank(poorUser);
        token.approve(address(portal), type(uint256).max);

        vm.expectRevert(); // ERC20 transfer failure
        vm.prank(poorUser);
        portal.depositToAztecPrivate(1000e18, testSecretHash);
    }

    // ============ withdraw Tests ============

    function test_withdraw_Success() public {
        // First deposit tokens to portal (simulating locked funds)
        token.mint(address(portal), testAmount);

        // Setup valid L2->L1 message
        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](3);
        siblingPath[0] = keccak256("sibling_0");
        siblingPath[1] = keccak256("sibling_1");
        siblingPath[2] = keccak256("sibling_2");

        // Compute expected message content (without caller restriction)
        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );

        // Mark message as valid in outbox mock
        outbox.setMessageValid(content, l2BlockNumber, true);

        uint256 recipientBalanceBefore = token.balanceOf(recipient);

        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);

        // Verify tokens released
        assertEq(token.balanceOf(recipient), recipientBalanceBefore + testAmount);

        // Verify message consumed
        assertTrue(outbox.consumedAtCheckpoint(l2BlockNumber, leafIndex));
    }

    function test_withdraw_WithCaller_Success() public {
        token.mint(address(portal), testAmount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](3);
        siblingPath[0] = keccak256("sibling_0");
        siblingPath[1] = keccak256("sibling_1");
        siblingPath[2] = keccak256("sibling_2");

        // Compute expected message content WITH caller restriction
        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(
                bytes32(uint256(uint160(recipient))), testAmount, bytes32(uint256(uint160(relayer)))
            )
        );

        outbox.setMessageValid(content, l2BlockNumber, true);

        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, true, l2BlockNumber, leafIndex, siblingPath);

        assertEq(token.balanceOf(recipient), testAmount);
    }

    function test_withdraw_EmitsEvent() public {
        token.mint(address(portal), testAmount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](3);
        siblingPath[0] = keccak256("sibling_0");
        siblingPath[1] = keccak256("sibling_1");
        siblingPath[2] = keccak256("sibling_2");

        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        vm.expectEmit(true, false, false, true);
        emit TokenPortal.WithdrawFromAztec(recipient, testAmount);

        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_AnyoneCanExecute() public {
        token.mint(address(portal), testAmount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        // Without caller restriction, anyone can execute
        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        address randomExecutor = makeAddr("randomExecutor");
        vm.prank(randomExecutor);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);

        assertEq(token.balanceOf(recipient), testAmount);
    }

    function test_withdraw_RevertIf_ZeroRecipient() public {
        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        vm.expectRevert(TokenPortal.ZeroAddress.selector);
        vm.prank(relayer);
        portal.withdraw(address(0), testAmount, false, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_RevertIf_ZeroAmount() public {
        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        vm.expectRevert(TokenPortal.ZeroAmount.selector);
        vm.prank(relayer);
        portal.withdraw(recipient, 0, false, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_RevertIf_InvalidMessage() public {
        token.mint(address(portal), testAmount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        // Don't set message as valid in outbox - should fail
        vm.expectRevert("Message not valid");
        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_RevertIf_WrongCaller() public {
        token.mint(address(portal), testAmount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        // Message was created with relayer as the required caller
        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(
                bytes32(uint256(uint160(recipient))), testAmount, bytes32(uint256(uint160(relayer)))
            )
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        // Different user tries to execute
        address wrongCaller = makeAddr("wrongCaller");
        vm.expectRevert("Message not valid");
        vm.prank(wrongCaller);
        portal.withdraw(recipient, testAmount, true, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_RevertIf_MessageAlreadyConsumed() public {
        token.mint(address(portal), testAmount * 2);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        // First withdrawal succeeds
        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);

        // Second withdrawal with same leafIndex fails (message already consumed)
        vm.expectRevert("Already consumed");
        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);
    }

    function test_withdraw_RevertIf_InsufficientPortalBalance() public {
        // Don't mint tokens to portal - it has zero balance
        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        vm.expectRevert(); // ERC20 transfer failure
        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);
    }

    // ============ Edge Case Tests ============

    function test_DepositAndWithdraw_FullCycle() public {
        // 1. Deposit tokens
        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, testAmount, testSecretHash);

        // Verify tokens locked
        assertEq(token.balanceOf(address(portal)), testAmount);

        // 2. Withdraw tokens (simulating L2->L1 message arrival)
        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(recipient))), testAmount, bytes32(0))
        );
        outbox.setMessageValid(content, l2BlockNumber, true);

        vm.prank(relayer);
        portal.withdraw(recipient, testAmount, false, l2BlockNumber, leafIndex, siblingPath);

        // Verify tokens released
        assertEq(token.balanceOf(address(portal)), 0);
        assertEq(token.balanceOf(recipient), testAmount);
    }

    function test_SmallAmounts() public {
        uint256 smallAmount = 1; // 1 wei

        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, smallAmount, testSecretHash);

        assertEq(token.balanceOf(address(portal)), smallAmount);
    }

    function test_LargeAmounts() public {
        uint256 largeAmount = type(uint128).max; // Very large amount
        token.mint(depositor, largeAmount);
        vm.prank(depositor);
        token.approve(address(portal), largeAmount);

        vm.prank(depositor);
        portal.depositToAztecPublic(testTo, largeAmount, testSecretHash);

        assertEq(token.balanceOf(address(portal)), largeAmount);
    }

    function test_ZeroSecretHash() public {
        // Zero secret hash is technically valid (though not recommended)
        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPublic(testTo, testAmount, bytes32(0));

        assertTrue(messageKey != bytes32(0));
        assertEq(messageIndex, 0);
        assertEq(inbox.lastSecretHash(), bytes32(0));
    }

    function test_ZeroToAddress() public {
        // Zero L2 address is technically valid for public deposits
        vm.prank(depositor);
        portal.depositToAztecPublic(bytes32(0), testAmount, testSecretHash);

        assertEq(token.balanceOf(address(portal)), testAmount);
    }

    // ============ Fuzz Tests ============

    function testFuzz_depositToAztecPublic(bytes32 to, uint256 amount, bytes32 secretHash) public {
        vm.assume(amount > 0);
        vm.assume(amount <= token.balanceOf(depositor));

        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPublic(to, amount, secretHash);

        assertEq(token.balanceOf(address(portal)), amount);
        assertTrue(messageKey != bytes32(0));
        assertEq(messageIndex, 0);
    }

    function testFuzz_depositToAztecPrivate(uint256 amount, bytes32 secretHash) public {
        vm.assume(amount > 0);
        vm.assume(amount <= token.balanceOf(depositor));

        vm.prank(depositor);
        (bytes32 messageKey, uint256 messageIndex) =
            portal.depositToAztecPrivate(amount, secretHash);

        assertEq(token.balanceOf(address(portal)), amount);
        assertTrue(messageKey != bytes32(0));
        assertEq(messageIndex, 0);
    }

    function testFuzz_withdraw(address to, uint256 amount) public {
        vm.assume(to != address(0));
        vm.assume(amount > 0);
        vm.assume(amount <= type(uint128).max);

        token.mint(address(portal), amount);

        uint256 l2BlockNumber = 100;
        uint256 leafIndex = 5;
        bytes32[] memory siblingPath = new bytes32[](0);

        bytes32 content =
            Hash.sha256ToField(abi.encodePacked(bytes32(uint256(uint160(to))), amount, bytes32(0)));
        outbox.setMessageValid(content, l2BlockNumber, true);

        vm.prank(relayer);
        portal.withdraw(to, amount, false, l2BlockNumber, leafIndex, siblingPath);

        assertEq(token.balanceOf(to), amount);
    }
}

// ============ Mock Contracts ============

/**
 * @title MockAztecInboxForPortal
 * @notice Mock Aztec inbox for TokenPortal tests
 */
contract MockAztecInboxForPortal is IAztecInbox {
    bool public messageSent;
    bytes32 public lastRecipientActor;
    uint256 public lastRecipientVersion;
    bytes32 public lastContent;
    bytes32 public lastSecretHash;
    uint256 public messageCount;

    uint256 public constant VERSION_VALUE = 1;

    function VERSION() external pure override returns (uint256) {
        return VERSION_VALUE;
    }

    function sendL2Message(
        DataStructures.L2Actor memory _recipient,
        bytes32 _content,
        bytes32 _secretHash
    ) external override returns (bytes32 entryKey, uint256 index) {
        messageSent = true;
        lastRecipientActor = _recipient.actor;
        lastRecipientVersion = _recipient.version;
        lastContent = _content;
        lastSecretHash = _secretHash;

        entryKey =
            keccak256(abi.encode(_recipient.actor, _recipient.version, _content, _secretHash));
        index = messageCount;
        messageCount++;

        return (entryKey, index);
    }

    function getRoot() external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getSize() external view override returns (uint256) {
        return messageCount;
    }
}

/**
 * @title MockAztecOutboxForPortal
 * @notice Mock Aztec outbox for TokenPortal tests
 */
contract MockAztecOutboxForPortal is IAztecOutbox {
    mapping(bytes32 => mapping(uint256 => bool)) public validMessages;
    mapping(uint256 => mapping(uint256 => bool)) public consumedAtCheckpoint;

    function setMessageValid(bytes32 messageContent, uint256 blockNumber, bool valid) external {
        validMessages[messageContent][blockNumber] = valid;
    }

    function consume(
        DataStructures.L2ToL1Msg calldata _message,
        uint256 _l2BlockNumber,
        uint256 _leafIndex,
        bytes32[] calldata /* _path */
    ) external override {
        require(validMessages[_message.content][_l2BlockNumber], "Message not valid");
        require(!consumedAtCheckpoint[_l2BlockNumber][_leafIndex], "Already consumed");
        consumedAtCheckpoint[_l2BlockNumber][_leafIndex] = true;
    }

    function hasMessageBeenConsumedAtCheckpoint(
        uint256 _l2BlockNumber,
        uint256 _leafIndex
    ) external view override returns (bool) {
        return consumedAtCheckpoint[_l2BlockNumber][_leafIndex];
    }

    function getRootData(
        uint256
    ) external pure override returns (bytes32, uint256) {
        return (bytes32(0), 0);
    }
}
