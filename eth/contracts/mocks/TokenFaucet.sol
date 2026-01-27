// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { MockERC20 } from "./MockERC20.sol";

/**
 * @title TokenFaucet
 * @notice Rate-limited faucet wrapper around MockERC20's mint function
 * @dev Enforces a cooldown period between claims to prevent abuse
 */
contract TokenFaucet {
    /// @notice The token this faucet dispenses
    MockERC20 public immutable token;

    /// @notice Amount of tokens dispensed per claim
    uint256 public immutable dripAmount;

    /// @notice Cooldown period between claims (in seconds)
    uint256 public immutable cooldownPeriod;

    /// @notice Last claim timestamp per address
    mapping(address => uint256) public lastClaimTime;

    /// @notice Emitted when tokens are claimed
    event Claimed(address indexed recipient, uint256 amount);

    /// @notice Thrown when claim is attempted before cooldown expires
    error CooldownNotExpired(uint256 remainingTime);

    /**
     * @notice Construct a new TokenFaucet
     * @param token_ The MockERC20 token to dispense
     * @param dripAmount_ Amount of tokens per claim (in token's smallest unit)
     * @param cooldownPeriod_ Seconds between allowed claims per address
     */
    constructor(
        MockERC20 token_,
        uint256 dripAmount_,
        uint256 cooldownPeriod_
    ) {
        token = token_;
        dripAmount = dripAmount_;
        cooldownPeriod = cooldownPeriod_;
    }

    /**
     * @notice Claim tokens from the faucet
     * @dev Mints dripAmount tokens to msg.sender if cooldown has expired
     */
    function claim() external {
        uint256 lastClaim = lastClaimTime[msg.sender];
        uint256 nextClaimTime = lastClaim + cooldownPeriod;

        if (block.timestamp < nextClaimTime) {
            revert CooldownNotExpired(nextClaimTime - block.timestamp);
        }

        lastClaimTime[msg.sender] = block.timestamp;
        token.mint(msg.sender, dripAmount);

        emit Claimed(msg.sender, dripAmount);
    }

    /**
     * @notice Check if an address can claim
     * @param account Address to check
     * @return claimable True if the address can claim now
     * @return remainingCooldown Seconds until next claim is allowed (0 if claimable)
     */
    function canClaim(address account) external view returns (bool claimable, uint256 remainingCooldown) {
        uint256 nextClaimTime = lastClaimTime[account] + cooldownPeriod;
        if (block.timestamp >= nextClaimTime) {
            return (true, 0);
        }
        return (false, nextClaimTime - block.timestamp);
    }
}
