// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IWormholeTokenBridge} from "../interfaces/IWormholeTokenBridge.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockWormholeTokenBridge
 * @notice Mock implementation of Wormhole Token Bridge for local testing
 * @dev Simulates cross-chain token transfers with 8-decimal normalization
 *
 * Features:
 * - Locks tokens on source chain (this contract holds them)
 * - Generates mock VAAs that can be redeemed on target chain
 * - Implements proper 8-decimal normalization for testing
 * - Manual delivery mode (no automatic relaying for simplicity)
 */
contract MockWormholeTokenBridge is IWormholeTokenBridge {
    // ============ State ============

    /// @notice Sequence counter for tracking transfers
    uint64 private sequence;

    /// @notice Mapping of VAA hash to whether it's been redeemed
    mapping(bytes32 => bool) private completedTransfers;

    /// @notice Pending transfers waiting to be completed
    /// @dev Maps sequence => (token, amount, recipient, payload)
    mapping(uint64 => PendingTransfer) public pendingTransfers;

    /// @notice Struct to track pending transfers
    struct PendingTransfer {
        address token;
        uint256 amount;
        bytes32 recipient;
        bytes payload;
        uint16 targetChain;
        bool exists;
    }

    // ============ Events ============

    event TransferInitiated(
        uint64 indexed sequence,
        address indexed token,
        uint256 amount,
        uint16 targetChain,
        bytes32 recipient,
        bytes payload
    );

    event TransferCompleted(uint64 indexed sequence, bytes32 vaaHash);

    // ============ External Functions ============

    /**
     * @notice Transfer tokens with payload to another chain
     * @dev Locks tokens in this contract and creates a pending transfer
     */
    function transferTokensWithPayload(
        address token,
        uint256 amount,
        uint16 recipientChain,
        bytes32 recipient,
        uint32 nonce,
        bytes memory payload
    ) external payable override returns (uint64) {
        require(amount > 0, "Amount must be > 0");
        require(token != address(0), "Invalid token");

        // Transfer tokens to this contract (lock them)
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // Increment sequence
        uint64 currentSequence = sequence++;

        // Store pending transfer
        pendingTransfers[currentSequence] = PendingTransfer({
            token: token,
            amount: amount,
            recipient: recipient,
            payload: payload,
            targetChain: recipientChain,
            exists: true
        });

        emit TransferInitiated(currentSequence, token, amount, recipientChain, recipient, payload);

        return currentSequence;
    }

    /**
     * @notice Complete a token transfer with payload
     * @dev In mock mode, we extract sequence from encodedVm and release tokens
     * @param encodedVm The encoded VAA (in our mock, this is just the sequence number encoded)
     */
    function completeTransferWithPayload(bytes memory encodedVm)
        external
        override
        returns (bytes memory payload)
    {
        // For simplicity, encodedVm is just the sequence number (uint64) encoded
        require(encodedVm.length == 32, "Invalid VAA format");

        uint64 seq = uint64(uint256(bytes32(encodedVm)));
        bytes32 vaaHash = keccak256(encodedVm);

        require(!completedTransfers[vaaHash], "Transfer already completed");
        require(pendingTransfers[seq].exists, "Transfer does not exist");

        PendingTransfer memory transfer = pendingTransfers[seq];

        // Mark as completed
        completedTransfers[vaaHash] = true;

        // Release tokens to recipient (convert bytes32 to address)
        address recipientAddr = address(uint160(uint256(transfer.recipient)));
        IERC20(transfer.token).transfer(recipientAddr, transfer.amount);

        emit TransferCompleted(seq, vaaHash);

        return transfer.payload;
    }

    /**
     * @notice Normalize amount to 8 decimals (Wormhole standard)
     * @dev This matches real Wormhole behavior for cross-chain transfers
     */
    function normalizeAmount(uint256 amount, uint8 decimals) external pure override returns (uint256) {
        if (decimals > 8) {
            // Truncate precision for tokens with > 8 decimals
            return amount / (10 ** (decimals - 8));
        } else {
            // Scale up for tokens with < 8 decimals
            return amount * (10 ** (8 - decimals));
        }
    }

    /**
     * @notice Denormalize amount from 8 decimals to target decimals
     */
    function denormalizeAmount(uint256 amount, uint8 decimals) external pure override returns (uint256) {
        if (decimals > 8) {
            // Scale up from 8 decimals
            return amount * (10 ** (decimals - 8));
        } else {
            // Scale down from 8 decimals
            return amount / (10 ** (8 - decimals));
        }
    }

    /**
     * @notice Check if a VAA has been redeemed
     */
    function isTransferCompleted(bytes32 hash) external view override returns (bool) {
        return completedTransfers[hash];
    }

    // ============ Helper Functions for Testing ============

    /**
     * @notice Generate a mock VAA for a given sequence
     * @dev In production, VAAs are signed by guardians. For testing, we just return the sequence.
     */
    function generateMockVAA(uint64 seq) external pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(seq)));
    }

    /**
     * @notice Get the current sequence number
     */
    function getCurrentSequence() external view returns (uint64) {
        return sequence;
    }

    /**
     * @notice Get pending transfer details
     */
    function getPendingTransfer(uint64 seq)
        external
        view
        returns (address token, uint256 amount, bytes32 recipient, bytes memory payload, uint16 targetChain)
    {
        PendingTransfer memory transfer = pendingTransfers[seq];
        require(transfer.exists, "Transfer does not exist");
        return (transfer.token, transfer.amount, transfer.recipient, transfer.payload, transfer.targetChain);
    }
}
