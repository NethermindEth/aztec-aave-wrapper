// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { ILendingPool } from "../interfaces/ILendingPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockLendingPool
 * @notice Mock implementation of Aave V3 Pool for testing
 * @dev Simulates supply/withdraw without actual interest accrual
 */
contract MockLendingPool is ILendingPool {
    /// @notice Tracks deposits per user per asset
    mapping(address => mapping(address => uint256)) public deposits;

    /// @notice Whether to fail supply calls (for testing)
    bool public failSupply;

    /// @notice Whether to fail withdraw calls (for testing)
    bool public failWithdraw;

    /// @notice Mock aToken addresses per asset
    mapping(address => address) public aTokenAddresses;

    /// @notice Mock normalized income per asset (RAY = 1e27)
    mapping(address => uint256) public normalizedIncomes;

    event Supply(
        address indexed asset, uint256 amount, address indexed onBehalfOf, uint16 referralCode
    );
    event Withdraw(address indexed asset, uint256 amount, address indexed to);

    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external override {
        require(!failSupply, "MockLendingPool: supply failed");

        // Transfer tokens from sender to this contract
        IERC20(asset).transferFrom(msg.sender, address(this), amount);

        // Track the deposit
        deposits[onBehalfOf][asset] += amount;

        emit Supply(asset, amount, onBehalfOf, referralCode);
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external override returns (uint256) {
        require(!failWithdraw, "MockLendingPool: withdraw failed");

        // Check deposit balance
        require(deposits[msg.sender][asset] >= amount, "MockLendingPool: insufficient balance");

        // Update deposit tracking
        deposits[msg.sender][asset] -= amount;

        // Transfer tokens back
        IERC20(asset).transfer(to, amount);

        emit Withdraw(asset, amount, to);

        return amount;
    }

    function getUserAccountData(
        address
    ) external pure override returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (0, 0, 0, 0, 0, type(uint256).max);
    }

    function getReserveNormalizedIncome(
        address asset
    ) external view override returns (uint256) {
        uint256 income = normalizedIncomes[asset];
        // Default to RAY (1e27) if not set, which represents 1.0 (no yield)
        return income == 0 ? 1e27 : income;
    }

    function getReserveData(
        address asset
    )
        external
        view
        override
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
        // Return mock aToken address if configured
        address aToken = aTokenAddresses[asset];
        return (0, 0, 0, 0, 0, 0, 0, 0, aToken, address(0), address(0), address(0), 0, 0, 0);
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

    function getDeposit(address user, address asset) external view returns (uint256) {
        return deposits[user][asset];
    }

    function setATokenAddress(address asset, address aToken) external {
        aTokenAddresses[asset] = aToken;
    }

    function setNormalizedIncome(address asset, uint256 income) external {
        normalizedIncomes[asset] = income;
    }
}
