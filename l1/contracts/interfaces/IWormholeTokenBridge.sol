// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IWormholeTokenBridge
 * @notice Interface for Wormhole Token Bridge transfers with payload
 * @dev Used for atomic token + message delivery across chains
 *
 * Wormhole normalizes all token amounts to 8 decimals internally.
 * When bridging tokens with different decimals (e.g., USDC with 6),
 * you must account for this normalization:
 * - Tokens with <8 decimals: multiply by 10^(8-decimals) before bridge
 * - Tokens with >8 decimals: precision is truncated to 8 decimals
 */
interface IWormholeTokenBridge {
    /**
     * @notice Transfer tokens with an arbitrary payload to another chain
     * @param token Address of token to transfer
     * @param amount Amount of tokens to transfer (in token's native decimals)
     * @param recipientChain Wormhole chain ID of the destination chain
     * @param recipient Address of the recipient contract (32 bytes, left-padded)
     * @param nonce Unique nonce for this transfer
     * @param payload Arbitrary payload to include with the transfer
     * @return sequence Wormhole sequence number for tracking
     */
    function transferTokensWithPayload(
        address token,
        uint256 amount,
        uint16 recipientChain,
        bytes32 recipient,
        uint32 nonce,
        bytes memory payload
    ) external payable returns (uint64 sequence);

    /**
     * @notice Complete a token transfer with payload by providing the VAA
     * @param encodedVm The signed VAA (Verified Action Approval)
     * @return payload The payload that was included with the transfer
     */
    function completeTransferWithPayload(bytes memory encodedVm)
        external
        returns (bytes memory payload);

    /**
     * @notice Get the normalized amount after decimal adjustment
     * @param amount The original amount
     * @param decimals The token's decimals
     * @return The normalized amount (8 decimals)
     */
    function normalizeAmount(uint256 amount, uint8 decimals) external pure returns (uint256);

    /**
     * @notice Get the denormalized amount after decimal adjustment
     * @param amount The normalized amount (8 decimals)
     * @param decimals The token's target decimals
     * @return The denormalized amount
     */
    function denormalizeAmount(uint256 amount, uint8 decimals) external pure returns (uint256);

    /**
     * @notice Check if a VAA has already been redeemed
     * @param hash Hash of the VAA
     * @return True if the VAA has been redeemed
     */
    function isTransferCompleted(bytes32 hash) external view returns (bool);
}
