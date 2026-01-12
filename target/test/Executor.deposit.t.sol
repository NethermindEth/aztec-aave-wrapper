// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AaveExecutorTarget } from "../contracts/AaveExecutorTarget.sol";
import { MockWormholeCore } from "../contracts/mocks/MockWormholeCore.sol";
import { MockLendingPool } from "../contracts/mocks/MockLendingPool.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { DepositIntent, IntentLib } from "../contracts/types/Intent.sol";
import { FailedOperation, OperationType } from "../contracts/types/FailedOperation.sol";

/**
 * @title ExecutorDepositTest
 * @notice Test suite for AaveExecutorTarget deposit functionality
 * @dev Tests denormalization, retry queue, and Aave integration
 */
contract ExecutorDepositTest is Test {
    AaveExecutorTarget public executor;
    MockWormholeCore public wormhole;
    MockLendingPool public aavePool;
    MockERC20 public token6; // 6 decimals (like USDC)
    MockERC20 public token8; // 8 decimals (like WBTC)
    MockERC20 public token18; // 18 decimals (like DAI)

    // Test constants
    uint16 public constant SOURCE_CHAIN_ID = 2; // Ethereum
    bytes32 public l1PortalAddress;
    bytes32 public testOwnerHash = keccak256("test.aztec.user");
    bytes32 public testIntentId = keccak256("test.intent.1");

    function setUp() public {
        // Deploy mocks
        wormhole = new MockWormholeCore(23); // Target chain (Arbitrum)
        aavePool = new MockLendingPool();
        token6 = new MockERC20("Test USDC", "tUSDC", 6);
        token8 = new MockERC20("Test WBTC", "tWBTC", 8);
        token18 = new MockERC20("Test DAI", "tDAI", 18);

        // Set L1 portal address
        l1PortalAddress = bytes32(uint256(uint160(makeAddr("l1Portal"))));

        // Deploy executor
        executor = new AaveExecutorTarget(address(aavePool), address(wormhole), l1PortalAddress, SOURCE_CHAIN_ID);

        // Mint tokens to executor for testing supply operations
        token6.mint(address(executor), 1_000_000e6);
        token8.mint(address(executor), 100e8);
        token18.mint(address(executor), 1_000_000e18);
    }

    // ============ Deposit Success Tests ============

    function test_deposit_success() public {
        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Execute deposit
        executor.consumeAndExecuteDeposit(vaa);

        // Verify deposit tracked
        assertEq(executor.getDeposit(intent.intentId, intent.asset), 1000e6);

        // Verify intent shares tracked
        assertEq(executor.getIntentShares(intent.intentId), 1000e6);

        // Verify Aave pool received the supply
        assertEq(aavePool.getDeposit(address(executor), intent.asset), 1000e6);
    }

    function test_deposit_success_emitsEvent() public {
        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Expect DepositExecuted event with correct parameters
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.DepositExecuted(intent.intentId, intent.ownerHash, intent.asset, 1000e6, 1000e6);

        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_deposit_success_multipleDeposits() public {
        // First deposit
        DepositIntent memory intent1 = _createDepositIntent(address(token6), 1000e6, 6);
        intent1.intentId = keccak256("intent.1");
        bytes memory payload1 = IntentLib.encodeDepositIntent(intent1);
        bytes memory vaa1 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload1);

        // Second deposit
        DepositIntent memory intent2 = _createDepositIntent(address(token6), 2000e6, 6);
        intent2.intentId = keccak256("intent.2");
        bytes memory payload2 = IntentLib.encodeDepositIntent(intent2);
        bytes memory vaa2 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, payload2);

        // Execute both
        executor.consumeAndExecuteDeposit(vaa1);
        executor.consumeAndExecuteDeposit(vaa2);

        // Verify both deposits tracked separately
        assertEq(executor.getDeposit(intent1.intentId, intent1.asset), 1000e6);
        assertEq(executor.getDeposit(intent2.intentId, intent2.asset), 2000e6);

        // Verify intent shares tracked separately
        assertEq(executor.getIntentShares(intent1.intentId), 1000e6);
        assertEq(executor.getIntentShares(intent2.intentId), 2000e6);
    }

    // ============ Denormalization Tests ============

    function test_denormalization_6decimals() public {
        // 6 decimals <= 8, so no denormalization needed
        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // Amount should be unchanged (1000e6)
        assertEq(executor.getDeposit(intent.intentId, intent.asset), 1000e6);
        assertEq(aavePool.getDeposit(address(executor), intent.asset), 1000e6);
    }

    function test_denormalization_8decimals() public {
        // 8 decimals == Wormhole decimals, so no denormalization needed
        DepositIntent memory intent = _createDepositIntent(address(token8), 1e8, 8);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // Amount should be unchanged (1e8)
        assertEq(executor.getDeposit(intent.intentId, intent.asset), 1e8);
        assertEq(aavePool.getDeposit(address(executor), intent.asset), 1e8);
    }

    function test_denormalization_18decimals() public {
        // 18 decimals > 8, Wormhole would have normalized by dividing by 10^10
        // So we get a Wormhole-normalized amount and need to multiply by 10^10
        // If user wants to deposit 1000e18 DAI, Wormhole normalizes to 1000e8
        // We denormalize 1000e8 -> 1000e18

        uint128 wormholeNormalizedAmount = 1000e8; // 1000 DAI in Wormhole format

        DepositIntent memory intent = _createDepositIntent(address(token18), wormholeNormalizedAmount, 18);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // Amount should be denormalized to 1000e18
        uint256 expectedDenormalized = 1000e18;
        assertEq(executor.getDeposit(intent.intentId, intent.asset), expectedDenormalized);
        assertEq(aavePool.getDeposit(address(executor), intent.asset), expectedDenormalized);
        assertEq(executor.getIntentShares(intent.intentId), expectedDenormalized);
    }

    function test_denormalization_12decimals() public {
        // Create a 12-decimal token
        MockERC20 token12 = new MockERC20("Test Token", "T12", 12);
        token12.mint(address(executor), 1_000_000e12);

        // 12 decimals > 8, so denormalize by multiplying by 10^4
        // If Wormhole normalized amount is 1000e8, denormalized is 1000e12
        uint128 wormholeNormalizedAmount = 1000e8;

        DepositIntent memory intent = _createDepositIntent(address(token12), wormholeNormalizedAmount, 12);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // Amount should be denormalized to 1000e12
        uint256 expectedDenormalized = 1000e12;
        assertEq(executor.getDeposit(intent.intentId, intent.asset), expectedDenormalized);
        assertEq(executor.getIntentShares(intent.intentId), expectedDenormalized);
    }

    function testFuzz_denormalization(uint128 amount, uint8 decimals) public {
        // Bound decimals to reasonable range
        decimals = uint8(bound(decimals, 1, 18));

        // Bound amount to avoid overflow and ensure we have enough tokens
        // For high decimals, the denormalized amount can be very large
        if (decimals > 8) {
            // Max amount that won't overflow when multiplied by 10^(decimals-8)
            uint256 maxAmount = type(uint128).max / (10 ** (decimals - 8));
            amount = uint128(bound(amount, 1, maxAmount));
        } else {
            amount = uint128(bound(amount, 1, type(uint128).max));
        }

        // Create token with specified decimals
        MockERC20 token = new MockERC20("Test", "TST", decimals);

        // Calculate expected denormalized amount
        uint256 expectedAmount;
        if (decimals <= 8) {
            expectedAmount = uint256(amount);
        } else {
            expectedAmount = uint256(amount) * (10 ** (decimals - 8));
        }

        // Mint enough tokens
        token.mint(address(executor), expectedAmount);

        DepositIntent memory intent = _createDepositIntent(address(token), amount, decimals);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        assertEq(executor.getDeposit(intent.intentId, intent.asset), expectedAmount);
        assertEq(executor.getIntentShares(intent.intentId), expectedAmount);
    }

    // ============ Aave Revert -> Retry Queue Tests ============

    function test_deposit_aaveRevert_queued() public {
        // Make Aave supply fail
        aavePool.setFailSupply(true);

        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Expect OperationQueued event
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.OperationQueued(
            0, // First queue index
            intent.intentId,
            OperationType.Deposit,
            intent.asset,
            1000e6,
            address(this)
        );

        executor.consumeAndExecuteDeposit(vaa);

        // Verify operation was NOT tracked as deposit (since it failed)
        assertEq(executor.getDeposit(intent.intentId, intent.asset), 0);
        assertEq(executor.getIntentShares(intent.intentId), 0);

        // Verify it was added to retry queue
        assertEq(executor.queueLength(), 1);
        assertEq(executor.nextQueueIndex(), 1);
        assertTrue(executor.isQueueIndexActive(0));

        // Verify failed operation details
        FailedOperation memory failedOp = executor.getFailedOperation(0);
        assertEq(uint8(failedOp.operationType), uint8(OperationType.Deposit));
        assertEq(failedOp.intentId, intent.intentId);
        assertEq(failedOp.ownerHash, intent.ownerHash);
        assertEq(failedOp.asset, intent.asset);
        assertEq(failedOp.amount, 1000e6);
        assertEq(failedOp.retryCount, 0);
        assertEq(failedOp.originalCaller, address(this));
        assertTrue(bytes(failedOp.errorReason).length > 0);
    }

    function test_deposit_aaveRevert_multipleQueued() public {
        // Make Aave supply fail
        aavePool.setFailSupply(true);

        // First deposit
        DepositIntent memory intent1 = _createDepositIntent(address(token6), 1000e6, 6);
        intent1.intentId = keccak256("intent.1");
        bytes memory payload1 = IntentLib.encodeDepositIntent(intent1);
        bytes memory vaa1 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload1);

        // Second deposit
        DepositIntent memory intent2 = _createDepositIntent(address(token6), 2000e6, 6);
        intent2.intentId = keccak256("intent.2");
        bytes memory payload2 = IntentLib.encodeDepositIntent(intent2);
        bytes memory vaa2 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, payload2);

        executor.consumeAndExecuteDeposit(vaa1);
        executor.consumeAndExecuteDeposit(vaa2);

        // Verify both were queued
        assertEq(executor.queueLength(), 2);
        assertEq(executor.nextQueueIndex(), 2);

        // Verify queue indices
        assertTrue(executor.isQueueIndexActive(0));
        assertTrue(executor.isQueueIndexActive(1));

        // Verify failed operation details
        FailedOperation memory failedOp1 = executor.getFailedOperation(0);
        assertEq(failedOp1.intentId, intent1.intentId);
        assertEq(failedOp1.amount, 1000e6);

        FailedOperation memory failedOp2 = executor.getFailedOperation(1);
        assertEq(failedOp2.intentId, intent2.intentId);
        assertEq(failedOp2.amount, 2000e6);
    }

    function test_deposit_aaveRevert_vaaStillConsumed() public {
        // Make Aave supply fail
        aavePool.setFailSupply(true);

        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // VAA should still be marked as consumed (replay protection)
        bytes32 vaaHash = keccak256(vaa);
        assertTrue(executor.isVAAConsumed(vaaHash));

        // Trying to use the same VAA again should fail
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.VAAAlreadyConsumed.selector, vaaHash));
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_deposit_aaveRevert_denormalizedAmountQueued() public {
        // Make Aave supply fail
        aavePool.setFailSupply(true);

        // Use 18-decimal token to test denormalization is applied before queuing
        uint128 wormholeNormalizedAmount = 1000e8;
        DepositIntent memory intent = _createDepositIntent(address(token18), wormholeNormalizedAmount, 18);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        executor.consumeAndExecuteDeposit(vaa);

        // Verify the denormalized amount was queued (not the Wormhole-normalized amount)
        FailedOperation memory failedOp = executor.getFailedOperation(0);
        assertEq(failedOp.amount, 1000e18); // Denormalized
    }

    // ============ Edge Cases ============

    function test_deposit_exactDeadline() public {
        // Test that execution at exact deadline succeeds (boundary condition)
        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        intent.deadline = uint64(block.timestamp); // Exact deadline
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Should succeed at exact deadline
        executor.consumeAndExecuteDeposit(vaa);

        // Verify deposit was tracked
        assertEq(executor.getDeposit(intent.intentId, intent.asset), 1000e6);
    }

    function test_deposit_deadlinePassed() public {
        DepositIntent memory intent = _createDepositIntent(address(token6), 1000e6, 6);
        intent.deadline = uint64(block.timestamp - 1); // Past deadline
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.DeadlinePassed.selector, intent.deadline, block.timestamp)
        );
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_deposit_zeroAmount() public {
        DepositIntent memory intent = _createDepositIntent(address(token6), 0, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(AaveExecutorTarget.ZeroAmount.selector);
        executor.consumeAndExecuteDeposit(vaa);
    }

    // ============ Helper Functions ============

    function _createDepositIntent(address asset, uint128 amount, uint8 originalDecimals)
        internal
        view
        returns (DepositIntent memory)
    {
        return DepositIntent({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            asset: asset,
            amount: amount,
            originalDecimals: originalDecimals,
            targetChainId: 23, // Arbitrum
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256("random.salt")
        });
    }
}
