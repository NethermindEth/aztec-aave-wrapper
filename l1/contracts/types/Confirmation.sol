// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title Confirmation Type Definitions
/// @notice Message payload structures for cross-chain confirmations from target executor
/// @dev These structs represent responses from AaveExecutorTarget back to L1 portal

/// @notice Confirmation status for cross-chain operations
enum ConfirmationStatus {
    /// @notice Operation completed successfully
    SUCCESS,
    /// @notice Operation failed (e.g., Aave revert)
    FAILED
}

/// @notice Confirmation of a deposit operation from target executor
/// @dev Sent from Target Executor → L1 Portal after Aave supply completes
struct DepositConfirmation {
    /// @notice The intent ID this confirmation corresponds to
    bytes32 intentId;
    /// @notice Hash of the L2 owner address (for routing L1→L2 message)
    bytes32 ownerHash;
    /// @notice Status of the deposit operation
    ConfirmationStatus status;
    /// @notice Amount of shares/aTokens received (on success)
    /// @dev For MVP, shares = principal deposited (no yield accounting)
    uint128 shares;
    /// @notice Original asset address deposited
    address asset;
}

/// @notice Confirmation of a withdraw operation from target executor
/// @dev Sent from Target Executor → L1 Portal after Aave withdraw + token bridge
struct WithdrawConfirmation {
    /// @notice The intent ID this confirmation corresponds to
    bytes32 intentId;
    /// @notice Hash of the L2 owner address (for routing L1→L2 message)
    bytes32 ownerHash;
    /// @notice Status of the withdraw operation
    ConfirmationStatus status;
    /// @notice Amount of tokens withdrawn and bridged back
    uint128 amount;
    /// @notice Asset address withdrawn
    address asset;
}

/// @title Confirmation Library
/// @notice Helper functions for encoding and decoding confirmations
library ConfirmationLib {
    /// @notice Encode a DepositConfirmation for Wormhole payload
    /// @param confirmation The confirmation to encode
    /// @return Encoded bytes suitable for Wormhole message payload
    function encodeDepositConfirmation(
        DepositConfirmation memory confirmation
    ) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(0), // Action type: 0 = deposit confirmation
            confirmation.intentId,
            confirmation.ownerHash,
            uint8(confirmation.status),
            confirmation.shares,
            confirmation.asset
        );
    }

    /// @notice Decode a DepositConfirmation from Wormhole payload
    /// @param payload The encoded confirmation payload
    /// @return confirmation The decoded deposit confirmation
    function decodeDepositConfirmation(
        bytes memory payload
    ) internal pure returns (DepositConfirmation memory confirmation) {
        uint8 actionType;
        uint8 status;

        (
            actionType,
            confirmation.intentId,
            confirmation.ownerHash,
            status,
            confirmation.shares,
            confirmation.asset
        ) = abi.decode(payload, (uint8, bytes32, bytes32, uint8, uint128, address));

        require(actionType == 0, "Invalid action type for deposit confirmation");
        confirmation.status = ConfirmationStatus(status);
    }

    /// @notice Encode a WithdrawConfirmation for Wormhole payload
    /// @param confirmation The confirmation to encode
    /// @return Encoded bytes suitable for Wormhole message payload
    function encodeWithdrawConfirmation(
        WithdrawConfirmation memory confirmation
    ) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(1), // Action type: 1 = withdraw confirmation
            confirmation.intentId,
            confirmation.ownerHash,
            uint8(confirmation.status),
            confirmation.amount,
            confirmation.asset
        );
    }

    /// @notice Decode a WithdrawConfirmation from Wormhole payload
    /// @param payload The encoded confirmation payload
    /// @return confirmation The decoded withdraw confirmation
    function decodeWithdrawConfirmation(
        bytes memory payload
    ) internal pure returns (WithdrawConfirmation memory confirmation) {
        uint8 actionType;
        uint8 status;

        (
            actionType,
            confirmation.intentId,
            confirmation.ownerHash,
            status,
            confirmation.amount,
            confirmation.asset
        ) = abi.decode(payload, (uint8, bytes32, bytes32, uint8, uint128, address));

        require(actionType == 1, "Invalid action type for withdraw confirmation");
        confirmation.status = ConfirmationStatus(status);
    }

    /// @notice Extract action type from encoded payload without full decode
    /// @param payload The encoded confirmation payload
    /// @return actionType 0 = deposit, 1 = withdraw
    function getActionType(
        bytes memory payload
    ) internal pure returns (uint8 actionType) {
        require(payload.length >= 32, "Payload too short");
        assembly {
            // Load first 32 bytes after length prefix
            // abi.encode stores uint8 as a right-padded 32-byte value
            // So the actual value is at byte 31 (last byte of the word)
            actionType := byte(31, mload(add(payload, 32)))
        }
    }
}
