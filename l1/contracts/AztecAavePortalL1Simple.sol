// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { IAztecOutbox } from "./interfaces/IAztecOutbox.sol";
import { IAztecInbox } from "./interfaces/IAztecInbox.sol";
import { ILendingPool } from "./interfaces/ILendingPool.sol";
import { DepositIntent, WithdrawIntent, IntentLib } from "./types/Intent.sol";
import { ITokenPortal } from "./interfaces/ITokenPortal.sol";
import { ConfirmationStatus } from "./types/Confirmation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AztecAavePortalL1Simple
 * @notice Simplified portal contract that calls Aave directly on L1 without Wormhole bridging
 * @dev This contract is a simplified version of AztecAavePortalL1 for same-chain Aave integration.
 *      Instead of bridging to a target chain via Wormhole, it directly interacts with Aave on L1.
 *
 * Architecture:
 * - Receives deposit/withdraw intents from Aztec L2 outbox
 * - Executes Aave supply/withdraw directly on L1
 * - Sends L1->L2 messages to Aztec for finalization
 *
 * Differences from AztecAavePortalL1:
 * - No Wormhole token bridge or relayer
 * - No target chain executor
 * - Synchronous Aave operations
 * - Holds aTokens directly (this contract is the position holder)
 *
 * Security features:
 * - Ownable2Step: Two-step ownership transfer to prevent accidental transfers
 * - Pausable: Admin can pause new operations while allowing in-flight operations to complete
 * - Emergency withdraw: Admin can recover stuck tokens in emergency situations
 */
contract AztecAavePortalL1Simple is Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    /// @notice Aztec L2->L1 message outbox
    address public immutable aztecOutbox;

    /// @notice Aztec L1->L2 message inbox
    address public immutable aztecInbox;

    /// @notice Aztec token portal for L1<->L2 token bridging
    address public immutable tokenPortal;

    /// @notice Aave V3 lending pool
    address public immutable aavePool;

    /// @notice L2 contract address on Aztec
    bytes32 public immutable l2ContractAddress;

    // ============ Deadline Configuration ============

    /// @notice Minimum allowed deadline (5 minutes)
    uint256 public constant MIN_DEADLINE = 5 minutes;

    /// @notice Maximum allowed deadline (24 hours)
    uint256 public constant MAX_DEADLINE = 24 hours;

    // ============ State ============

    /// @notice Tracks consumed intent IDs for replay protection
    mapping(bytes32 => bool) public consumedIntents;

    /// @notice Tracks shares per intent ID for withdrawal accounting
    /// @dev Maps intentId -> shares received from Aave (aToken balance)
    mapping(bytes32 => uint128) public intentShares;

    /// @notice Tracks asset per intent ID for withdrawal
    /// @dev Maps intentId -> asset address
    mapping(bytes32 => address) public intentAssets;

    // ============ Errors ============

    error IntentAlreadyConsumed(bytes32 intentId);
    error DeadlinePassed();
    error InvalidDeadline(uint256 deadline);
    error L2MessageSendFailed();
    error TokenPortalDepositFailed();
    error TokenTransferFailed();
    error ZeroAddress();
    error NoSharesForIntent(bytes32 intentId);
    error AaveSupplyFailed();
    error AaveWithdrawFailed();

    // ============ Events ============

    event DepositExecuted(
        bytes32 indexed intentId, address indexed asset, uint256 amount, uint256 shares
    );

    event WithdrawExecuted(bytes32 indexed intentId, address indexed asset, uint256 amount);

    event DepositConfirmed(bytes32 indexed intentId, uint256 shares, ConfirmationStatus status);

    event WithdrawConfirmed(bytes32 indexed intentId, uint256 amount, ConfirmationStatus status);

    event L2MessageSent(bytes32 indexed intentId, bytes32 messageLeaf);

    event TokensDepositedToL2(bytes32 indexed intentId, bytes32 messageKey, uint256 messageIndex);

    // ============ Constructor ============

    constructor(
        address _aztecOutbox,
        address _aztecInbox,
        address _tokenPortal,
        address _aavePool,
        bytes32 _l2ContractAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (
            _aztecOutbox == address(0) || _aztecInbox == address(0) || _tokenPortal == address(0)
                || _aavePool == address(0)
        ) {
            revert ZeroAddress();
        }
        aztecOutbox = _aztecOutbox;
        aztecInbox = _aztecInbox;
        tokenPortal = _tokenPortal;
        aavePool = _aavePool;
        l2ContractAddress = _l2ContractAddress;
    }

    // ============ Internal Functions ============

    /**
     * @notice Validate that a deadline is within acceptable bounds
     * @param deadline The deadline timestamp to validate
     */
    function _validateDeadline(
        uint256 deadline
    ) internal view {
        uint256 timeUntilDeadline = deadline > block.timestamp ? deadline - block.timestamp : 0;

        if (timeUntilDeadline < MIN_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
        if (timeUntilDeadline > MAX_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
    }

    /**
     * @notice Get the aToken address for an asset from Aave
     * @param asset The underlying asset address
     * @return aTokenAddress The aToken address
     */
    function _getATokenAddress(
        address asset
    ) internal view returns (address aTokenAddress) {
        (,,,,,,,, aTokenAddress,,,,,,) = ILendingPool(aavePool).getReserveData(asset);
    }

    // ============ External Functions ============

    /**
     * @notice Execute a deposit intent by consuming L2->L1 message and supplying to Aave
     * @param intent The deposit intent from L2
     * @param l2BlockNumber The L2 block number where the message was created
     * @param leafIndex The index of the message in the L2 block's message tree
     * @param siblingPath Merkle proof path from leaf to root
     * @dev This function can be called by anyone (relayer model)
     *
     * Flow:
     * 1. Validate deadline is within acceptable bounds
     * 2. Consume L2->L1 message from Aztec outbox with proof
     * 3. Check for replay attacks
     * 4. Supply tokens to Aave directly
     * 5. Send L1->L2 confirmation message
     *
     * Privacy: Uses ownerHash instead of owner address to prevent identity linkage
     */
    function executeDeposit(
        DepositIntent calldata intent,
        uint256 l2BlockNumber,
        uint256 leafIndex,
        bytes32[] calldata siblingPath
    ) external whenNotPaused {
        // Step 1: Check for replay attack first (cheapest check)
        if (consumedIntents[intent.intentId]) {
            revert IntentAlreadyConsumed(intent.intentId);
        }

        // Step 2: Check deadline hasn't passed
        if (block.timestamp >= intent.deadline) {
            revert DeadlinePassed();
        }

        // Step 3: Validate deadline is within acceptable bounds
        _validateDeadline(intent.deadline);

        // Step 4: Compute message hash for outbox consumption
        bytes32 messageHash = IntentLib.hashDepositIntent(intent);

        // Step 5: Consume the L2->L1 message from Aztec outbox
        bool consumed =
            IAztecOutbox(aztecOutbox).consume(messageHash, l2BlockNumber, leafIndex, siblingPath);
        require(consumed, "Failed to consume outbox message");

        // Step 6: Mark intent as consumed for replay protection
        consumedIntents[intent.intentId] = true;

        // Step 7: Get aToken balance before supply
        address aToken = _getATokenAddress(intent.asset);
        uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));

        // Step 8: Approve Aave pool to spend tokens
        // Tokens should already be on this contract (transferred via token portal)
        bool approveSuccess = IERC20(intent.asset).approve(aavePool, intent.amount);
        require(approveSuccess, "Token approval failed");

        // Step 9: Supply tokens to Aave (this contract receives aTokens)
        ILendingPool(aavePool).supply(
            intent.asset,
            intent.amount,
            address(this), // aTokens go to this contract
            0 // referral code
        );

        // Step 10: Calculate shares received (aToken balance difference)
        uint256 aTokenBalanceAfter = IERC20(aToken).balanceOf(address(this));
        uint128 shares = uint128(aTokenBalanceAfter - aTokenBalanceBefore);

        if (shares == 0) {
            revert AaveSupplyFailed();
        }

        // Step 11: Store shares for this intent (for withdrawal tracking)
        intentShares[intent.intentId] = shares;
        intentAssets[intent.intentId] = intent.asset;

        emit DepositExecuted(intent.intentId, intent.asset, intent.amount, shares);

        // Step 12: Send L1->L2 confirmation message
        bytes32 messageContent = _computeDepositFinalizationMessage(
            intent.intentId, intent.ownerHash, ConfirmationStatus.SUCCESS, shares, intent.asset
        );

        bytes32 messageLeaf =
            IAztecInbox(aztecInbox).sendL2Message(l2ContractAddress, messageContent);

        emit DepositConfirmed(intent.intentId, shares, ConfirmationStatus.SUCCESS);
        emit L2MessageSent(intent.intentId, messageLeaf);
    }

    /**
     * @notice Execute a withdrawal intent by consuming L2->L1 message and withdrawing from Aave
     * @param intent The withdrawal intent from L2
     * @param secretHash The secret hash for L2 token claiming
     * @param l2BlockNumber The L2 block number where the message was created
     * @param leafIndex The index of the message in the L2 block's message tree
     * @param siblingPath Merkle proof path from leaf to root
     * @dev This function can be called by anyone (relayer model)
     *
     * Flow:
     * 1. Validate deadline is within acceptable bounds
     * 2. Consume L2->L1 message from Aztec outbox with proof
     * 3. Check for replay attacks
     * 4. Withdraw from Aave
     * 5. Deposit tokens to L2 via token portal
     * 6. Send L1->L2 confirmation message
     *
     * Privacy: Uses ownerHash instead of owner address to prevent identity linkage
     */
    function executeWithdraw(
        WithdrawIntent calldata intent,
        bytes32 secretHash,
        uint256 l2BlockNumber,
        uint256 leafIndex,
        bytes32[] calldata siblingPath
    ) external whenNotPaused {
        // Step 1: Check for replay attack first
        if (consumedIntents[intent.intentId]) {
            revert IntentAlreadyConsumed(intent.intentId);
        }

        // Step 2: Check deadline hasn't passed
        if (block.timestamp >= intent.deadline) {
            revert DeadlinePassed();
        }

        // Step 3: Validate deadline is within acceptable bounds
        _validateDeadline(intent.deadline);

        // Step 4: Check we have shares for this intent
        uint128 shares = intentShares[intent.intentId];
        if (shares == 0) {
            revert NoSharesForIntent(intent.intentId);
        }

        address asset = intentAssets[intent.intentId];

        // Step 5: Compute message hash for outbox consumption
        bytes32 messageHash = IntentLib.hashWithdrawIntent(intent);

        // Step 6: Consume the L2->L1 message from Aztec outbox
        bool consumed =
            IAztecOutbox(aztecOutbox).consume(messageHash, l2BlockNumber, leafIndex, siblingPath);
        require(consumed, "Failed to consume outbox message");

        // Step 7: Mark intent as consumed for replay protection
        consumedIntents[intent.intentId] = true;

        // Step 8: Clear shares for this intent (full withdrawal)
        delete intentShares[intent.intentId];
        delete intentAssets[intent.intentId];

        // Step 9: Withdraw from Aave (withdraw full aToken balance for this intent)
        // Note: In MVP, we track shares per intent, so we withdraw the exact shares
        uint256 withdrawnAmount = ILendingPool(aavePool).withdraw(
            asset,
            shares, // Withdraw the shares we tracked
            address(this)
        );

        if (withdrawnAmount == 0) {
            revert AaveWithdrawFailed();
        }

        emit WithdrawExecuted(intent.intentId, asset, withdrawnAmount);

        // Step 10: Approve token portal and deposit to L2
        IERC20(asset).approve(tokenPortal, 0);
        bool approveSuccess = IERC20(asset).approve(tokenPortal, withdrawnAmount);
        if (!approveSuccess) {
            revert TokenTransferFailed();
        }

        (bytes32 messageKey, uint256 messageIndex) =
            ITokenPortal(tokenPortal).depositToAztecPrivate(withdrawnAmount, secretHash);

        emit TokensDepositedToL2(intent.intentId, messageKey, messageIndex);

        // Step 11: Send L1->L2 confirmation message
        bytes32 messageContent = _computeWithdrawFinalizationMessage(
            intent.intentId,
            intent.ownerHash,
            ConfirmationStatus.SUCCESS,
            uint128(withdrawnAmount),
            asset
        );

        bytes32 messageLeaf =
            IAztecInbox(aztecInbox).sendL2Message(l2ContractAddress, messageContent);

        emit WithdrawConfirmed(intent.intentId, withdrawnAmount, ConfirmationStatus.SUCCESS);
        emit L2MessageSent(intent.intentId, messageLeaf);
    }

    // ============ Internal Helper Functions ============

    /**
     * @notice Compute the message content for deposit finalization on L2
     * @param intentId The intent ID
     * @param ownerHash The hashed owner address
     * @param status The confirmation status
     * @param shares The number of shares received
     * @param asset The asset address
     * @return The message content hash
     */
    function _computeDepositFinalizationMessage(
        bytes32 intentId,
        bytes32 ownerHash,
        ConfirmationStatus status,
        uint128 shares,
        address asset
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint8(0), // Action type: deposit finalization
                intentId,
                ownerHash,
                uint8(status),
                shares,
                asset
            )
        );
    }

    /**
     * @notice Compute the message content for withdraw finalization on L2
     * @param intentId The intent ID
     * @param ownerHash The hashed owner address
     * @param status The confirmation status
     * @param amount The amount withdrawn
     * @param asset The asset address
     * @return The message content hash
     */
    function _computeWithdrawFinalizationMessage(
        bytes32 intentId,
        bytes32 ownerHash,
        ConfirmationStatus status,
        uint128 amount,
        address asset
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint8(1), // Action type: withdraw finalization
                intentId,
                ownerHash,
                uint8(status),
                amount,
                asset
            )
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get the shares tracked for an intent
     * @param intentId The intent ID
     * @return shares The number of shares
     */
    function getIntentShares(
        bytes32 intentId
    ) external view returns (uint128) {
        return intentShares[intentId];
    }

    /**
     * @notice Get the asset tracked for an intent
     * @param intentId The intent ID
     * @return asset The asset address
     */
    function getIntentAsset(
        bytes32 intentId
    ) external view returns (address) {
        return intentAssets[intentId];
    }

    // ============ Admin Functions ============

    /**
     * @notice Pause new deposit and withdraw operations
     * @dev Only callable by owner.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume deposit and withdraw operations
     * @dev Only callable by owner.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency function to recover stuck tokens
     * @dev Only callable by owner.
     * @param token The ERC20 token to withdraw
     * @param to The recipient address
     * @param amount The amount to withdraw
     */
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // ============ Admin Events ============

    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);
}
