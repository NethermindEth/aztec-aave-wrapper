// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test, console2} from "forge-std/Test.sol";
import {AaveExecutorTarget} from "../contracts/AaveExecutorTarget.sol";
import {MockWormholeCore} from "../contracts/mocks/MockWormholeCore.sol";
import {MockLendingPool} from "../contracts/mocks/MockLendingPool.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {DepositIntent, WithdrawIntent, IntentLib} from "../contracts/types/Intent.sol";
import {WormholeParser} from "../contracts/libraries/WormholeParser.sol";

/**
 * @title ExecutorTest
 * @notice Test suite for AaveExecutorTarget contract
 * @dev Tests VAA verification, replay protection, and emitter validation
 */
contract ExecutorTest is Test {
    AaveExecutorTarget public executor;
    MockWormholeCore public wormhole;
    MockLendingPool public aavePool;
    MockERC20 public token;

    // Test constants
    uint16 public constant SOURCE_CHAIN_ID = 2; // Ethereum
    bytes32 public l1PortalAddress;
    bytes32 public testOwnerHash = keccak256("test.aztec.user");
    bytes32 public testIntentId = keccak256("test.intent.1");

    function setUp() public {
        // Deploy mocks
        wormhole = new MockWormholeCore(23); // Target chain (Arbitrum)
        aavePool = new MockLendingPool();
        token = new MockERC20("Test USDC", "tUSDC", 6);

        // Set L1 portal address
        l1PortalAddress = bytes32(uint256(uint160(makeAddr("l1Portal"))));

        // Deploy executor
        executor = new AaveExecutorTarget(
            address(aavePool),
            address(wormhole),
            l1PortalAddress,
            SOURCE_CHAIN_ID
        );

        // Mint tokens to executor for testing supply operations
        token.mint(address(executor), 1000000e6);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(address(executor.aavePool()), address(aavePool));
        assertEq(address(executor.wormhole()), address(wormhole));
        assertEq(executor.l1PortalAddress(), l1PortalAddress);
        assertEq(executor.sourceChainId(), SOURCE_CHAIN_ID);
    }

    // ============ VAA Verification Tests ============

    function test_vaaVerification_validVAA() public {
        // Create a valid deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);

        // Encode a valid VAA
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Execute should succeed
        executor.consumeAndExecuteDeposit(vaa);

        // Verify deposit was tracked
        assertEq(executor.getDeposit(intent.intentId, intent.asset), intent.amount);
    }

    function test_vaaVerification_invalidVAA() public {
        // Configure wormhole to reject VAAs
        wormhole.setRejectAllVAAs(true, "Invalid guardian signatures");

        // Create a deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Should revert with InvalidVAA
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.InvalidVAA.selector, "Invalid guardian signatures"));
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_vaaVerification_wrongEmitterChain() public {
        // Create a deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);

        // Use wrong chain ID
        uint16 wrongChainId = 4; // BSC
        bytes memory vaa = wormhole.encodeMockVAA(wrongChainId, l1PortalAddress, 1, payload);

        // Should revert with InvalidEmitterChain
        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.InvalidEmitterChain.selector, SOURCE_CHAIN_ID, wrongChainId)
        );
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_vaaVerification_wrongEmitterAddress() public {
        // Create a deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);

        // Use wrong emitter address
        bytes32 wrongEmitter = bytes32(uint256(uint160(makeAddr("wrongEmitter"))));
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, wrongEmitter, 1, payload);

        // Should revert with InvalidEmitterAddress
        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.InvalidEmitterAddress.selector, l1PortalAddress, wrongEmitter)
        );
        executor.consumeAndExecuteDeposit(vaa);
    }

    // ============ Replay Protection Tests ============

    function test_replayProtection_sameVAAReplay() public {
        // Create a valid deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // First execution should succeed
        executor.consumeAndExecuteDeposit(vaa);

        // Compute VAA hash
        bytes32 vaaHash = WormholeParser.computeVAAHash(vaa);

        // Second execution with same VAA should fail
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.VAAAlreadyConsumed.selector, vaaHash));
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_replayProtection_differentVAAs() public {
        // Create first deposit intent
        DepositIntent memory intent1 = _createDepositIntent();
        intent1.intentId = keccak256("intent.1");
        bytes memory payload1 = IntentLib.encodeDepositIntent(intent1);
        bytes memory vaa1 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload1);

        // Create second deposit intent
        DepositIntent memory intent2 = _createDepositIntent();
        intent2.intentId = keccak256("intent.2");
        bytes memory payload2 = IntentLib.encodeDepositIntent(intent2);
        bytes memory vaa2 = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, payload2);

        // Both should succeed
        executor.consumeAndExecuteDeposit(vaa1);
        executor.consumeAndExecuteDeposit(vaa2);

        // Verify both deposits were tracked
        assertEq(executor.getDeposit(intent1.intentId, intent1.asset), intent1.amount);
        assertEq(executor.getDeposit(intent2.intentId, intent2.asset), intent2.amount);
    }

    function test_replayProtection_isVAAConsumed() public {
        // Create a valid deposit intent
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        bytes32 vaaHash = WormholeParser.computeVAAHash(vaa);

        // Before consumption
        assertFalse(executor.isVAAConsumed(vaaHash));

        // Execute
        executor.consumeAndExecuteDeposit(vaa);

        // After consumption
        assertTrue(executor.isVAAConsumed(vaaHash));
    }

    // ============ Deposit Tests ============

    function test_deposit_success() public {
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Execute deposit
        executor.consumeAndExecuteDeposit(vaa);

        // Verify deposit tracked
        assertEq(executor.getDeposit(intent.intentId, intent.asset), intent.amount);

        // Verify Aave pool received the supply
        assertEq(aavePool.getDeposit(address(executor), intent.asset), intent.amount);
    }

    function test_deposit_deadlinePassed() public {
        DepositIntent memory intent = _createDepositIntent();
        intent.deadline = uint64(block.timestamp - 1); // Past deadline
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.DeadlinePassed.selector, intent.deadline, block.timestamp)
        );
        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_deposit_exactDeadline() public {
        // Test that execution at exact deadline succeeds (boundary condition)
        DepositIntent memory intent = _createDepositIntent();
        intent.deadline = uint64(block.timestamp); // Exact deadline
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Should succeed at exact deadline
        executor.consumeAndExecuteDeposit(vaa);

        // Verify deposit was tracked
        assertEq(executor.getDeposit(intent.intentId, intent.asset), intent.amount);
    }

    function test_deposit_zeroAmount() public {
        DepositIntent memory intent = _createDepositIntent();
        intent.amount = 0;
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(AaveExecutorTarget.ZeroAmount.selector);
        executor.consumeAndExecuteDeposit(vaa);
    }

    // ============ Withdraw Tests ============

    function test_withdraw_success() public {
        // First deposit
        DepositIntent memory depositIntent = _createDepositIntent();
        bytes memory depositPayload = IntentLib.encodeDepositIntent(depositIntent);
        bytes memory depositVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, depositPayload);
        executor.consumeAndExecuteDeposit(depositVaa);

        // Now withdraw full amount (per spec: partial withdrawals not supported in MVP)
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: depositIntent.intentId,
            ownerHash: testOwnerHash,
            amount: depositIntent.amount, // Full withdrawal per spec
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory withdrawPayload = IntentLib.encodeWithdrawIntent(withdrawIntent);
        bytes memory withdrawVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, withdrawPayload);

        executor.consumeAndExecuteWithdraw(withdrawVaa, depositIntent.asset);

        // Verify deposit is fully consumed
        assertEq(executor.getDeposit(depositIntent.intentId, depositIntent.asset), 0);
    }

    function test_withdraw_exactDeadline() public {
        // First deposit
        DepositIntent memory depositIntent = _createDepositIntent();
        bytes memory depositPayload = IntentLib.encodeDepositIntent(depositIntent);
        bytes memory depositVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, depositPayload);
        executor.consumeAndExecuteDeposit(depositVaa);

        // Withdraw at exact deadline (boundary condition)
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: depositIntent.intentId,
            ownerHash: testOwnerHash,
            amount: depositIntent.amount,
            deadline: uint64(block.timestamp) // Exact deadline
        });
        bytes memory withdrawPayload = IntentLib.encodeWithdrawIntent(withdrawIntent);
        bytes memory withdrawVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, withdrawPayload);

        // Should succeed at exact deadline
        executor.consumeAndExecuteWithdraw(withdrawVaa, depositIntent.asset);

        // Verify deposit is fully consumed
        assertEq(executor.getDeposit(depositIntent.intentId, depositIntent.asset), 0);
    }

    function test_withdraw_insufficientDeposit() public {
        // Don't deposit first, try to withdraw
        WithdrawIntent memory intent = WithdrawIntent({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            amount: 1000e6,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory payload = IntentLib.encodeWithdrawIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(
            abi.encodeWithSelector(
                AaveExecutorTarget.InsufficientDeposit.selector, testIntentId, address(token), intent.amount, 0
            )
        );
        executor.consumeAndExecuteWithdraw(vaa, address(token));
    }

    function test_withdraw_deadlinePassed() public {
        WithdrawIntent memory intent = WithdrawIntent({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            amount: 1000e6,
            deadline: uint64(block.timestamp - 1) // Past deadline
        });
        bytes memory payload = IntentLib.encodeWithdrawIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(
            abi.encodeWithSelector(AaveExecutorTarget.DeadlinePassed.selector, intent.deadline, block.timestamp)
        );
        executor.consumeAndExecuteWithdraw(vaa, address(token));
    }

    function test_withdraw_zeroAmount() public {
        WithdrawIntent memory intent = WithdrawIntent({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            amount: 0,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory payload = IntentLib.encodeWithdrawIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        vm.expectRevert(AaveExecutorTarget.ZeroAmount.selector);
        executor.consumeAndExecuteWithdraw(vaa, address(token));
    }

    // ============ Event Tests ============

    function test_deposit_emitsEvent() public {
        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        // Expect DepositExecuted event with correct parameters
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.DepositExecuted(
            intent.intentId, intent.ownerHash, intent.asset, intent.amount, intent.amount
        );

        executor.consumeAndExecuteDeposit(vaa);
    }

    function test_withdraw_emitsEvent() public {
        // First deposit
        DepositIntent memory depositIntent = _createDepositIntent();
        bytes memory depositPayload = IntentLib.encodeDepositIntent(depositIntent);
        bytes memory depositVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, depositPayload);
        executor.consumeAndExecuteDeposit(depositVaa);

        // Withdraw full amount
        WithdrawIntent memory withdrawIntent = WithdrawIntent({
            intentId: depositIntent.intentId,
            ownerHash: testOwnerHash,
            amount: depositIntent.amount,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory withdrawPayload = IntentLib.encodeWithdrawIntent(withdrawIntent);
        bytes memory withdrawVaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 2, withdrawPayload);

        // Expect WithdrawExecuted event with correct parameters
        vm.expectEmit(true, true, true, true);
        emit AaveExecutorTarget.WithdrawExecuted(
            withdrawIntent.intentId, withdrawIntent.ownerHash, depositIntent.asset, withdrawIntent.amount
        );

        executor.consumeAndExecuteWithdraw(withdrawVaa, depositIntent.asset);
    }

    // ============ Fuzz Tests ============

    function testFuzz_replayProtection(bytes32 intentId, uint128 amount) public {
        // Bound amount to what we have minted (1M tokens with 6 decimals)
        vm.assume(amount > 0 && amount <= 1000000e6);

        DepositIntent memory intent = _createDepositIntent();
        intent.intentId = intentId;
        intent.amount = amount;
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(SOURCE_CHAIN_ID, l1PortalAddress, 1, payload);

        bytes32 vaaHash = WormholeParser.computeVAAHash(vaa);

        // First call succeeds
        executor.consumeAndExecuteDeposit(vaa);
        assertTrue(executor.isVAAConsumed(vaaHash));

        // Second call fails
        vm.expectRevert(abi.encodeWithSelector(AaveExecutorTarget.VAAAlreadyConsumed.selector, vaaHash));
        executor.consumeAndExecuteDeposit(vaa);
    }

    function testFuzz_emitterValidation(uint16 chainId, bytes32 emitterAddress) public {
        vm.assume(chainId != SOURCE_CHAIN_ID || emitterAddress != l1PortalAddress);

        DepositIntent memory intent = _createDepositIntent();
        bytes memory payload = IntentLib.encodeDepositIntent(intent);
        bytes memory vaa = wormhole.encodeMockVAA(chainId, emitterAddress, 1, payload);

        // Should revert with either InvalidEmitterChain or InvalidEmitterAddress
        vm.expectRevert();
        executor.consumeAndExecuteDeposit(vaa);
    }

    // ============ Helper Functions ============

    function _createDepositIntent() internal view returns (DepositIntent memory) {
        return DepositIntent({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            asset: address(token),
            amount: 1000e6,
            originalDecimals: 6,
            targetChainId: 23, // Arbitrum
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256("random.salt")
        });
    }
}
