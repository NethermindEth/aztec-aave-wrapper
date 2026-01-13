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
 * @title ExecutorRetryTest
 * @notice Test suite for AaveExecutorTarget retry functionality
 * @dev Tests retryFailedOperation with various scenarios
 */
contract ExecutorRetryTest is Test {
    AaveExecutorTarget public executor;
    MockWormholeCore public wormhole;
    MockLendingPool public aavePool;
    MockERC20 public token6;

    // Test constants
    uint16 public constant SOURCE_CHAIN_ID = 2; // Ethereum
    bytes32 public l1PortalAddress;
    bytes32 public testOwnerHash = keccak256("test.aztec.user");
    bytes32 public testIntentId = keccak256("test.intent.1");

    address public originalCaller;
    address public otherCaller;

    function setUp() public {
        // Set up test addresses
        originalCaller = makeAddr("originalCaller");
        otherCaller = makeAddr("otherCaller");

        // Deploy mocks
        wormhole = new MockWormholeCore(23); // Target chain (Arbitrum)
        aavePool = new MockLendingPool();
        token6 = new MockERC20("Test USDC", "tUSDC", 6);

        // Set L1 portal address
        l1PortalAddress = bytes32(uint256(uint160(makeAddr("l1Portal"))));

        // Deploy executor
        executor = new AaveExecutorTarget(address(aavePool), address(wormhole), l1PortalAddress, SOURCE_CHAIN_ID);

        // Mint tokens to executor for testing supply operations
        token6.mint(address(executor), 1_000_000e6);
    }

    // ============ Retry Success Tests ============

    function test_retry_success() public {
        // Step 1: Create a failed operation
        _createFailedDeposit(1000e6);

        // Step 2: Fix Aave (simulate conditions changed)
        aavePool.setFailSupply(false);

        // Step 3: Retry as original caller
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        // Verify deposit was tracked
        assertEq(executor.getDeposit(testIntentId, address(token6)), 1000e6);
        assertEq(executor.getIntentShares(testIntentId), 1000e6);

        // Verify Aave pool received the supply
        assertEq(aavePool.getDeposit(address(executor), address(token6)), 1000e6);

        // Verify queue was cleared
        assertEq(executor.queueLength(), 0);
        assertFalse(executor.isQueueIndexActive(0));
    }

    function test_retry_success_emitsEvents() public {
        // Create a failed operation
        _createFailedDeposit(1000e6);

        // Fix Aave
        aavePool.setFailSupply(false);

        // Expect DepositExecuted and OperationRetried events
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.DepositExecuted(testIntentId, testOwnerHash, address(token6), 1000e6, 1000e6);

        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.OperationRetried(0, testIntentId, 1);

        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.OperationRemoved(0, testIntentId);

        vm.prank(originalCaller);
        executor.retryFailedOperation(0);
    }

    function test_retry_success_afterMultipleFailures() public {
        // Create a failed operation
        _createFailedDeposit(1000e6);

        // Retry and fail again
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        // Verify retry count incremented
        FailedOperation memory failedOp = executor.getFailedOperation(0);
        assertEq(failedOp.retryCount, 1);

        // Retry and fail again
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        failedOp = executor.getFailedOperation(0);
        assertEq(failedOp.retryCount, 2);

        // Now fix Aave and retry successfully
        aavePool.setFailSupply(false);

        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        // Verify success
        assertEq(executor.getDeposit(testIntentId, address(token6)), 1000e6);
        assertEq(executor.queueLength(), 0);
    }

    // ============ Access Control Tests ============

    function test_retry_onlyOriginalCaller() public {
        // Create a failed operation as originalCaller
        _createFailedDeposit(1000e6);

        // Fix Aave
        aavePool.setFailSupply(false);

        // Try to retry as different caller - should fail
        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.NotOriginalCaller.selector, originalCaller, otherCaller)
        );
        vm.prank(otherCaller);
        executor.retryFailedOperation(0);

        // Verify operation still in queue
        assertTrue(executor.isQueueIndexActive(0));
        assertEq(executor.queueLength(), 1);
    }

    function test_retry_onlyOriginalCaller_fuzz(address randomCaller) public {
        vm.assume(randomCaller != originalCaller);

        // Create a failed operation
        _createFailedDeposit(1000e6);

        // Fix Aave
        aavePool.setFailSupply(false);

        // Try to retry as random caller - should fail
        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.NotOriginalCaller.selector, originalCaller, randomCaller)
        );
        vm.prank(randomCaller);
        executor.retryFailedOperation(0);
    }

    function test_retry_inactiveQueueIndex() public {
        // Try to retry non-existent queue index
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.QueueIndexNotActive.selector, 0));
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);
    }

    function test_retry_alreadyRemoved() public {
        // Create a failed operation
        _createFailedDeposit(1000e6);

        // Fix Aave and retry successfully
        aavePool.setFailSupply(false);
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        // Try to retry again - should fail because already removed
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.QueueIndexNotActive.selector, 0));
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);
    }

    // ============ Retry Failure Tests ============

    function test_retry_failsAgain_updatesQueue() public {
        // Create a failed operation
        _createFailedDeposit(1000e6);
        uint256 initialFailedAt = executor.getFailedOperation(0).failedAt;

        // Advance time
        vm.warp(block.timestamp + 1 hours);

        // Retry (but Aave still fails)
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);

        // Verify operation still in queue with updated state
        assertTrue(executor.isQueueIndexActive(0));
        assertEq(executor.queueLength(), 1);

        FailedOperation memory failedOp = executor.getFailedOperation(0);
        assertEq(failedOp.retryCount, 1);
        assertGt(failedOp.failedAt, initialFailedAt);
        assertTrue(bytes(failedOp.errorReason).length > 0);
    }

    function test_retry_failsAgain_emitsQueuedEvent() public {
        // Create a failed operation
        _createFailedDeposit(1000e6);

        // Expect OperationQueued event with updated info
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.OperationQueued(
            0, testIntentId, OperationType.Deposit, address(token6), 1000e6, originalCaller
        );

        // Retry (but Aave still fails)
        vm.prank(originalCaller);
        executor.retryFailedOperation(0);
    }

    // ============ Multiple Queue Operations Tests ============

    function test_retry_multipleInQueue_retrySpecificIndex() public {
        // Create two failed operations
        _createFailedDeposit(1000e6);

        // Create second failed deposit with different intent
        aavePool.setFailSupply(true);
        DepositIntent memory intent2 = _createDepositIntent(address(token6), 2000e6, 6);
        intent2.intentId = keccak256("intent.2");
        bytes memory payload2 = IntentLib.encodeDepositIntent(intent2);
        bytes memory vaa2 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, payload2);

        vm.prank(originalCaller);
        executor.consumeAndExecuteDeposit(vaa2);

        // Verify both in queue
        assertEq(executor.queueLength(), 2);
        assertTrue(executor.isQueueIndexActive(0));
        assertTrue(executor.isQueueIndexActive(1));

        // Fix Aave and retry only the second one
        aavePool.setFailSupply(false);
        vm.prank(originalCaller);
        executor.retryFailedOperation(1);

        // Verify first still in queue, second removed
        assertEq(executor.queueLength(), 1);
        assertTrue(executor.isQueueIndexActive(0));
        assertFalse(executor.isQueueIndexActive(1));

        // Verify second deposit was tracked
        assertEq(executor.getDeposit(intent2.intentId, address(token6)), 2000e6);
    }

    // ============ Helper Functions ============

    function _createFailedDeposit(uint128 amount) internal {
        // Make Aave supply fail
        aavePool.setFailSupply(true);

        DepositIntent memory intent = _createDepositIntent(address(token6), amount, 6);
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Execute as original caller
        vm.prank(originalCaller);
        executor.consumeAndExecuteDeposit(vaa);

        // Verify operation was queued
        assertEq(executor.queueLength(), 1);
        assertTrue(executor.isQueueIndexActive(0));
    }

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
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256("random.salt")
        });
    }
}
