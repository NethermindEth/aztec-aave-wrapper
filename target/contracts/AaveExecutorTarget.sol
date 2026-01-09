// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ILendingPool} from "./interfaces/ILendingPool.sol";

/**
 * @title AaveExecutorTarget
 * @notice Executes Aave V3 operations on the target chain (L1) on behalf of Aztec users
 * @dev This contract will receive cross-chain messages from Aztec and execute corresponding
 *      Aave operations (supply, withdraw) while maintaining user position tracking.
 *
 * Architecture Overview:
 * - Aztec L2 -> Portal -> This Contract -> Aave V3 Pool
 * - Each Aztec user's L2 address maps to a position tracked in this contract
 * - aTokens are held by this contract on behalf of users
 *
 * TODO: Implement in Phase 2
 * - Message verification from Aztec portal
 * - Position tracking per user
 * - Supply/Withdraw execution
 * - Yield accrual tracking
 */
contract AaveExecutorTarget {
    /// @notice Aave V3 Pool contract
    ILendingPool public immutable aavePool;

    /// @notice Aztec portal contract address for message verification
    address public immutable aztecPortal;

    /// @notice Mapping from Aztec L2 address hash to deposited amounts per asset
    mapping(bytes32 => mapping(address => uint256)) public userPositions;

    /// @notice Emitted when a supply operation is executed
    event Supplied(bytes32 indexed aztecAddress, address indexed asset, uint256 amount);

    /// @notice Emitted when a withdraw operation is executed
    event Withdrawn(bytes32 indexed aztecAddress, address indexed asset, uint256 amount, address recipient);

    error InvalidPortal();
    error InvalidAmount();
    error InsufficientBalance();
    error UnauthorizedCaller();

    /**
     * @notice Constructor
     * @param _aavePool Address of the Aave V3 Pool contract
     * @param _aztecPortal Address of the Aztec portal contract
     */
    constructor(address _aavePool, address _aztecPortal) {
        aavePool = ILendingPool(_aavePool);
        aztecPortal = _aztecPortal;
    }

    /**
     * @notice Supply assets to Aave on behalf of an Aztec user
     * @dev TODO: Implement message verification and actual supply logic
     * @param aztecAddress The Aztec L2 address hash of the user
     * @param asset The address of the asset to supply
     * @param amount The amount to supply
     */
    function supply(bytes32 aztecAddress, address asset, uint256 amount) external {
        // TODO: Implement in Phase 2
        // 1. Verify message from Aztec portal
        // 2. Transfer tokens from portal/user
        // 3. Approve and supply to Aave
        // 4. Update user position tracking
        revert("Not implemented");
    }

    /**
     * @notice Withdraw assets from Aave for an Aztec user
     * @dev TODO: Implement message verification and actual withdraw logic
     * @param aztecAddress The Aztec L2 address hash of the user
     * @param asset The address of the asset to withdraw
     * @param amount The amount to withdraw
     * @param recipient The L1 address to receive the withdrawn funds
     */
    function withdraw(bytes32 aztecAddress, address asset, uint256 amount, address recipient) external {
        // TODO: Implement in Phase 2
        // 1. Verify message from Aztec portal
        // 2. Check user has sufficient position
        // 3. Withdraw from Aave
        // 4. Transfer to recipient
        // 5. Update user position tracking
        revert("Not implemented");
    }

    /**
     * @notice Get the current position value for a user
     * @param aztecAddress The Aztec L2 address hash of the user
     * @param asset The address of the asset
     * @return The current position amount (including accrued yield)
     */
    function getPosition(bytes32 aztecAddress, address asset) external view returns (uint256) {
        // TODO: Implement yield accrual calculation
        return userPositions[aztecAddress][asset];
    }
}
