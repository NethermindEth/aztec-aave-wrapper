// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ITokenPortal} from "./interfaces/ITokenPortal.sol";
import {IAztecInbox} from "./interfaces/IAztecInbox.sol";
import {IAztecOutbox} from "./interfaces/IAztecOutbox.sol";
import {DataStructures} from "./libraries/DataStructures.sol";
import {Hash} from "./libraries/Hash.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title TokenPortal
 * @notice Token bridge portal for L1<->L2 token transfers between Ethereum and Aztec
 * @dev Follows Aztec's reference token bridge pattern. Tokens are locked on L1
 *      when depositing to L2, and released when withdrawing from L2.
 *
 * Architecture:
 * - depositToAztecPublic: Lock tokens, send L1->L2 message with public recipient
 * - depositToAztecPrivate: Lock tokens, send L1->L2 message for private claim
 * - withdraw: Consume L2->L1 message, release locked tokens
 *
 * Message Flow:
 * - Deposits: L1 locks tokens -> L1->L2 message -> L2 mints bridged tokens
 * - Withdrawals: L2 burns tokens -> L2->L1 message -> L1 releases tokens
 *
 * The secretHash mechanism ensures atomic L1<->L2 operations:
 * - L1 includes secretHash in L1->L2 messages
 * - L2 user must know the preimage (secret) to claim tokens
 */
contract TokenPortal is ITokenPortal, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    /// @notice The underlying ERC20 token this portal handles
    address public immutable override UNDERLYING;

    /// @notice Aztec L1->L2 message inbox
    address public immutable INBOX;

    /// @notice Aztec L2->L1 message outbox
    address public immutable OUTBOX;

    /// @notice Aztec instance version (read from inbox at construction)
    uint256 public immutable AZTEC_VERSION;

    // ============ Mutable State ============

    /// @notice The L2 bridge contract address on Aztec
    /// @dev Made settable to handle deployment ordering (TokenPortal must be deployed before BridgedToken
    ///      since BridgedToken needs the TokenPortal address, but TokenPortal needs BridgedToken address)
    bytes32 public l2Bridge;

    // ============ State ============

    /// @notice Authorized callers that can withdraw tokens without L2->L1 message proof
    /// @dev Used by AavePortal which consumes L2->L1 deposit intent messages directly
    mapping(address => bool) public authorizedWithdrawers;

    // ============ Events ============

    event DepositToAztecPublic(
        bytes32 indexed to,
        uint256 amount,
        bytes32 secretHash,
        bytes32 messageKey,
        uint256 messageIndex
    );

    event DepositToAztecPrivate(uint256 amount, bytes32 secretHash, bytes32 messageKey, uint256 messageIndex);

    event WithdrawFromAztec(address indexed recipient, uint256 amount);

    event AuthorizedWithdrawerSet(address indexed withdrawer, bool authorized);

    event L2BridgeSet(bytes32 indexed l2Bridge);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidWithdrawAmount();
    error UnauthorizedWithdrawer();
    error L2BridgeNotSet();
    error L2BridgeAlreadySet();

    // ============ Constructor ============

    /**
     * @notice Initialize the token portal
     * @param _underlying The ERC20 token this portal handles
     * @param _inbox Aztec L1->L2 message inbox address
     * @param _outbox Aztec L2->L1 message outbox address
     * @param _l2Bridge The L2 bridge contract address on Aztec
     * @param _authorizedWithdrawer Initial authorized withdrawer (e.g., AavePortal)
     * @param _initialOwner The initial owner of this contract
     */
    constructor(
        address _underlying,
        address _inbox,
        address _outbox,
        bytes32 _l2Bridge,
        address _authorizedWithdrawer,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (_underlying == address(0) || _inbox == address(0) || _outbox == address(0)) {
            revert ZeroAddress();
        }
        UNDERLYING = _underlying;
        INBOX = _inbox;
        OUTBOX = _outbox;
        l2Bridge = _l2Bridge;
        AZTEC_VERSION = IAztecInbox(_inbox).VERSION();
        if (_authorizedWithdrawer != address(0)) {
            authorizedWithdrawers[_authorizedWithdrawer] = true;
        }
    }

    // ============ Deposit Functions ============

    /**
     * @notice Deposit tokens to a public Aztec L2 balance
     * @dev Locks tokens on L1 and sends L1->L2 message with visible recipient
     * @param _to Recipient address on L2 (as bytes32)
     * @param _amount Amount of tokens to deposit
     * @param _secretHash Hash of secret for L1->L2 message consumption on L2
     * @return messageKey The key of the L1->L2 message
     * @return messageIndex The index of the message in the L2 message tree
     *
     * Message content encoding: sha256ToField([recipient, amount, secretHash])
     * This matches the expected format on the L2 bridge contract.
     */
    function depositToAztecPublic(
        bytes32 _to,
        uint256 _amount,
        bytes32 _secretHash
    ) external override returns (bytes32 messageKey, uint256 messageIndex) {
        if (_amount == 0) {
            revert ZeroAmount();
        }
        if (l2Bridge == bytes32(0)) {
            revert L2BridgeNotSet();
        }

        // Lock tokens on L1 (transfer from sender to this contract)
        IERC20(UNDERLYING).safeTransferFrom(msg.sender, address(this), _amount);

        // Compute message content: public mint includes recipient in content
        bytes32 content = Hash.sha256ToField(abi.encodePacked(_to, _amount, _secretHash));

        // Send L1->L2 message
        DataStructures.L2Actor memory recipient = DataStructures.L2Actor({actor: l2Bridge, version: AZTEC_VERSION});

        (messageKey, messageIndex) = IAztecInbox(INBOX).sendL2Message(recipient, content, _secretHash);

        emit DepositToAztecPublic(_to, _amount, _secretHash, messageKey, messageIndex);
    }

    /**
     * @notice Deposit tokens to a private Aztec L2 balance
     * @dev Locks tokens on L1 and sends L1->L2 message without visible recipient.
     *      The recipient claims using the secret preimage on L2.
     * @param _amount Amount of tokens to deposit
     * @param _secretHashForL2MessageConsumption Hash of secret for claiming on L2
     * @return messageKey The key of the L1->L2 message
     * @return messageIndex The index of the message in the L2 message tree
     *
     * Message content encoding: sha256ToField([amount, secretHash])
     * No recipient is included for privacy - only the secret holder can claim.
     */
    function depositToAztecPrivate(
        uint256 _amount,
        bytes32 _secretHashForL2MessageConsumption
    ) external override returns (bytes32 messageKey, uint256 messageIndex) {
        if (_amount == 0) {
            revert ZeroAmount();
        }
        if (l2Bridge == bytes32(0)) {
            revert L2BridgeNotSet();
        }

        // Lock tokens on L1 (transfer from sender to this contract)
        IERC20(UNDERLYING).safeTransferFrom(msg.sender, address(this), _amount);

        // Compute message content: private mint doesn't include recipient
        bytes32 content = Hash.sha256ToField(abi.encodePacked(_amount, _secretHashForL2MessageConsumption));

        // Send L1->L2 message
        DataStructures.L2Actor memory recipient = DataStructures.L2Actor({actor: l2Bridge, version: AZTEC_VERSION});

        (messageKey, messageIndex) = IAztecInbox(INBOX).sendL2Message(
            recipient,
            content,
            _secretHashForL2MessageConsumption
        );

        emit DepositToAztecPrivate(_amount, _secretHashForL2MessageConsumption, messageKey, messageIndex);
    }

    // ============ Withdraw Functions ============

    /**
     * @notice Withdraw tokens from Aztec L2 to L1
     * @dev Consumes L2->L1 message and releases locked tokens to recipient.
     *      The withdrawal must be authorized by consuming a valid L2->L1 message.
     * @param _recipient The L1 address to receive the tokens
     * @param _amount Amount of tokens to withdraw
     * @param _withCaller Whether the withdrawal was initiated with a specific caller restriction
     * @param _l2BlockNumber The L2 block number where the message was created
     * @param _leafIndex The index of the message in the L2 block's message tree
     * @param _siblingPath Merkle proof path from leaf to root
     *
     * Message content encoding must match L2 burn message:
     * - If _withCaller: sha256ToField([recipient, amount, caller])
     * - If !_withCaller: sha256ToField([recipient, amount, 0])
     *
     * The _withCaller flag allows L2 users to restrict who can execute their withdrawal,
     * providing front-running protection when needed.
     */
    function withdraw(
        address _recipient,
        uint256 _amount,
        bool _withCaller,
        uint256 _l2BlockNumber,
        uint256 _leafIndex,
        bytes32[] calldata _siblingPath
    ) external {
        if (_recipient == address(0)) {
            revert ZeroAddress();
        }
        if (_amount == 0) {
            revert ZeroAmount();
        }

        // Compute the expected message content from L2
        // The caller field is included when _withCaller is true for front-running protection
        bytes32 callerField = _withCaller ? bytes32(uint256(uint160(msg.sender))) : bytes32(0);
        bytes32 content = Hash.sha256ToField(
            abi.encodePacked(bytes32(uint256(uint160(_recipient))), _amount, callerField)
        );

        // Construct and consume the L2->L1 message
        DataStructures.L2ToL1Msg memory message = DataStructures.L2ToL1Msg({
            sender: DataStructures.L2Actor({actor: l2Bridge, version: AZTEC_VERSION}),
            recipient: DataStructures.L1Actor({actor: address(this), chainId: block.chainid}),
            content: content
        });

        IAztecOutbox(OUTBOX).consume(message, _l2BlockNumber, _leafIndex, _siblingPath);

        // Release tokens to recipient
        IERC20(UNDERLYING).safeTransfer(_recipient, _amount);

        emit WithdrawFromAztec(_recipient, _amount);
    }

    /**
     * @notice Withdraw tokens to an authorized caller without L2->L1 message proof
     * @dev Used by AavePortal which has already consumed the L2->L1 deposit intent message.
     *      The L2 contract burns tokens and sends a deposit intent to AavePortal.
     *      AavePortal consumes that message and then calls this function to claim tokens.
     * @param _amount Amount of tokens to withdraw
     * @param _recipient Address to receive the tokens
     */
    function withdraw(uint256 _amount, address _recipient) external override {
        if (!authorizedWithdrawers[msg.sender]) {
            revert UnauthorizedWithdrawer();
        }
        if (_recipient == address(0)) {
            revert ZeroAddress();
        }
        if (_amount == 0) {
            revert ZeroAmount();
        }

        // Release tokens to recipient
        IERC20(UNDERLYING).safeTransfer(_recipient, _amount);

        emit WithdrawFromAztec(_recipient, _amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set or revoke authorized withdrawer status for an address
     * @dev Only callable by owner. Used to authorize contracts (like AavePortal) to withdraw tokens
     *      without L2->L1 message proof.
     * @param _withdrawer Address to authorize or deauthorize
     * @param _authorized Whether the address should be authorized
     */
    function setAuthorizedWithdrawer(address _withdrawer, bool _authorized) external onlyOwner {
        if (_withdrawer == address(0)) {
            revert ZeroAddress();
        }
        authorizedWithdrawers[_withdrawer] = _authorized;
        emit AuthorizedWithdrawerSet(_withdrawer, _authorized);
    }

    /**
     * @notice Set the L2 bridge contract address
     * @dev Only callable by owner. Required to set after deployment since BridgedToken
     *      needs TokenPortal address for initialization (circular dependency).
     *      Can only be set once to prevent malicious changes after tokens are bridged.
     * @param _l2Bridge The L2 BridgedToken contract address on Aztec (as bytes32)
     */
    function setL2Bridge(bytes32 _l2Bridge) external onlyOwner {
        if (_l2Bridge == bytes32(0)) {
            revert ZeroAddress();
        }
        if (l2Bridge != bytes32(0)) {
            revert L2BridgeAlreadySet();
        }
        l2Bridge = _l2Bridge;
        emit L2BridgeSet(_l2Bridge);
    }
}
