// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { DepositIntent, WithdrawIntent, IntentLib } from "../contracts/types/Intent.sol";
import { ConfirmationStatus } from "../contracts/types/Confirmation.sol";
import { IAztecOutbox } from "../contracts/interfaces/IAztecOutbox.sol";
import { IAztecInbox } from "../contracts/interfaces/IAztecInbox.sol";
import { ILendingPool } from "../contracts/interfaces/ILendingPool.sol";
import { ITokenPortal } from "../contracts/interfaces/ITokenPortal.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { DataStructures } from "../contracts/libraries/DataStructures.sol";

/**
 * @title PortalTest
 * @notice Unit tests for AztecAavePortalL1 contract
 * @dev Tests direct Aave integration
 */
contract PortalTest is Test {
    AztecAavePortalL1 public portal;

    // Mock contracts
    MockAztecOutbox public aztecOutbox;
    MockAztecInbox public aztecInbox;
    MockTokenPortal public tokenPortal;
    MockAaveLendingPool public aavePool;
    MockERC20 public token;
    MockERC20 public aToken;

    // Configuration
    bytes32 public l2ContractAddress = bytes32(uint256(1));

    // Test accounts
    address public owner = makeAddr("owner");
    address public relayer = makeAddr("relayer");
    address public user = makeAddr("user");

    // Test data
    DepositIntent public validDepositIntent;
    WithdrawIntent public validWithdrawIntent;
    uint256 public l2BlockNumber = 100;
    uint256 public leafIndex = 5;
    bytes32[] public validSiblingPath;

    function setUp() public {
        // Deploy mock contracts
        aztecOutbox = new MockAztecOutbox();
        aztecInbox = new MockAztecInbox();
        tokenPortal = new MockTokenPortal();
        token = new MockERC20("Test Token", "TEST", 18);
        aToken = new MockERC20("Aave Test Token", "aTEST", 18);
        aavePool = new MockAaveLendingPool(address(token), address(aToken));

        // Deploy portal
        portal = new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            address(tokenPortal),
            address(aavePool),
            l2ContractAddress,
            owner
        );

        // Setup valid deposit intent
        validDepositIntent = DepositIntent({
            intentId: keccak256("test_deposit_1"),
            ownerHash: keccak256(abi.encode(user)),
            asset: address(token),
            amount: 1000e18,
            originalDecimals: 18,
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256("salt_1"),
            secretHash: keccak256("test_secret_1")
        });

        // Setup valid withdraw intent
        validWithdrawIntent = WithdrawIntent({
            intentId: keccak256("test_deposit_1"), // Same as deposit for withdrawal
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Setup valid Merkle proof
        validSiblingPath = new bytes32[](3);
        validSiblingPath[0] = keccak256("sibling_0");
        validSiblingPath[1] = keccak256("sibling_1");
        validSiblingPath[2] = keccak256("sibling_2");

        // Configure mock token portal with underlying token
        tokenPortal.setUnderlying(address(token));

        // Mint tokens to token portal for deposit testing
        // (AavePortal now claims tokens from TokenPortal via withdraw())
        token.mint(address(tokenPortal), 10_000e18);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(portal.aztecOutbox(), address(aztecOutbox));
        assertEq(portal.aztecInbox(), address(aztecInbox));
        assertEq(portal.tokenPortal(), address(tokenPortal));
        assertEq(portal.aavePool(), address(aavePool));
        assertEq(portal.l2ContractAddress(), l2ContractAddress);
        assertEq(portal.owner(), owner);
    }

    function test_Constructor_RevertIf_ZeroOutbox() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(0),
            address(aztecInbox),
            address(tokenPortal),
            address(aavePool),
            l2ContractAddress,
            owner
        );
    }

    function test_Constructor_RevertIf_ZeroInbox() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(0),
            address(tokenPortal),
            address(aavePool),
            l2ContractAddress,
            owner
        );
    }

    function test_Constructor_RevertIf_ZeroTokenPortal() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            address(0),
            address(aavePool),
            l2ContractAddress,
            owner
        );
    }

    function test_Constructor_RevertIf_ZeroAavePool() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            address(tokenPortal),
            address(0),
            l2ContractAddress,
            owner
        );
    }

    // ============ Deposit Success Tests ============

    function test_executeDeposit_Success() public {
        // Setup: Configure mocks
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        // Verify intent was consumed
        assertTrue(portal.consumedDepositIntents(validDepositIntent.intentId));

        // Verify shares were tracked
        assertEq(portal.intentShares(validDepositIntent.intentId), 1000e18);

        // Verify asset was tracked
        assertEq(portal.intentAssets(validDepositIntent.intentId), address(token));

        // Verify L2 message was sent
        assertTrue(aztecInbox.messageSent());
    }

    function test_executeDeposit_EmitsEvents() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.expectEmit(true, true, false, true);
        emit AztecAavePortalL1.DepositExecuted(
            validDepositIntent.intentId, address(token), 1000e18, 1000e18
        );

        vm.expectEmit(true, false, false, true);
        emit AztecAavePortalL1.DepositConfirmed(
            validDepositIntent.intentId, 1000e18, ConfirmationStatus.SUCCESS
        );

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_AnyoneCanExecute() public {
        address randomExecutor = makeAddr("randomExecutor");

        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(randomExecutor);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        assertTrue(portal.consumedDepositIntents(validDepositIntent.intentId));
    }

    function test_executeDeposit_MinDeadline() public {
        validDepositIntent.deadline = uint64(block.timestamp + portal.MIN_DEADLINE());

        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        assertTrue(portal.consumedDepositIntents(validDepositIntent.intentId));
    }

    function test_executeDeposit_MaxDeadline() public {
        validDepositIntent.deadline = uint64(block.timestamp + portal.MAX_DEADLINE());

        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        assertTrue(portal.consumedDepositIntents(validDepositIntent.intentId));
    }

    // ============ Deposit Failure Tests ============

    function test_executeDeposit_RevertIf_IntentAlreadyConsumed() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        // Try to execute again
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, validDepositIntent.intentId
            )
        );
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_DeadlinePassed() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Warp past deadline
        vm.warp(validDepositIntent.deadline + 1);

        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_DeadlineTooSoon() public {
        validDepositIntent.deadline = uint64(block.timestamp + 4 minutes); // Less than MIN_DEADLINE

        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.InvalidDeadline.selector, validDepositIntent.deadline
            )
        );
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_DeadlineTooFar() public {
        validDepositIntent.deadline = uint64(block.timestamp + 25 hours); // More than MAX_DEADLINE

        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.InvalidDeadline.selector, validDepositIntent.deadline
            )
        );
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_OutboxMessageNotAvailable() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, false);

        vm.expectRevert("Message not valid");
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_Paused() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(owner);
        portal.pause();

        vm.expectRevert();
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    function test_executeDeposit_RevertIf_AaveSupplyFailed() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Make the mock pool fail supply
        aavePool.setFailSupply(true);

        vm.expectRevert("MockLendingPool: supply failed");
        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);
    }

    // ============ Withdraw Success Tests ============

    function test_executeWithdraw_Success() public {
        // Create a withdraw intent with unique ID (different from deposit)
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_1"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Simulate having shares from a previous deposit by directly setting storage
        // This is needed because the contract's replay protection prevents
        // executing withdraw with the same intentId as a consumed deposit
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(5))), // slot 5 = intentShares
            bytes32(uint256(1000e18))
        );
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(6))), // slot 6 = intentAssets
            bytes32(uint256(uint160(address(token))))
        );

        // Mint aTokens to portal (simulating deposit)
        aToken.mint(address(portal), 1000e18);
        // Mint tokens to pool for withdrawal
        token.mint(address(aavePool), 1000e18);
        // Track deposit in mock pool
        aavePool.setDeposits(address(portal), 1000e18);

        bytes32 secretHash = keccak256("secret");
        bytes32 withdrawMessageHash = IntentLib.hashWithdrawIntent(withdrawIntent, address(token), secretHash);
        aztecOutbox.setMessageValid(withdrawMessageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify intent was consumed
        assertTrue(portal.consumedWithdrawIntents(withdrawIntent.intentId));

        // Verify shares were cleared
        assertEq(portal.intentShares(withdrawIntent.intentId), 0);

        // Verify asset was cleared
        assertEq(portal.intentAssets(withdrawIntent.intentId), address(0));

        // Verify token portal was called
        assertTrue(tokenPortal.depositCalled());
    }

    function test_executeWithdraw_EmitsEvents() public {
        // Create a withdraw intent with unique ID
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_2"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Simulate having shares from a previous deposit
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(5))), // slot 5 = intentShares
            bytes32(uint256(1000e18))
        );
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(6))), // slot 6 = intentAssets
            bytes32(uint256(uint160(address(token))))
        );

        aToken.mint(address(portal), 1000e18);
        token.mint(address(aavePool), 1000e18);
        aavePool.setDeposits(address(portal), 1000e18);

        bytes32 secretHash = keccak256("secret");
        bytes32 withdrawMessageHash = IntentLib.hashWithdrawIntent(withdrawIntent, address(token), secretHash);
        aztecOutbox.setMessageValid(withdrawMessageHash, l2BlockNumber, true);

        vm.expectEmit(true, true, false, true);
        emit AztecAavePortalL1.WithdrawExecuted(withdrawIntent.intentId, address(token), 1000e18);

        // Note: WithdrawConfirmed event no longer emitted - token claim completes withdrawal

        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    // ============ Withdraw Failure Tests ============

    function test_executeWithdraw_RevertIf_NoSharesForIntent() public {
        bytes32 secretHash = keccak256("secret");
        bytes32 withdrawMessageHash = IntentLib.hashWithdrawIntent(validWithdrawIntent, address(token), secretHash);
        aztecOutbox.setMessageValid(withdrawMessageHash, l2BlockNumber, true);

        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.NoSharesForIntent.selector, validWithdrawIntent.intentId
            )
        );
        vm.prank(relayer);
        portal.executeWithdraw(
            validWithdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_IntentAlreadyConsumed() public {
        // Create a withdraw intent
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_3"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Simulate having shares
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(5))), // slot 5 = intentShares
            bytes32(uint256(1000e18))
        );
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(6))), // slot 6 = intentAssets
            bytes32(uint256(uint160(address(token))))
        );

        aToken.mint(address(portal), 1000e18);
        token.mint(address(aavePool), 1000e18);
        aavePool.setDeposits(address(portal), 1000e18);

        bytes32 secretHash = keccak256("secret");
        bytes32 withdrawMessageHash = IntentLib.hashWithdrawIntent(withdrawIntent, address(token), secretHash);
        aztecOutbox.setMessageValid(withdrawMessageHash, l2BlockNumber, true);

        // First withdrawal succeeds
        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Try again - should fail because already consumed
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.IntentAlreadyConsumed.selector, withdrawIntent.intentId
            )
        );
        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber + 1, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_DeadlinePassed() public {
        // Create a withdraw intent
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_4"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Simulate having shares
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(5))), // slot 5 = intentShares
            bytes32(uint256(1000e18))
        );
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(6))), // slot 6 = intentAssets
            bytes32(uint256(uint160(address(token))))
        );

        // Warp past deadline
        vm.warp(withdrawIntent.deadline + 1);

        bytes32 secretHash = keccak256("secret");
        vm.expectRevert(AztecAavePortalL1.DeadlinePassed.selector);
        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_executeWithdraw_RevertIf_Paused() public {
        // Create a withdraw intent
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_5"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 1000e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        // Simulate having shares
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(5))), // slot 5 = intentShares
            bytes32(uint256(1000e18))
        );
        vm.store(
            address(portal),
            keccak256(abi.encode(withdrawIntent.intentId, uint256(6))), // slot 6 = intentAssets
            bytes32(uint256(uint160(address(token))))
        );

        // Pause
        vm.prank(owner);
        portal.pause();

        bytes32 secretHash = keccak256("secret");
        vm.expectRevert();
        vm.prank(relayer);
        portal.executeWithdraw(
            withdrawIntent, secretHash, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    // ============ Admin Tests ============

    function test_Pause() public {
        vm.prank(owner);
        portal.pause();

        assertTrue(portal.paused());
    }

    function test_Unpause() public {
        vm.prank(owner);
        portal.pause();

        vm.prank(owner);
        portal.unpause();

        assertFalse(portal.paused());
    }

    function test_Pause_RevertIf_NotOwner() public {
        vm.expectRevert();
        vm.prank(relayer);
        portal.pause();
    }

    function test_EmergencyWithdraw() public {
        uint256 amount = 100e18;
        address recipient = makeAddr("recipient");

        // Mint tokens directly to portal for emergency withdraw test
        token.mint(address(portal), amount);

        vm.prank(owner);
        portal.emergencyWithdraw(address(token), recipient, amount);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_EmergencyWithdraw_RevertIf_NotOwner() public {
        vm.expectRevert();
        vm.prank(relayer);
        portal.emergencyWithdraw(address(token), relayer, 100e18);
    }

    function test_EmergencyWithdraw_RevertIf_ZeroRecipient() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        vm.prank(owner);
        portal.emergencyWithdraw(address(token), address(0), 100e18);
    }

    // ============ View Functions Tests ============

    function test_GetIntentShares() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        assertEq(portal.getIntentShares(validDepositIntent.intentId), 1000e18);
    }

    function test_GetIntentAsset() public {
        bytes32 messageHash = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        assertEq(portal.getIntentAsset(validDepositIntent.intentId), address(token));
    }

    // ============ Deadline Constants Tests ============

    function test_DeadlineConstants() public view {
        assertEq(portal.MIN_DEADLINE(), 5 minutes);
        assertEq(portal.MAX_DEADLINE(), 24 hours);
    }

    // ============ Multiple Deposits Tests ============

    function test_MultipleDeposits_DifferentIntentIds() public {
        // First deposit
        bytes32 messageHash1 = IntentLib.hashDepositIntent(validDepositIntent);
        aztecOutbox.setMessageValid(messageHash1, l2BlockNumber, true);

        vm.prank(relayer);
        portal.executeDeposit(validDepositIntent, l2BlockNumber, leafIndex, validSiblingPath);

        // Second deposit with different ID and smaller amount
        DepositIntent memory intent2 = validDepositIntent;
        intent2.intentId = keccak256("test_deposit_2");
        intent2.salt = keccak256("salt_2");
        intent2.amount = 500e18;

        bytes32 messageHash2 = IntentLib.hashDepositIntent(intent2);
        aztecOutbox.setMessageValid(messageHash2, l2BlockNumber + 1, true);

        vm.prank(relayer);
        portal.executeDeposit(intent2, l2BlockNumber + 1, leafIndex, validSiblingPath);

        // Verify both intents tracked
        assertTrue(portal.consumedDepositIntents(validDepositIntent.intentId));
        assertTrue(portal.consumedDepositIntents(intent2.intentId));
        assertEq(portal.intentShares(validDepositIntent.intentId), 1000e18);
        assertEq(portal.intentShares(intent2.intentId), 500e18);
    }
}

// ============ Mock Contracts ============

contract MockAztecOutbox is IAztecOutbox {
    // Track valid message content hashes by block number
    mapping(bytes32 => mapping(uint256 => bool)) public validMessages;
    // Track consumed messages by (blockNumber, leafIndex)
    mapping(uint256 => mapping(uint256 => bool)) public consumedAtCheckpoint;

    // Aztec instance version (default to 1)
    uint256 public constant AZTEC_VERSION = 1;

    /**
     * @notice Set a message content as valid for testing
     * @param messageContent The message content hash
     * @param blockNumber The L2 block number
     * @param valid Whether the message should be considered valid
     */
    function setMessageValid(bytes32 messageContent, uint256 blockNumber, bool valid) external {
        validMessages[messageContent][blockNumber] = valid;
    }

    /**
     * @notice Consume a message from the outbox (matches real Aztec interface)
     * @param _message The L2 to L1 message struct
     * @param _l2BlockNumber The L2 block number (checkpoint)
     * @param _leafIndex The index of the message in the merkle tree
     * @param _path Merkle proof (ignored in mock)
     */
    function consume(
        DataStructures.L2ToL1Msg calldata _message,
        uint256 _l2BlockNumber,
        uint256 _leafIndex,
        bytes32[] calldata _path
    ) external override {
        // Silence unused variable warning
        _path;

        // Verify the message content is marked as valid
        require(validMessages[_message.content][_l2BlockNumber], "Message not valid");

        // Verify not already consumed
        require(!consumedAtCheckpoint[_l2BlockNumber][_leafIndex], "Already consumed");

        // Mark as consumed
        consumedAtCheckpoint[_l2BlockNumber][_leafIndex] = true;
    }

    /**
     * @notice Check if a message has been consumed at a checkpoint
     */
    function hasMessageBeenConsumedAtCheckpoint(
        uint256 _l2BlockNumber,
        uint256 _leafIndex
    ) external view override returns (bool) {
        return consumedAtCheckpoint[_l2BlockNumber][_leafIndex];
    }

    /**
     * @notice Get root data for a block (returns dummy data in mock)
     */
    function getRootData(
        uint256 /* _l2BlockNumber */
    ) external pure override returns (bytes32, uint256) {
        return (bytes32(0), 0);
    }
}

contract MockAztecInbox is IAztecInbox {
    bool public messageSent;
    bytes32 public lastRecipientActor;
    uint256 public lastRecipientVersion;
    bytes32 public lastContent;
    bytes32 public lastSecretHash;
    uint256 public messageCount;

    /// @notice Mock version - matches test expectation
    uint256 public constant VERSION_VALUE = 1;

    function VERSION() external pure override returns (uint256) {
        return VERSION_VALUE;
    }

    /**
     * @notice Send an L1->L2 message (matches real Aztec interface)
     */
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

        messageCount++;
        entryKey =
            keccak256(abi.encode(_recipient.actor, _recipient.version, _content, _secretHash));
        index = messageCount - 1;

        return (entryKey, index);
    }

    function getRoot() external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getSize() external view override returns (uint256) {
        return messageCount;
    }
}

contract MockTokenPortal is ITokenPortal {
    bool public depositCalled;
    uint256 public lastAmount;
    bytes32 public lastSecretHash;
    address public underlyingToken;

    function setUnderlying(
        address _underlying
    ) external {
        underlyingToken = _underlying;
    }

    function depositToAztecPublic(
        bytes32, /* _to */
        uint256 _amount,
        bytes32 _secretHash
    ) external returns (bytes32 messageKey, uint256 messageIndex) {
        depositCalled = true;
        lastAmount = _amount;
        lastSecretHash = _secretHash;
        return (keccak256("messageKey"), 0);
    }

    function depositToAztecPrivate(
        uint256 _amount,
        bytes32 _secretHashForL2MessageConsumption
    ) external returns (bytes32 messageKey, uint256 messageIndex) {
        depositCalled = true;
        lastAmount = _amount;
        lastSecretHash = _secretHashForL2MessageConsumption;
        return (keccak256("messageKey"), 0);
    }

    function underlying() external view returns (address) {
        return underlyingToken;
    }

    function withdraw(uint256 _amount, address _recipient) external {
        // Transfer tokens from this mock to the recipient
        if (underlyingToken != address(0)) {
            MockERC20(underlyingToken).transfer(_recipient, _amount);
        }
    }
}

/**
 * @title MockAaveLendingPool
 * @notice Mock Aave lending pool that properly mints aTokens on supply
 */
contract MockAaveLendingPool is ILendingPool {
    address public underlyingToken;
    address public aTokenAddress;
    bool public failSupply;
    bool public failWithdraw;

    mapping(address => uint256) public deposits;

    constructor(address _underlyingToken, address _aTokenAddress) {
        underlyingToken = _underlyingToken;
        aTokenAddress = _aTokenAddress;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(!failSupply, "MockLendingPool: supply failed");
        require(asset == underlyingToken, "Wrong asset");

        // Transfer underlying tokens from caller to this pool
        MockERC20(asset).transferFrom(msg.sender, address(this), amount);

        // Mint aTokens to the onBehalfOf address (1:1 for simplicity)
        MockERC20(aTokenAddress).mint(onBehalfOf, amount);

        deposits[onBehalfOf] += amount;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(!failWithdraw, "MockLendingPool: withdraw failed");
        require(asset == underlyingToken, "Wrong asset");
        require(deposits[msg.sender] >= amount, "Insufficient balance");

        deposits[msg.sender] -= amount;

        // Burn aTokens from caller
        MockERC20(aTokenAddress).burn(msg.sender, amount);

        // Transfer underlying tokens to recipient
        MockERC20(asset).transfer(to, amount);

        return amount;
    }

    function getUserAccountData(
        address
    ) external pure returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (0, 0, 0, 0, 0, type(uint256).max);
    }

    function getReserveNormalizedIncome(
        address
    ) external pure returns (uint256) {
        return 1e27; // RAY = 1.0
    }

    function getReserveData(
        address
    )
        external
        view
        returns (
            uint256,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint40,
            uint16,
            address,
            address,
            address,
            address,
            uint128,
            uint128,
            uint128
        )
    {
        return (0, 0, 0, 0, 0, 0, 0, 0, aTokenAddress, address(0), address(0), address(0), 0, 0, 0);
    }

    // Test helpers
    function setFailSupply(
        bool fail
    ) external {
        failSupply = fail;
    }

    function setFailWithdraw(
        bool fail
    ) external {
        failWithdraw = fail;
    }

    function setDeposits(address user, uint256 amount) external {
        deposits[user] = amount;
    }
}
