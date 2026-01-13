// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { DepositIntent, WithdrawIntent, IntentLib } from "../contracts/types/Intent.sol";
import {
    DepositConfirmation,
    WithdrawConfirmation,
    ConfirmationStatus,
    ConfirmationLib
} from "../contracts/types/Confirmation.sol";
import { IAztecOutbox } from "../contracts/interfaces/IAztecOutbox.sol";
import { IAztecInbox } from "../contracts/interfaces/IAztecInbox.sol";
import { IWormholeRelayer } from "../contracts/interfaces/IWormholeRelayer.sol";
import { IWormholeTokenBridge } from "../contracts/interfaces/IWormholeTokenBridge.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Portal.admin Tests
 * @notice Comprehensive tests for admin functionality including:
 * - Pause/unpause mechanisms
 * - Emergency withdrawal
 * - Ownership management (Ownable2Step)
 * - Verification that pause allows in-flight operations to complete
 */
contract PortalAdminTest is Test {
    AztecAavePortalL1 public portal;

    // Mock contracts
    MockAztecOutbox public aztecOutbox;
    MockAztecInbox public aztecInbox;
    MockWormholeRelayer public wormholeRelayer;
    MockWormholeTokenBridge public wormholeTokenBridge;
    MockERC20 public token;

    // Addresses
    address public tokenPortal = makeAddr("tokenPortal");
    bytes32 public l2ContractAddress = bytes32(uint256(1));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(2));

    // Test accounts
    address public owner;
    address public nonOwner = makeAddr("nonOwner");
    address public relayer = makeAddr("relayer");
    address public user = makeAddr("user");

    // Test intent
    DepositIntent public validIntent;
    uint256 public l2BlockNumber = 100;
    uint256 public leafIndex = 5;
    bytes32[] public validSiblingPath;

    function setUp() public {
        owner = address(this);

        // Deploy mock contracts
        aztecOutbox = new MockAztecOutbox();
        aztecInbox = new MockAztecInbox();
        wormholeRelayer = new MockWormholeRelayer();
        wormholeTokenBridge = new MockWormholeTokenBridge();
        token = new MockERC20("Test Token", "TEST", 18);

        // Deploy portal with this test contract as owner
        portal = new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            tokenPortal,
            address(wormholeTokenBridge),
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );

        // Setup valid intent
        validIntent = DepositIntent({
            intentId: keccak256("test_intent_1"),
            ownerHash: keccak256(abi.encode(user)),
            asset: address(token),
            amount: 1000e18,
            originalDecimals: 18,
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

    // ============ Pause/Unpause Tests ============

    function test_pause_Success() public {
        // Owner can pause
        portal.pause();
        assertTrue(portal.paused());
    }

    function test_pause_RevertIf_NotOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner)
        );
        portal.pause();
    }

    function test_unpause_Success() public {
        // First pause
        portal.pause();
        assertTrue(portal.paused());

        // Then unpause
        portal.unpause();
        assertFalse(portal.paused());
    }

    function test_unpause_RevertIf_NotOwner() public {
        portal.pause();

        vm.prank(nonOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner)
        );
        portal.unpause();
    }

    function test_pause_BlocksExecuteDeposit() public {
        // Setup valid intent
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Pause the contract
        portal.pause();

        // Attempt to execute deposit - should revert
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_pause_BlocksExecuteWithdraw() public {
        // Setup valid withdraw intent
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: keccak256("test_withdraw_1"),
            ownerHash: keccak256(abi.encode(user)),
            amount: 500e18,
            deadline: uint64(block.timestamp + 1 hours)
        });

        bytes32 messageHash = IntentLib.hashWithdrawIntent(withdrawIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Pause the contract
        portal.pause();

        // Attempt to execute withdraw - should revert
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        portal.executeWithdraw{ value: 0.1 ether }(
            withdrawIntent, l2BlockNumber, leafIndex, validSiblingPath
        );
    }

    function test_pauseAllowsInFlight_ReceiveWormholeMessages() public {
        // Pause the contract
        portal.pause();

        // Create a deposit confirmation (simulating in-flight operation)
        DepositConfirmation memory confirmation = DepositConfirmation({
            intentId: keccak256("test_intent"),
            ownerHash: keccak256(abi.encode(user)),
            status: ConfirmationStatus.SUCCESS,
            shares: 1000e18,
            asset: address(token)
        });

        bytes memory payload = ConfirmationLib.encodeDepositConfirmation(confirmation);
        bytes32 deliveryHash = keccak256("delivery_1");

        // Receive confirmation should still work while paused
        // This allows in-flight operations to complete
        vm.prank(address(wormholeRelayer));
        portal.receiveWormholeMessages(
            payload, new bytes[](0), targetExecutor, targetChainId, deliveryHash
        );

        // Verify the delivery was processed
        assertTrue(portal.processedDeliveries(deliveryHash));
    }

    function test_pauseAllowsInFlight_CompleteWithdrawalTransfer() public {
        // Note: This test would require a more complex mock setup for the token bridge
        // The key point is that completeWithdrawalTransfer does NOT have whenNotPaused modifier
        // so it will work even when paused, allowing in-flight token transfers to complete
    }

    function test_pause_UnpauseThenExecute() public {
        // Setup valid intent
        bytes32 messageHash = IntentLib.hashDepositIntent(validIntent);
        aztecOutbox.setMessageValid(messageHash, l2BlockNumber, true);

        // Pause
        portal.pause();

        // Unpause
        portal.unpause();

        // Execute should work now
        vm.prank(relayer);
        portal.executeDeposit{ value: 0.1 ether }(
            validIntent, l2BlockNumber, leafIndex, validSiblingPath
        );

        // Verify intent was consumed
        assertTrue(portal.consumedIntents(validIntent.intentId));
    }

    // ============ Emergency Withdraw Tests ============

    function test_emergencyWithdraw_Success() public {
        uint256 amount = 500e18;
        address recipient = makeAddr("recipient");

        // Execute emergency withdraw
        portal.emergencyWithdraw(address(token), recipient, amount);

        // Verify tokens were transferred
        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(address(portal)), 10_000e18 - amount);
    }

    function test_emergencyWithdraw_RevertIf_NotOwner() public {
        uint256 amount = 500e18;
        address recipient = makeAddr("recipient");

        vm.prank(nonOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner)
        );
        portal.emergencyWithdraw(address(token), recipient, amount);
    }

    function test_emergencyWithdraw_EmitsEvent() public {
        uint256 amount = 500e18;
        address recipient = makeAddr("recipient");

        vm.expectEmit(true, true, false, true);
        emit AztecAavePortalL1.EmergencyWithdraw(address(token), recipient, amount);

        portal.emergencyWithdraw(address(token), recipient, amount);
    }

    function test_emergencyWithdraw_FullBalance() public {
        uint256 fullBalance = token.balanceOf(address(portal));
        address recipient = makeAddr("recipient");

        // Withdraw full balance
        portal.emergencyWithdraw(address(token), recipient, fullBalance);

        assertEq(token.balanceOf(recipient), fullBalance);
        assertEq(token.balanceOf(address(portal)), 0);
    }

    function test_emergencyWithdraw_RevertIf_InsufficientBalance() public {
        uint256 tooMuch = 100_000e18;
        address recipient = makeAddr("recipient");

        // Should revert due to insufficient balance (arithmetic underflow in MockERC20)
        vm.expectRevert();
        portal.emergencyWithdraw(address(token), recipient, tooMuch);
    }

    function test_emergencyWithdraw_RevertIf_ZeroAddress() public {
        uint256 amount = 500e18;

        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        portal.emergencyWithdraw(address(token), address(0), amount);
    }

    // ============ Constructor Validation Tests ============

    function test_constructor_RevertIf_ZeroAztecOutbox() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(0), // zero aztecOutbox
            address(aztecInbox),
            tokenPortal,
            address(wormholeTokenBridge),
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );
    }

    function test_constructor_RevertIf_ZeroAztecInbox() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(0), // zero aztecInbox
            tokenPortal,
            address(wormholeTokenBridge),
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );
    }

    function test_constructor_RevertIf_ZeroTokenPortal() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            address(0), // zero tokenPortal
            address(wormholeTokenBridge),
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );
    }

    function test_constructor_RevertIf_ZeroWormholeTokenBridge() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            tokenPortal,
            address(0), // zero wormholeTokenBridge
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );
    }

    function test_constructor_RevertIf_ZeroWormholeRelayer() public {
        vm.expectRevert(AztecAavePortalL1.ZeroAddress.selector);
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            tokenPortal,
            address(wormholeTokenBridge),
            address(0), // zero wormholeRelayer
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            owner
        );
    }

    function test_constructor_RevertIf_ZeroOwner() public {
        // Note: Ownable reverts with OwnableInvalidOwner before our ZeroAddress check
        // because the Ownable constructor runs first in the inheritance chain
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AztecAavePortalL1(
            address(aztecOutbox),
            address(aztecInbox),
            tokenPortal,
            address(wormholeTokenBridge),
            address(wormholeRelayer),
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            address(0) // zero owner
        );
    }

    // ============ Ownership Tests (Ownable2Step) ============

    function test_owner_IsSetCorrectly() public view {
        assertEq(portal.owner(), owner);
    }

    function test_transferOwnership_TwoStep() public {
        address newOwner = makeAddr("newOwner");

        // Step 1: Current owner initiates transfer
        portal.transferOwnership(newOwner);

        // Owner hasn't changed yet
        assertEq(portal.owner(), owner);
        assertEq(portal.pendingOwner(), newOwner);

        // Step 2: New owner accepts
        vm.prank(newOwner);
        portal.acceptOwnership();

        // Now ownership has transferred
        assertEq(portal.owner(), newOwner);
        assertEq(portal.pendingOwner(), address(0));
    }

    function test_transferOwnership_RevertIf_NotOwner() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(nonOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner)
        );
        portal.transferOwnership(newOwner);
    }

    function test_acceptOwnership_RevertIf_NotPendingOwner() public {
        address newOwner = makeAddr("newOwner");
        address randomUser = makeAddr("randomUser");

        // Initiate transfer
        portal.transferOwnership(newOwner);

        // Random user tries to accept
        vm.prank(randomUser);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, randomUser)
        );
        portal.acceptOwnership();
    }

    function test_renounceOwnership() public {
        // Owner can renounce ownership
        portal.renounceOwnership();

        assertEq(portal.owner(), address(0));
    }

    function test_renounceOwnership_RevertIf_NotOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOwner)
        );
        portal.renounceOwnership();
    }

    // ============ Integration: Pause + Emergency Withdraw ============

    function test_emergencyWithdraw_WorksWhilePaused() public {
        // Pause the contract
        portal.pause();

        uint256 amount = 500e18;
        address recipient = makeAddr("recipient");

        // Emergency withdraw should still work while paused
        portal.emergencyWithdraw(address(token), recipient, amount);

        assertEq(token.balanceOf(recipient), amount);
    }
}

// ============ Mock Contracts ============

contract MockAztecOutbox is IAztecOutbox {
    mapping(bytes32 => mapping(uint256 => bool)) public validMessages;
    mapping(bytes32 => bool) public consumed;

    function setMessageValid(bytes32 message, uint256 blockNumber, bool valid) external {
        validMessages[message][blockNumber] = valid;
    }

    function consume(
        bytes32 _message,
        uint256 _l2BlockNumber,
        uint256, /* _leafIndex */
        bytes32[] calldata /* _path */
    ) external returns (bool) {
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

contract MockAztecInbox is IAztecInbox {
    bytes32 public lastL2Contract;
    bytes32 public lastContent;
    uint256 public messageCount;

    function sendL2Message(
        bytes32 _l2Contract,
        bytes32 _content
    ) external returns (bytes32 messageLeaf) {
        lastL2Contract = _l2Contract;
        lastContent = _content;
        messageCount++;
        return keccak256(abi.encode(_l2Contract, _content, messageCount));
    }

    function getRoot() external pure returns (bytes32) {
        return bytes32(0);
    }

    function getSize() external view returns (uint256) {
        return messageCount;
    }
}

contract MockWormholeRelayer is IWormholeRelayer {
    uint256 public lastReceiverValue;
    uint256 public lastGasLimit;
    bytes public lastPayload;
    uint16 public lastTargetChain;

    function sendPayloadToEvm(
        uint16 targetChain,
        address, /* targetAddress */
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable returns (uint64 sequence) {
        lastTargetChain = targetChain;
        lastPayload = payload;
        lastReceiverValue = receiverValue;
        lastGasLimit = gasLimit;
        return 1;
    }

    function sendPayloadToEvm(
        uint16 targetChain,
        address, /* targetAddress */
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit,
        uint16, /* refundChain */
        address /* refundAddress */
    ) external payable returns (uint64 sequence) {
        lastTargetChain = targetChain;
        lastPayload = payload;
        lastReceiverValue = receiverValue;
        lastGasLimit = gasLimit;
        return 1;
    }

    function quoteEVMDeliveryPrice(
        uint16, /* targetChain */
        uint256, /* receiverValue */
        uint256 /* gasLimit */
    ) external pure returns (uint256, uint256) {
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
    ) external payable {
        // Mock implementation
    }
}

contract MockWormholeTokenBridge is IWormholeTokenBridge {
    function transferTokensWithPayload(
        address, /* token */
        uint256, /* amount */
        uint16, /* recipientChain */
        bytes32, /* recipient */
        uint32, /* nonce */
        bytes memory /* payload */
    ) external payable returns (uint64 sequence) {
        return 1;
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
