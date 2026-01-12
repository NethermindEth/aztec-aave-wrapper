// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @title Intent Type Definitions
/// @notice Shared message payload structures for cross-chain communication
/// @dev These structs must match the Noir definitions in aztec_contracts/src/types/intent.nr
///      and TypeScript definitions in shared/types/Intent.ts

/// @notice Intent to deposit assets into Aave on a target chain
/// @dev Sent from Aztec L2 → L1 Portal → Target Executor
/// Privacy: Uses hash(ownerL2) instead of plain owner address
struct DepositIntent {
    /// @notice Unique identifier for this intent (derived from user address + nonce)
    bytes32 intentId;
    /// @notice Hash of the L2 owner address for privacy preservation
    /// @dev Computed as hash(ownerL2) on L2, prevents leaking user identity
    bytes32 ownerHash;
    /// @notice Token address on target chain to deposit
    address asset;
    /// @notice Amount of tokens to deposit (in token's smallest unit)
    uint128 amount;
    /// @notice Original token decimals for Wormhole denormalization
    /// @dev Wormhole normalizes to 8 decimals; this allows reconstruction on target
    uint8 originalDecimals;
    /// @notice Wormhole chain ID of the target chain for deposit
    uint32 targetChainId;
    /// @notice Unix timestamp after which this intent expires
    uint64 deadline;
    /// @notice Random salt for intent uniqueness and replay protection
    bytes32 salt;
}

/// @notice Intent to withdraw assets from Aave on a target chain
/// @dev Sent from Aztec L2 → L1 Portal → Target Executor
/// Privacy: Uses hash(ownerL2) for consistency with deposits
struct WithdrawIntent {
    /// @notice Unique identifier for this intent (must match original deposit)
    bytes32 intentId;
    /// @notice Hash of the L2 owner address for privacy preservation
    bytes32 ownerHash;
    /// @notice Amount of aTokens/shares to withdraw
    /// @dev MVP: Must be full amount (partial withdrawals not supported)
    uint128 amount;
    /// @notice Unix timestamp after which this intent expires
    uint64 deadline;
}

/// @title Intent Library
/// @notice Helper functions for encoding and validating intents
library IntentLib {
    /// @notice Compute the hash of a DepositIntent for message verification
    /// @dev Must match L2 encoding exactly for cross-chain message consumption
    /// @param intent The deposit intent to hash
    /// @return Hash of the intent suitable for Merkle proof verification
    function hashDepositIntent(
        DepositIntent memory intent
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                intent.intentId,
                intent.ownerHash,
                intent.asset,
                intent.amount,
                intent.originalDecimals,
                intent.targetChainId,
                intent.deadline,
                intent.salt
            )
        );
    }

    /// @notice Compute the hash of a WithdrawIntent for message verification
    /// @param intent The withdrawal intent to hash
    /// @return Hash of the intent suitable for Merkle proof verification
    function hashWithdrawIntent(
        WithdrawIntent memory intent
    ) internal pure returns (bytes32) {
        return
            keccak256(abi.encode(intent.intentId, intent.ownerHash, intent.amount, intent.deadline));
    }

    /// @notice Encode DepositIntent for Wormhole payload
    /// @dev This encoding is sent to the target executor
    /// @param intent The deposit intent to encode
    /// @return Encoded bytes suitable for Wormhole message payload
    function encodeDepositIntent(
        DepositIntent memory intent
    ) internal pure returns (bytes memory) {
        return abi.encode(
            intent.intentId,
            intent.ownerHash,
            intent.asset,
            intent.amount,
            intent.originalDecimals,
            intent.targetChainId,
            intent.deadline,
            intent.salt
        );
    }

    /// @notice Decode DepositIntent from Wormhole payload
    /// @param payload The encoded intent payload
    /// @return intent The decoded deposit intent
    function decodeDepositIntent(
        bytes memory payload
    ) internal pure returns (DepositIntent memory intent) {
        (
            intent.intentId,
            intent.ownerHash,
            intent.asset,
            intent.amount,
            intent.originalDecimals,
            intent.targetChainId,
            intent.deadline,
            intent.salt
        ) = abi.decode(
            payload, (bytes32, bytes32, address, uint128, uint8, uint32, uint64, bytes32)
        );
    }

    /// @notice Encode WithdrawIntent for Wormhole payload
    /// @param intent The withdrawal intent to encode
    /// @return Encoded bytes suitable for Wormhole message payload
    function encodeWithdrawIntent(
        WithdrawIntent memory intent
    ) internal pure returns (bytes memory) {
        return abi.encode(intent.intentId, intent.ownerHash, intent.amount, intent.deadline);
    }

    /// @notice Decode WithdrawIntent from Wormhole payload
    /// @param payload The encoded intent payload
    /// @return intent The decoded withdrawal intent
    function decodeWithdrawIntent(
        bytes memory payload
    ) internal pure returns (WithdrawIntent memory intent) {
        (intent.intentId, intent.ownerHash, intent.amount, intent.deadline) =
            abi.decode(payload, (bytes32, bytes32, uint128, uint64));
    }
}

/// @notice Payload for token bridge transfer on withdrawal completion
/// @dev Sent from Target Executor → L1 Portal via Wormhole Token Bridge
/// Contains information needed to route tokens to the correct L2 recipient
struct WithdrawTokenPayload {
    /// @notice The intent ID this token transfer corresponds to
    bytes32 intentId;
    /// @notice Hash of the L2 owner address (for routing to token portal)
    bytes32 ownerHash;
    /// @notice Secret hash for L2 token claiming via token portal
    /// @dev The user must provide the matching secret on L2 to claim tokens
    bytes32 secretHash;
    /// @notice Asset address on L1 (the token being bridged back)
    address asset;
}

/// @title WithdrawTokenPayloadLib
/// @notice Helper functions for encoding/decoding withdrawal token payloads
library WithdrawTokenPayloadLib {
    /// @notice Encode a WithdrawTokenPayload for Wormhole token bridge
    /// @param payload The payload to encode
    /// @return Encoded bytes suitable for transferTokensWithPayload
    function encode(
        WithdrawTokenPayload memory payload
    ) internal pure returns (bytes memory) {
        return abi.encode(payload.intentId, payload.ownerHash, payload.secretHash, payload.asset);
    }

    /// @notice Decode a WithdrawTokenPayload from Wormhole token bridge
    /// @param data The encoded payload
    /// @return payload The decoded withdrawal token payload
    function decode(
        bytes memory data
    ) internal pure returns (WithdrawTokenPayload memory payload) {
        (payload.intentId, payload.ownerHash, payload.secretHash, payload.asset) =
            abi.decode(data, (bytes32, bytes32, bytes32, address));
    }
}
