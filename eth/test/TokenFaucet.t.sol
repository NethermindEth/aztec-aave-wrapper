// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { TokenFaucet } from "../contracts/mocks/TokenFaucet.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

/**
 * @title TokenFaucetTest
 * @notice Unit tests for TokenFaucet contract
 * @dev Tests rate-limited token dispensing with cooldown enforcement
 */
contract TokenFaucetTest is Test {
    TokenFaucet public faucet;
    MockERC20 public token;

    // Configuration
    uint256 public constant DRIP_AMOUNT = 1000e6; // 1000 USDC (6 decimals)
    uint256 public constant COOLDOWN_PERIOD = 1 hours;

    // Test accounts
    address public claimer1 = makeAddr("claimer1");
    address public claimer2 = makeAddr("claimer2");

    function setUp() public {
        // Set a realistic timestamp (contract requires block.timestamp >= cooldownPeriod for first claim)
        // This simulates a production environment where timestamps are well past the cooldown period
        vm.warp(1700000000); // Nov 2023 timestamp

        // Deploy mock token (USDC-like with 6 decimals)
        token = new MockERC20("Mock USDC", "USDC", 6);

        // Deploy faucet
        faucet = new TokenFaucet(token, DRIP_AMOUNT, COOLDOWN_PERIOD);
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        assertEq(address(faucet.token()), address(token));
        assertEq(faucet.dripAmount(), DRIP_AMOUNT);
        assertEq(faucet.cooldownPeriod(), COOLDOWN_PERIOD);
    }

    function test_Constructor_ZeroDripAmount() public {
        // Zero drip amount is technically valid (though useless)
        TokenFaucet zeroFaucet = new TokenFaucet(token, 0, COOLDOWN_PERIOD);
        assertEq(zeroFaucet.dripAmount(), 0);
    }

    function test_Constructor_ZeroCooldown() public {
        // Zero cooldown allows unlimited claims
        TokenFaucet zeroCooldown = new TokenFaucet(token, DRIP_AMOUNT, 0);
        assertEq(zeroCooldown.cooldownPeriod(), 0);
    }

    // ============ claim Tests ============

    function test_claim_Success() public {
        uint256 balanceBefore = token.balanceOf(claimer1);

        vm.prank(claimer1);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), balanceBefore + DRIP_AMOUNT);
    }

    function test_claim_UpdatesLastClaimTime() public {
        uint256 claimTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        assertEq(faucet.lastClaimTime(claimer1), claimTime);
    }

    function test_claim_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit TokenFaucet.Claimed(claimer1, DRIP_AMOUNT);

        vm.prank(claimer1);
        faucet.claim();
    }

    function test_claim_FirstClaimSucceeds() public {
        // First claim should succeed (setup already warped to valid timestamp)
        vm.prank(claimer1);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT);
    }

    function test_claim_RevertIf_TimestampTooLow() public {
        // Contract requires block.timestamp >= cooldownPeriod for first claim
        // because lastClaimTime defaults to 0, so nextClaimTime = 0 + cooldownPeriod
        vm.warp(COOLDOWN_PERIOD - 1);

        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownNotExpired.selector, 1));
        vm.prank(claimer1);
        faucet.claim();
    }

    function test_claim_MultipleUsersCanClaimSimultaneously() public {
        vm.prank(claimer1);
        faucet.claim();

        vm.prank(claimer2);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT);
        assertEq(token.balanceOf(claimer2), DRIP_AMOUNT);
    }

    function test_claim_AfterCooldownExpires() public {
        // First claim
        vm.prank(claimer1);
        faucet.claim();

        // Advance time past cooldown
        vm.warp(block.timestamp + COOLDOWN_PERIOD);

        // Second claim should succeed
        vm.prank(claimer1);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT * 2);
    }

    function test_claim_ExactlyAtCooldownExpiry() public {
        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        // Advance to exactly when cooldown expires
        vm.warp(startTime + COOLDOWN_PERIOD);

        // Should succeed
        vm.prank(claimer1);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT * 2);
    }

    function test_claim_RevertIf_CooldownNotExpired() public {
        // First claim
        vm.prank(claimer1);
        faucet.claim();

        // Try to claim again immediately
        uint256 remainingTime = COOLDOWN_PERIOD;
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownNotExpired.selector, remainingTime));
        vm.prank(claimer1);
        faucet.claim();
    }

    function test_claim_RevertIf_CooldownPartiallyExpired() public {
        uint256 startTime = block.timestamp;

        // First claim
        vm.prank(claimer1);
        faucet.claim();

        // Advance half the cooldown
        uint256 halfCooldown = COOLDOWN_PERIOD / 2;
        vm.warp(startTime + halfCooldown);

        // Should revert with remaining time
        uint256 remainingTime = COOLDOWN_PERIOD - halfCooldown;
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownNotExpired.selector, remainingTime));
        vm.prank(claimer1);
        faucet.claim();
    }

    function test_claim_RevertIf_OneSecondBeforeCooldownExpiry() public {
        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        // Advance to 1 second before cooldown expires
        vm.warp(startTime + COOLDOWN_PERIOD - 1);

        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownNotExpired.selector, 1));
        vm.prank(claimer1);
        faucet.claim();
    }

    function test_claim_ZeroCooldownAllowsMultipleClaims() public {
        TokenFaucet zeroCooldown = new TokenFaucet(token, DRIP_AMOUNT, 0);

        vm.startPrank(claimer1);
        zeroCooldown.claim();
        zeroCooldown.claim();
        zeroCooldown.claim();
        vm.stopPrank();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT * 3);
    }

    function test_claim_ZeroDripAmount() public {
        TokenFaucet zeroAmount = new TokenFaucet(token, 0, COOLDOWN_PERIOD);

        uint256 balanceBefore = token.balanceOf(claimer1);

        vm.prank(claimer1);
        zeroAmount.claim();

        assertEq(token.balanceOf(claimer1), balanceBefore);
    }

    // ============ canClaim Tests ============

    function test_canClaim_ReturnsTrueForNewUser() public view {
        (bool claimable, uint256 remainingCooldown) = faucet.canClaim(claimer1);

        assertTrue(claimable);
        assertEq(remainingCooldown, 0);
    }

    function test_canClaim_ReturnsFalseAfterClaim() public {
        vm.prank(claimer1);
        faucet.claim();

        (bool claimable, uint256 remainingCooldown) = faucet.canClaim(claimer1);

        assertFalse(claimable);
        assertEq(remainingCooldown, COOLDOWN_PERIOD);
    }

    function test_canClaim_ReturnsCorrectRemainingTime() public {
        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        // Advance 30 minutes
        uint256 elapsed = 30 minutes;
        vm.warp(startTime + elapsed);

        (bool claimable, uint256 remainingCooldown) = faucet.canClaim(claimer1);

        assertFalse(claimable);
        assertEq(remainingCooldown, COOLDOWN_PERIOD - elapsed);
    }

    function test_canClaim_ReturnsTrueAfterCooldownExpires() public {
        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        // Advance past cooldown
        vm.warp(startTime + COOLDOWN_PERIOD);

        (bool claimable, uint256 remainingCooldown) = faucet.canClaim(claimer1);

        assertTrue(claimable);
        assertEq(remainingCooldown, 0);
    }

    function test_canClaim_IndependentPerUser() public {
        vm.prank(claimer1);
        faucet.claim();

        // claimer1 cannot claim
        (bool claimable1, ) = faucet.canClaim(claimer1);
        assertFalse(claimable1);

        // claimer2 can still claim
        (bool claimable2, uint256 remaining2) = faucet.canClaim(claimer2);
        assertTrue(claimable2);
        assertEq(remaining2, 0);
    }

    // ============ lastClaimTime Tests ============

    function test_lastClaimTime_ZeroForNewUser() public view {
        assertEq(faucet.lastClaimTime(claimer1), 0);
    }

    function test_lastClaimTime_UpdatedAfterClaim() public {
        uint256 claimTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        assertEq(faucet.lastClaimTime(claimer1), claimTime);
    }

    function test_lastClaimTime_UpdatedOnSubsequentClaims() public {
        uint256 firstClaimTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        assertEq(faucet.lastClaimTime(claimer1), firstClaimTime);

        // Advance and claim again
        uint256 secondClaimTime = firstClaimTime + COOLDOWN_PERIOD;
        vm.warp(secondClaimTime);

        vm.prank(claimer1);
        faucet.claim();

        assertEq(faucet.lastClaimTime(claimer1), secondClaimTime);
    }

    // ============ Edge Case Tests ============

    function test_MultipleCyclesOfClaiming() public {
        uint256 startTime = block.timestamp;

        for (uint256 i = 0; i < 5; i++) {
            vm.warp(startTime + (i * COOLDOWN_PERIOD));
            vm.prank(claimer1);
            faucet.claim();
        }

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT * 5);
    }

    function test_LargeDripAmount() public {
        uint256 largeDrip = type(uint128).max;
        TokenFaucet largeFaucet = new TokenFaucet(token, largeDrip, COOLDOWN_PERIOD);

        vm.prank(claimer1);
        largeFaucet.claim();

        assertEq(token.balanceOf(claimer1), largeDrip);
    }

    function test_LongCooldownPeriod() public {
        uint256 longCooldown = 365 days;
        TokenFaucet longFaucet = new TokenFaucet(token, DRIP_AMOUNT, longCooldown);

        vm.prank(claimer1);
        longFaucet.claim();

        // Immediately after claim, cannot claim again
        (bool claimable, uint256 remaining) = longFaucet.canClaim(claimer1);
        assertFalse(claimable);
        assertEq(remaining, longCooldown);
    }

    // ============ Fuzz Tests ============

    function testFuzz_claim_AfterCooldown(uint256 waitTime) public {
        waitTime = bound(waitTime, COOLDOWN_PERIOD, type(uint64).max);

        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        vm.warp(startTime + waitTime);

        // Should always succeed when cooldown has passed
        vm.prank(claimer1);
        faucet.claim();

        assertEq(token.balanceOf(claimer1), DRIP_AMOUNT * 2);
    }

    function testFuzz_claim_BeforeCooldown(uint256 waitTime) public {
        waitTime = bound(waitTime, 0, COOLDOWN_PERIOD - 1);

        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        vm.warp(startTime + waitTime);

        uint256 expectedRemaining = COOLDOWN_PERIOD - waitTime;
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownNotExpired.selector, expectedRemaining));
        vm.prank(claimer1);
        faucet.claim();
    }

    function testFuzz_canClaim_RemainingTime(uint256 waitTime) public {
        waitTime = bound(waitTime, 0, COOLDOWN_PERIOD * 2);

        uint256 startTime = block.timestamp;

        vm.prank(claimer1);
        faucet.claim();

        vm.warp(startTime + waitTime);

        (bool claimable, uint256 remaining) = faucet.canClaim(claimer1);

        if (waitTime >= COOLDOWN_PERIOD) {
            assertTrue(claimable);
            assertEq(remaining, 0);
        } else {
            assertFalse(claimable);
            assertEq(remaining, COOLDOWN_PERIOD - waitTime);
        }
    }

    function testFuzz_Constructor_AnyConfiguration(uint256 dripAmount, uint256 cooldown) public {
        TokenFaucet f = new TokenFaucet(token, dripAmount, cooldown);

        assertEq(f.dripAmount(), dripAmount);
        assertEq(f.cooldownPeriod(), cooldown);
        assertEq(address(f.token()), address(token));
    }
}
