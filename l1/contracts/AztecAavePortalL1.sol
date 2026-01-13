// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { IAztecOutbox } from "./interfaces/IAztecOutbox.sol";
import { IAztecInbox } from "./interfaces/IAztecInbox.sol";
import { IWormholeTokenBridge } from "./interfaces/IWormholeTokenBridge.sol";
import { IWormholeRelayer } from "./interfaces/IWormholeRelayer.sol";
import {
    DepositIntent,
    WithdrawIntent,
    IntentLib,
    WithdrawTokenPayload,
    WithdrawTokenPayloadLib
} from "./types/Intent.sol";
import { ITokenPortal } from "./interfaces/ITokenPortal.sol";
import {
    DepositConfirmation,
    WithdrawConfirmation,
    ConfirmationStatus,
    ConfirmationLib
} from "./types/Confirmation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AztecAavePortalL1
 * @notice Portal contract bridging Aztec L2 to Wormhole for Aave interactions
 * @dev Consumes L2->L1 messages from Aztec and bridges to target chain via Wormhole
 *
 * Architecture:
 * - Receives deposit/withdraw intents from Aztec L2 outbox
 * - Bridges tokens + payloads to target chain executor via Wormhole
 * - Receives confirmations back from target chain
 * - Sends L1->L2 messages to Aztec for finalization
 *
 * Security features:
 * - Ownable2Step: Two-step ownership transfer to prevent accidental transfers
 * - Pausable: Admin can pause new operations while allowing in-flight operations to complete
 * - Emergency withdraw: Admin can recover stuck tokens in emergency situations
 */
contract AztecAavePortalL1 is Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    /// @notice Aztec L2->L1 message outbox
    address public immutable aztecOutbox;

    /// @notice Aztec L1->L2 message inbox
    address public immutable aztecInbox;

    /// @notice Aztec token portal for L1<->L2 token bridging
    address public immutable tokenPortal;

    /// @notice Wormhole token bridge for cross-chain token transfers
    address public immutable wormholeTokenBridge;

    /// @notice Wormhole generic relayer for message passing
    address public immutable wormholeRelayer;

    /// @notice L2 contract address on Aztec
    bytes32 public immutable l2ContractAddress;

    /// @notice Wormhole chain ID of target chain (e.g., 23 for Arbitrum)
    uint16 public immutable targetChainId;

    /// @notice Address of executor contract on target chain
    bytes32 public immutable targetExecutor;

    // ============ Deadline Configuration ============

    /// @notice Minimum allowed deadline (5 minutes)
    uint256 public constant MIN_DEADLINE = 5 minutes;

    /// @notice Maximum allowed deadline (24 hours)
    uint256 public constant MAX_DEADLINE = 24 hours;

    // ============ Wormhole Configuration ============

    /// @notice Gas limit for executing operations on target chain
    /// @dev 200k should be sufficient for Aave withdraw + token bridge
    uint256 public constant TARGET_GAS_LIMIT = 200_000;

    // ============ State ============

    /// @notice Tracks consumed intent IDs for replay protection
    mapping(bytes32 => bool) public consumedIntents;

    /// @notice Tracks processed Wormhole delivery hashes for replay protection
    mapping(bytes32 => bool) public processedDeliveries;

    /// @notice Tracks processed VAA hashes for token bridge replay protection
    mapping(bytes32 => bool) public processedVAAs;

    // ============ Errors ============

    error IntentAlreadyConsumed(bytes32 intentId);
    error InvalidSource();
    error DeadlinePassed();
    error InvalidDeadline(uint256 deadline);
    error UnauthorizedRelayer(address caller);
    error InvalidSourceChain(uint16 sourceChain);
    error InvalidSourceAddress(bytes32 sourceAddress);
    error DeliveryAlreadyProcessed(bytes32 deliveryHash);
    error ConfirmationFailed(bytes32 intentId);
    error L2MessageSendFailed();
    error VAAlreadyProcessed(bytes32 vaaHash);
    error TokenPortalDepositFailed();
    error InvalidPayloadAsset(address expected, address received);
    error TokenTransferFailed();
    error ZeroAddress();

    // ============ Events ============

    event DepositInitiated(
        bytes32 indexed intentId, address indexed asset, uint256 amount, uint16 targetChainId
    );

    event WithdrawInitiated(bytes32 indexed intentId, uint256 amount);

    event DepositConfirmed(bytes32 indexed intentId, uint256 shares, ConfirmationStatus status);

    event WithdrawConfirmed(bytes32 indexed intentId, uint256 amount, ConfirmationStatus status);

    event L2MessageSent(bytes32 indexed intentId, bytes32 messageLeaf);

    event WithdrawalTokensReceived(
        bytes32 indexed intentId, address indexed asset, uint256 amount, bytes32 secretHash
    );

    event TokensDepositedToL2(bytes32 indexed intentId, bytes32 messageKey, uint256 messageIndex);

    // ============ Constructor ============

    constructor(
        address _aztecOutbox,
        address _aztecInbox,
        address _tokenPortal,
        address _wormholeTokenBridge,
        address _wormholeRelayer,
        bytes32 _l2ContractAddress,
        uint16 _targetChainId,
        bytes32 _targetExecutor,
        address _initialOwner
    ) Ownable(_initialOwner) {
        // Note: _initialOwner validation is handled by Ownable constructor
        if (
            _aztecOutbox == address(0) || _aztecInbox == address(0) || _tokenPortal == address(0)
                || _wormholeTokenBridge == address(0) || _wormholeRelayer == address(0)
        ) {
            revert ZeroAddress();
        }
        aztecOutbox = _aztecOutbox;
        aztecInbox = _aztecInbox;
        tokenPortal = _tokenPortal;
        wormholeTokenBridge = _wormholeTokenBridge;
        wormholeRelayer = _wormholeRelayer;
        l2ContractAddress = _l2ContractAddress;
        targetChainId = _targetChainId;
        targetExecutor = _targetExecutor;
    }

    // ============ Internal Functions ============

    /**
     * @notice Validate that a deadline is within acceptable bounds
     * @param deadline The deadline timestamp to validate
     * @dev Public for testing; will be made internal when used in executeDeposit/executeWithdraw
     */
    function _validateDeadline(
        uint256 deadline
    ) public view {
        uint256 timeUntilDeadline = deadline > block.timestamp ? deadline - block.timestamp : 0;

        if (timeUntilDeadline < MIN_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
        if (timeUntilDeadline > MAX_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
    }

    // ============ External Functions ============

    /**
     * @notice Execute a deposit intent by consuming L2->L1 message and bridging to target chain
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
     * 4. Bridge tokens to target chain via Wormhole with intent payload
     *
     * Privacy: Uses ownerHash instead of owner address to prevent identity linkage
     */
    function executeDeposit(
        DepositIntent calldata intent,
        uint256 l2BlockNumber,
        uint256 leafIndex,
        bytes32[] calldata siblingPath
    ) external payable whenNotPaused {
        // Step 1: Check for replay attack first (cheapest check, prevents wasted computation)
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
        // Must match the L2 encoding exactly
        bytes32 messageHash = IntentLib.hashDepositIntent(intent);

        // Step 5: Consume the L2->L1 message from Aztec outbox
        // This will revert if the message doesn't exist or proof is invalid
        bool consumed =
            IAztecOutbox(aztecOutbox).consume(messageHash, l2BlockNumber, leafIndex, siblingPath);
        require(consumed, "Failed to consume outbox message");

        // Step 6: Mark intent as consumed for replay protection
        // CRITICAL: Must be set BEFORE external calls to prevent reentrancy
        consumedIntents[intent.intentId] = true;

        // Step 7: Approve Wormhole token bridge to spend tokens
        // Tokens should already be on L1 via token portal withdrawal
        bool approveSuccess = IERC20(intent.asset).approve(wormholeTokenBridge, intent.amount);
        require(approveSuccess, "Token approval failed");

        // Step 8: Bridge tokens + payload to target executor via Wormhole
        // Using transferTokensWithPayload for atomic delivery
        bytes memory payload = IntentLib.encodeDepositIntent(intent);

        // Note: msg.value should cover Wormhole fees
        IWormholeTokenBridge(wormholeTokenBridge).transferTokensWithPayload{ value: msg.value }(
            intent.asset,
            intent.amount,
            targetChainId,
            targetExecutor,
            uint32(uint256(intent.intentId)), // Use intentId as nonce
            payload
        );

        emit DepositInitiated(intent.intentId, intent.asset, intent.amount, targetChainId);
    }

    /**
     * @notice Execute a withdrawal intent by consuming L2->L1 message and sending to target chain
     * @param intent The withdrawal intent from L2
     * @param l2BlockNumber The L2 block number where the message was created
     * @param leafIndex The index of the message in the L2 block's message tree
     * @param siblingPath Merkle proof path from leaf to root
     * @dev This function can be called by anyone (relayer model)
     *
     * Flow:
     * 1. Validate deadline is within acceptable bounds
     * 2. Consume L2->L1 message from Aztec outbox with proof
     * 3. Check for replay attacks
     * 4. Send withdrawal request to target chain via Wormhole Relayer
     *
     * Privacy: Uses ownerHash instead of owner address to prevent identity linkage
     *
     * Note: Unlike deposits, withdrawals use Wormhole Relayer (not Token Bridge) since
     * no tokens are sent from L1 to target - the target executor will withdraw from Aave
     * and bridge tokens back via Token Bridge.
     */
    function executeWithdraw(
        WithdrawIntent calldata intent,
        uint256 l2BlockNumber,
        uint256 leafIndex,
        bytes32[] calldata siblingPath
    ) external payable whenNotPaused {
        // Step 1: Check for replay attack first (cheapest check, prevents wasted computation)
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
        // Must match the L2 encoding exactly
        bytes32 messageHash = IntentLib.hashWithdrawIntent(intent);

        // Step 5: Consume the L2->L1 message from Aztec outbox
        // This will revert if the message doesn't exist or proof is invalid
        bool consumed =
            IAztecOutbox(aztecOutbox).consume(messageHash, l2BlockNumber, leafIndex, siblingPath);
        require(consumed, "Failed to consume outbox message");

        // Step 6: Mark intent as consumed for replay protection
        // CRITICAL: Must be set BEFORE external calls to prevent reentrancy
        consumedIntents[intent.intentId] = true;

        // Step 7: Encode withdrawal payload for target executor
        bytes memory payload = IntentLib.encodeWithdrawIntent(intent);

        // Step 8: Send withdrawal request to target chain via Wormhole Relayer
        // Note: msg.value should cover Wormhole relayer fees
        // We use sendPayloadToEvm since we're only sending a message (no tokens)
        // The target executor will withdraw from Aave and bridge tokens back
        IWormholeRelayer(wormholeRelayer).sendPayloadToEvm{ value: msg.value }(
            targetChainId,
            _bytes32ToAddress(targetExecutor),
            payload,
            0, // receiverValue - no native tokens needed on target
            TARGET_GAS_LIMIT
        );

        emit WithdrawInitiated(intent.intentId, intent.amount);
    }

    // ============ Internal Helper Functions ============

    /**
     * @notice Convert bytes32 to address (takes last 20 bytes)
     * @param _bytes32 The bytes32 value to convert
     * @return The address
     */
    function _bytes32ToAddress(
        bytes32 _bytes32
    ) internal pure returns (address) {
        return address(uint160(uint256(_bytes32)));
    }

    // ============ Wormhole Receiver Functions ============

    /**
     * @notice Receive Wormhole messages from the target executor
     * @dev This function is called by the Wormhole Relayer when delivering messages
     *
     * Security considerations:
     * - MUST verify caller is the registered Wormhole Relayer (impersonation attack prevention)
     * - MUST verify source chain matches expected target chain
     * - MUST verify source address is the registered target executor
     * - MUST track deliveryHash to prevent replay attacks
     *
     * @param payload The message payload containing confirmation data
     * @param additionalVaas Additional VAAs (unused in this implementation)
     * @param sourceAddress The sender address on the source chain (bytes32 format)
     * @param sourceChain The Wormhole chain ID of the source chain
     * @param deliveryHash Unique hash for this delivery (for replay protection)
     */
    function receiveWormholeMessages(
        bytes memory payload,
        bytes[] memory additionalVaas,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable {
        // Silence unused variable warning
        additionalVaas;

        // Step 1: Verify caller is the registered Wormhole Relayer
        // CRITICAL: This prevents arbitrary callers from submitting fake confirmations
        if (msg.sender != wormholeRelayer) {
            revert UnauthorizedRelayer(msg.sender);
        }

        // Step 2: Verify source chain is the expected target chain
        // CRITICAL: Prevents cross-chain replay attacks from other chains
        if (sourceChain != targetChainId) {
            revert InvalidSourceChain(sourceChain);
        }

        // Step 3: Verify source address is the registered target executor
        // CRITICAL: Prevents messages from unauthorized contracts
        if (sourceAddress != targetExecutor) {
            revert InvalidSourceAddress(sourceAddress);
        }

        // Step 4: Check for replay attacks using deliveryHash
        // CRITICAL: Each delivery must only be processed once
        if (processedDeliveries[deliveryHash]) {
            revert DeliveryAlreadyProcessed(deliveryHash);
        }

        // Step 5: Mark delivery as processed BEFORE external calls (reentrancy protection)
        processedDeliveries[deliveryHash] = true;

        // Step 6: Decode the confirmation type and process accordingly
        uint8 actionType = ConfirmationLib.getActionType(payload);

        if (actionType == 0) {
            // Deposit confirmation
            _processDepositConfirmation(payload);
        } else if (actionType == 1) {
            // Withdraw confirmation
            _processWithdrawConfirmation(payload);
        } else {
            revert("Unknown confirmation type");
        }
    }

    /**
     * @notice Process a deposit confirmation from target executor
     * @dev Decodes confirmation and sends L1→L2 message for finalization
     * @param payload The encoded DepositConfirmation
     */
    function _processDepositConfirmation(
        bytes memory payload
    ) internal {
        DepositConfirmation memory confirmation = ConfirmationLib.decodeDepositConfirmation(payload);

        // Compute L1→L2 message content for finalize_deposit
        // The L2 contract will consume this to mint the position receipt
        bytes32 messageContent = _computeDepositFinalizationMessage(
            confirmation.intentId,
            confirmation.ownerHash,
            confirmation.status,
            confirmation.shares,
            confirmation.asset
        );

        // Send L1→L2 message to Aztec inbox
        bytes32 messageLeaf =
            IAztecInbox(aztecInbox).sendL2Message(l2ContractAddress, messageContent);

        emit DepositConfirmed(confirmation.intentId, confirmation.shares, confirmation.status);
        emit L2MessageSent(confirmation.intentId, messageLeaf);
    }

    /**
     * @notice Process a withdraw confirmation from target executor
     * @dev Decodes confirmation and sends L1→L2 message for finalization
     *      Note: For withdrawals with tokens, tokens are handled separately via token bridge
     * @param payload The encoded WithdrawConfirmation
     */
    function _processWithdrawConfirmation(
        bytes memory payload
    ) internal {
        WithdrawConfirmation memory confirmation =
            ConfirmationLib.decodeWithdrawConfirmation(payload);

        // Compute L1→L2 message content for finalize_withdraw
        bytes32 messageContent = _computeWithdrawFinalizationMessage(
            confirmation.intentId,
            confirmation.ownerHash,
            confirmation.status,
            confirmation.amount,
            confirmation.asset
        );

        // Send L1→L2 message to Aztec inbox
        bytes32 messageLeaf =
            IAztecInbox(aztecInbox).sendL2Message(l2ContractAddress, messageContent);

        emit WithdrawConfirmed(confirmation.intentId, confirmation.amount, confirmation.status);
        emit L2MessageSent(confirmation.intentId, messageLeaf);
    }

    /**
     * @notice Compute the message content for deposit finalization on L2
     * @dev This hash must match what the L2 contract expects in finalize_deposit
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
     * @dev This hash must match what the L2 contract expects in finalize_withdraw
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

    // ============ Token Bridge Completion Functions ============

    /**
     * @notice Complete a withdrawal token transfer from the target chain
     * @dev This function receives tokens bridged back from the target executor
     *      via Wormhole Token Bridge and deposits them to the Aztec token portal
     *
     * Flow:
     * 1. Call Wormhole Token Bridge completeTransferWithPayload to receive tokens
     * 2. Decode the payload to get withdrawal details (intentId, secretHash, etc.)
     * 3. Approve and deposit tokens to Aztec token portal for L2 delivery
     *
     * Security considerations:
     * - VAA verification is handled by the Wormhole Token Bridge contract
     * - We track VAA hashes to prevent replay attacks at our layer (defense in depth)
     * - Tokens are deposited privately using secretHash for L2 claiming
     *
     * IMPORTANT: This contract MUST NOT hold residual tokens between transactions.
     * The balance check assumes all tokens belong to the current transfer.
     * If tokens are accidentally sent to this contract, they may be swept up
     * by the next withdrawal completion.
     *
     * @param encodedVm The encoded Wormhole VAA from the target chain
     * @return intentId The intent ID this transfer corresponds to
     * @return amount The amount of tokens received and deposited
     */
    function completeWithdrawalTransfer(
        bytes memory encodedVm
    ) external returns (bytes32 intentId, uint256 amount) {
        // Step 1: Compute VAA hash for replay protection
        bytes32 vaaHash = keccak256(encodedVm);

        // Step 2: Check for replay attacks (defense in depth - Wormhole also tracks this)
        if (processedVAAs[vaaHash]) {
            revert VAAlreadyProcessed(vaaHash);
        }

        // Step 3: Mark VAA as processed BEFORE external calls (reentrancy protection)
        // This follows checks-effects-interactions pattern
        processedVAAs[vaaHash] = true;

        // Step 4: Complete the token transfer via Wormhole Token Bridge
        // This verifies the VAA, releases tokens to this contract, and returns the payload
        bytes memory payload =
            IWormholeTokenBridge(wormholeTokenBridge).completeTransferWithPayload(encodedVm);

        // Step 5: Decode the withdrawal token payload
        WithdrawTokenPayload memory withdrawPayload = WithdrawTokenPayloadLib.decode(payload);
        intentId = withdrawPayload.intentId;
        address asset = withdrawPayload.asset;

        // Step 6: Get the token balance received
        // IMPORTANT: This assumes the contract holds no residual tokens.
        // The Wormhole Token Bridge atomically mints/releases the transfer amount.
        // All received tokens are immediately deposited to the token portal.
        amount = IERC20(asset).balanceOf(address(this));

        // Step 7: Verify we received tokens
        require(amount > 0, "No tokens received from bridge");

        emit WithdrawalTokensReceived(intentId, asset, amount, withdrawPayload.secretHash);

        // Step 8: Reset approval to 0 first, then approve the token portal to spend tokens
        // This handles tokens like USDT that require approval to be 0 before setting a new value
        IERC20(asset).approve(tokenPortal, 0);
        bool approveSuccess = IERC20(asset).approve(tokenPortal, amount);
        if (!approveSuccess) {
            revert TokenTransferFailed();
        }

        // Step 9: Deposit tokens to Aztec L2 via the token portal
        // Using depositToAztecPrivate for privacy-preserving deposits
        // The user will need to provide the matching secret on L2 to claim
        (bytes32 messageKey, uint256 messageIndex) =
            ITokenPortal(tokenPortal).depositToAztecPrivate(amount, withdrawPayload.secretHash);

        emit TokensDepositedToL2(intentId, messageKey, messageIndex);
    }

    // ============ Admin Functions ============

    /**
     * @notice Pause new deposit and withdraw operations
     * @dev Only callable by owner. Does NOT affect:
     *      - receiveWormholeMessages (allows in-flight confirmations to complete)
     *      - completeWithdrawalTransfer (allows in-flight token transfers to complete)
     *      This ensures that operations already in progress can finalize,
     *      preventing funds from being stuck in transit.
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
     * @dev Only callable by owner. This function should only be used in emergency
     *      situations where tokens are stuck in the contract due to failed operations
     *      or bugs. In production, this should be protected by a timelock or multisig.
     *
     *      IMPORTANT: This function does NOT check if tokens belong to in-flight operations.
     *      Improper use could steal user funds. Production deployments should implement
     *      additional safeguards such as:
     *      - Timelock delays
     *      - Multi-signature requirements
     *      - Tracking of expected token balances per operation
     *
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
