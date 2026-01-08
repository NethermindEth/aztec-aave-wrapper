// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILendingPool
 * @notice Simplified interface for Aave V3 Pool contract
 * @dev Contains only the functions needed for supply/withdraw operations.
 *      Full interface available in the aave/core-v3 package at contracts/interfaces/IPool.sol
 */
interface ILendingPool {
    /**
     * @notice Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
     * @param asset The address of the underlying asset to supply
     * @param amount The amount to be supplied
     * @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
     *        wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
     *        is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *        0 if the action is executed directly by the user, without any middle-man
     */
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    /**
     * @notice Withdraws an `amount` of underlying asset from the reserve, burning the equivalent aTokens owned
     * @param asset The address of the underlying asset to withdraw
     * @param amount The underlying amount to be withdrawn
     *        - Send type(uint256).max to withdraw the entire aToken balance
     * @param to The address that will receive the underlying, same as msg.sender if the user
     *        wants to receive it on his own wallet, or a different address if the beneficiary is a
     *        different wallet
     * @return The final amount withdrawn
     */
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    /**
     * @notice Returns the user account data across all the reserves
     * @param user The address of the user
     * @return totalCollateralBase The total collateral of the user in the base currency used by the price feed
     * @return totalDebtBase The total debt of the user in the base currency used by the price feed
     * @return availableBorrowsBase The borrowing power left of the user in the base currency used by the price feed
     * @return currentLiquidationThreshold The liquidation threshold of the user
     * @return ltv The loan to value of The user
     * @return healthFactor The current health factor of the user
     */
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    /**
     * @notice Returns the normalized income of the reserve
     * @param asset The address of the underlying asset of the reserve
     * @return The reserve's normalized income
     */
    function getReserveNormalizedIncome(address asset) external view returns (uint256);

    /**
     * @notice Returns the state and configuration of the reserve
     * @param asset The address of the underlying asset of the reserve
     * @return configuration The reserve configuration
     * @return liquidityIndex The liquidity index
     * @return currentLiquidityRate The current liquidity rate
     * @return variableBorrowIndex The variable borrow index
     * @return currentVariableBorrowRate The current variable borrow rate
     * @return currentStableBorrowRate The current stable borrow rate
     * @return lastUpdateTimestamp The last update timestamp
     * @return id The reserve id
     * @return aTokenAddress The aToken address
     * @return stableDebtTokenAddress The stable debt token address
     * @return variableDebtTokenAddress The variable debt token address
     * @return interestRateStrategyAddress The interest rate strategy address
     * @return accruedToTreasury The accrued to treasury
     * @return unbacked The unbacked amount
     * @return isolationModeTotalDebt The isolation mode total debt
     */
    function getReserveData(address asset)
        external
        view
        returns (
            uint256 configuration,
            uint128 liquidityIndex,
            uint128 currentLiquidityRate,
            uint128 variableBorrowIndex,
            uint128 currentVariableBorrowRate,
            uint128 currentStableBorrowRate,
            uint40 lastUpdateTimestamp,
            uint16 id,
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress,
            address interestRateStrategyAddress,
            uint128 accruedToTreasury,
            uint128 unbacked,
            uint128 isolationModeTotalDebt
        );
}
