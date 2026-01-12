// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title Failed Operation Type Definition
/// @notice Struct for tracking failed operations in the retry queue
/// @dev Used to store all necessary information to retry a failed Aave operation

/// @notice Operation type enum
enum OperationType {
    Deposit,
    Withdraw
}

/// @notice Failed operation data for retry queue
/// @dev Stores all information needed to retry a failed operation
struct FailedOperation {
    /// @notice Type of operation (Deposit or Withdraw)
    OperationType operationType;
    /// @notice The intent ID associated with this operation
    bytes32 intentId;
    /// @notice Hash of the L2 owner address for privacy preservation
    bytes32 ownerHash;
    /// @notice Token address on target chain
    address asset;
    /// @notice Amount of tokens involved in the operation
    uint256 amount;
    /// @notice Block timestamp when the operation failed
    uint256 failedAt;
    /// @notice Number of retry attempts made
    uint256 retryCount;
    /// @notice Original caller who initiated the operation (for gas refund tracking)
    address originalCaller;
    /// @notice Error reason from the failed operation (truncated if too long)
    string errorReason;
}
