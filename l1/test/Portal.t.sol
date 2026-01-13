// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { DepositIntent, WithdrawIntent, IntentLib } from "../contracts/types/Intent.sol";

/**
 * @title PortalTest
 * @notice Unit tests for AztecAavePortalL1 contract
 */
contract PortalTest is Test {
    AztecAavePortalL1 public portal;

    // Mock addresses
    address public aztecOutbox = makeAddr("aztecOutbox");
    address public aztecInbox = makeAddr("aztecInbox");
    address public tokenPortal = makeAddr("tokenPortal");
    address public wormholeTokenBridge = makeAddr("wormholeTokenBridge");
    address public wormholeRelayer = makeAddr("wormholeRelayer");
    bytes32 public l2ContractAddress = bytes32(uint256(1));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(2));

    function setUp() public {
        portal = new AztecAavePortalL1(
            aztecOutbox,
            aztecInbox,
            tokenPortal,
            wormholeTokenBridge,
            wormholeRelayer,
            l2ContractAddress,
            targetChainId,
            targetExecutor,
            address(this) // Initial owner
        );
    }

    function test_Constructor() public view {
        assertEq(portal.aztecOutbox(), aztecOutbox);
        assertEq(portal.aztecInbox(), aztecInbox);
        assertEq(portal.tokenPortal(), tokenPortal);
        assertEq(portal.wormholeTokenBridge(), wormholeTokenBridge);
        assertEq(portal.wormholeRelayer(), wormholeRelayer);
        assertEq(portal.l2ContractAddress(), l2ContractAddress);
        assertEq(portal.targetChainId(), targetChainId);
        assertEq(portal.targetExecutor(), targetExecutor);
    }

    function test_ConsumedIntentsInitiallyFalse() public view {
        bytes32 intentId = keccak256("test_intent");
        assertFalse(portal.consumedIntents(intentId));
    }

    function test_intentEncoding_DepositIntent() public pure {
        // Create a deposit intent with test data
        DepositIntent memory intent = DepositIntent({
            intentId: bytes32(uint256(0x1234567890abcdef)),
            ownerHash: bytes32(uint256(0xfedcba0987654321)),
            asset: address(0x1234567890123456789012345678901234567890),
            amount: 1_000_000,
            originalDecimals: 18,
            deadline: 1_700_000_000,
            salt: bytes32(uint256(0xabcdef1234567890))
        });

        // Encode the intent
        bytes memory encoded = IntentLib.encodeDepositIntent(intent);

        // Decode the intent
        DepositIntent memory decoded = IntentLib.decodeDepositIntent(encoded);

        // Verify all fields match
        assertEq(decoded.intentId, intent.intentId);
        assertEq(decoded.ownerHash, intent.ownerHash);
        assertEq(decoded.asset, intent.asset);
        assertEq(decoded.amount, intent.amount);
        assertEq(decoded.originalDecimals, intent.originalDecimals);
        assertEq(decoded.deadline, intent.deadline);
        assertEq(decoded.salt, intent.salt);
    }

    function test_intentEncoding_WithdrawIntent() public pure {
        // Create a withdraw intent with test data
        WithdrawIntent memory intent = WithdrawIntent({
            intentId: bytes32(uint256(0x1234567890abcdef)),
            ownerHash: bytes32(uint256(0xfedcba0987654321)),
            amount: 1_000_000,
            deadline: 1_700_000_000
        });

        // Encode the intent
        bytes memory encoded = IntentLib.encodeWithdrawIntent(intent);

        // Decode the intent
        WithdrawIntent memory decoded = IntentLib.decodeWithdrawIntent(encoded);

        // Verify all fields match
        assertEq(decoded.intentId, intent.intentId);
        assertEq(decoded.ownerHash, intent.ownerHash);
        assertEq(decoded.amount, intent.amount);
        assertEq(decoded.deadline, intent.deadline);
    }

    function test_intentEncoding_OwnerHashPreservesPrivacy() public pure {
        // Verify that ownerHash is used instead of a plain owner address
        DepositIntent memory intent = DepositIntent({
            intentId: bytes32(uint256(1)),
            ownerHash: keccak256(abi.encode(address(0x123))), // Hash of L2 owner
            asset: address(0x456),
            amount: 1000,
            originalDecimals: 18,
            deadline: 1_700_000_000,
            salt: bytes32(uint256(42))
        });

        bytes memory encoded = IntentLib.encodeDepositIntent(intent);
        DepositIntent memory decoded = IntentLib.decodeDepositIntent(encoded);

        // The ownerHash should be preserved, not a plain address
        assertEq(decoded.ownerHash, intent.ownerHash);
        // Verify it's actually a hash, not just the owner address
        assertTrue(decoded.ownerHash != bytes32(uint256(uint160(address(0x123)))));
    }

    function test_validateDeadline_ValidDeadline() public view {
        // Test with a valid deadline (1 hour from now)
        uint256 validDeadline = block.timestamp + 1 hours;
        // This should not revert
        portal._validateDeadline(validDeadline);
    }

    function test_validateDeadline_MinDeadline() public view {
        // Test with exactly minimum deadline (5 minutes)
        uint256 minDeadline = block.timestamp + portal.MIN_DEADLINE();
        // This should not revert
        portal._validateDeadline(minDeadline);
    }

    function test_validateDeadline_MaxDeadline() public view {
        // Test with exactly maximum deadline (24 hours)
        uint256 maxDeadline = block.timestamp + portal.MAX_DEADLINE();
        // This should not revert
        portal._validateDeadline(maxDeadline);
    }

    function test_validateDeadline_TooSoon() public {
        // Test with deadline less than minimum (4 minutes)
        uint256 tooSoonDeadline = block.timestamp + 4 minutes;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, tooSoonDeadline)
        );
        portal._validateDeadline(tooSoonDeadline);
    }

    function test_validateDeadline_OneSecondBeforeMin() public {
        // Test with deadline exactly 1 second before minimum (edge case)
        uint256 almostMinDeadline = block.timestamp + portal.MIN_DEADLINE() - 1;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, almostMinDeadline)
        );
        portal._validateDeadline(almostMinDeadline);
    }

    function test_validateDeadline_OneSecondAfterMax() public {
        // Test with deadline exactly 1 second after maximum (edge case)
        uint256 justOverMaxDeadline = block.timestamp + portal.MAX_DEADLINE() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, justOverMaxDeadline)
        );
        portal._validateDeadline(justOverMaxDeadline);
    }

    function test_validateDeadline_TooFar() public {
        // Test with deadline greater than maximum (25 hours)
        uint256 tooFarDeadline = block.timestamp + 25 hours;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, tooFarDeadline)
        );
        portal._validateDeadline(tooFarDeadline);
    }

    function test_validateDeadline_InPast() public {
        // Test with deadline in the past (treated as 0 time until deadline)
        // Warp to a future time first to avoid underflow
        vm.warp(1000 days);
        uint256 pastDeadline = block.timestamp - 1 hours;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, pastDeadline)
        );
        portal._validateDeadline(pastDeadline);
    }

    function test_validateDeadline_AtCurrentTime() public {
        // Test with deadline at current time (0 time until deadline)
        uint256 currentDeadline = block.timestamp;
        vm.expectRevert(
            abi.encodeWithSelector(AztecAavePortalL1.InvalidDeadline.selector, currentDeadline)
        );
        portal._validateDeadline(currentDeadline);
    }

    // TODO: Add tests for executeDeposit
    // TODO: Add tests for executeWithdraw
    // TODO: Add tests for receiveWormholeMessages
    // TODO: Add tests for completeTransferWithPayload
}
