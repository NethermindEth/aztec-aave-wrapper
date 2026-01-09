// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IAztecOutbox} from "./interfaces/IAztecOutbox.sol";
import {IWormholeTokenBridge} from "./interfaces/IWormholeTokenBridge.sol";

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
 */
contract AztecAavePortalL1 {
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

    // ============ State ============

    /// @notice Tracks consumed intent IDs for replay protection
    mapping(bytes32 => bool) public consumedIntents;

    // ============ Errors ============

    error IntentAlreadyConsumed(bytes32 intentId);
    error InvalidSource();
    error DeadlinePassed();
    error InvalidDeadline(uint256 deadline);

    // ============ Events ============

    event DepositInitiated(
        bytes32 indexed intentId,
        address indexed asset,
        uint256 amount,
        uint16 targetChainId
    );

    event WithdrawInitiated(bytes32 indexed intentId, uint256 amount);

    event DepositConfirmed(bytes32 indexed intentId, uint256 shares);

    event WithdrawCompleted(bytes32 indexed intentId, uint256 amount);

    // ============ Constructor ============

    constructor(
        address _aztecOutbox,
        address _aztecInbox,
        address _tokenPortal,
        address _wormholeTokenBridge,
        address _wormholeRelayer,
        bytes32 _l2ContractAddress,
        uint16 _targetChainId,
        bytes32 _targetExecutor
    ) {
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
    function _validateDeadline(uint256 deadline) public view {
        uint256 timeUntilDeadline = deadline > block.timestamp ? deadline - block.timestamp : 0;

        if (timeUntilDeadline < MIN_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
        if (timeUntilDeadline > MAX_DEADLINE) {
            revert InvalidDeadline(deadline);
        }
    }

    // ============ External Functions ============

    // TODO: Implement executeDeposit
    // TODO: Implement executeWithdraw
    // TODO: Implement receiveWormholeMessages
    // TODO: Implement completeTransferWithPayload
}
