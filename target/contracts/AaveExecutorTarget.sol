// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ILendingPool} from "./interfaces/ILendingPool.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";
import {WormholeParser} from "./libraries/WormholeParser.sol";
import {DepositIntent, WithdrawIntent, IntentLib} from "./types/Intent.sol";
import {FailedOperation, OperationType} from "./types/FailedOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AaveExecutorTarget
 * @notice Executes Aave V3 operations on the target chain on behalf of Aztec users
 * @dev This contract receives cross-chain messages from the L1 portal via Wormhole
 *      and executes corresponding Aave operations (supply, withdraw).
 *
 * Architecture Overview:
 * - Aztec L2 -> L1 Portal -> Wormhole -> This Contract -> Aave V3 Pool
 * - Each intent is identified by intentId for tracking
 * - aTokens are held by this contract on behalf of users (custodial model)
 *
 * Security Features:
 * - VAA verification via Wormhole core contract
 * - Replay protection via consumedVAAs mapping
 * - Emitter address verification (only accepts from registered L1 portal)
 */
contract AaveExecutorTarget {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    /// @notice Aave V3 Pool contract
    ILendingPool public immutable aavePool;

    /// @notice Wormhole core contract for VAA verification
    IWormhole public immutable wormhole;

    /// @notice L1 Portal address in bytes32 format (Wormhole emitter address)
    bytes32 public immutable l1PortalAddress;

    /// @notice Expected source chain ID (Wormhole chain ID of L1)
    uint16 public immutable sourceChainId;

    // ============ State ============

    /// @notice Mapping from VAA hash to consumed status for replay protection
    /// @dev CRITICAL: Must be set BEFORE external calls to prevent reentrancy
    mapping(bytes32 => bool) public consumedVAAs;

    /// @notice Mapping from intentId to deposit amounts per asset
    mapping(bytes32 => mapping(address => uint256)) public deposits;

    /// @notice Mapping from queue index to failed operation data
    /// @dev Unlimited queue - indices are never reused after removal
    mapping(uint256 => FailedOperation) public failedOperations;

    /// @notice Mapping from intentId to aToken shares held for that intent
    /// @dev Tracks the actual aToken shares per intent for accurate withdrawal calculations
    mapping(bytes32 => uint256) public intentShares;

    /// @notice Counter for the next queue index (monotonically increasing)
    uint256 public nextQueueIndex;

    /// @notice Total number of operations currently in the queue
    uint256 public queueLength;

    // ============ Events ============

    /// @notice Emitted when a deposit (supply) operation is executed
    event DepositExecuted(
        bytes32 indexed intentId, bytes32 indexed ownerHash, address indexed asset, uint256 amount, uint256 shares
    );

    /// @notice Emitted when a withdraw operation is executed
    event WithdrawExecuted(
        bytes32 indexed intentId, bytes32 indexed ownerHash, address indexed asset, uint256 amount
    );

    /// @notice Emitted when an operation is added to the retry queue
    event OperationQueued(
        uint256 indexed queueIndex,
        bytes32 indexed intentId,
        OperationType operationType,
        address asset,
        uint256 amount,
        address originalCaller
    );

    /// @notice Emitted when a queued operation is retried successfully
    event OperationRetried(uint256 indexed queueIndex, bytes32 indexed intentId, uint256 retryCount);

    /// @notice Emitted when a queued operation is removed from the queue
    event OperationRemoved(uint256 indexed queueIndex, bytes32 indexed intentId);

    // ============ Errors ============

    error VAAAlreadyConsumed(bytes32 vaaHash);
    error InvalidVAA(string reason);
    error InvalidEmitterChain(uint16 expected, uint16 actual);
    error InvalidEmitterAddress(bytes32 expected, bytes32 actual);
    error DeadlinePassed(uint64 deadline, uint256 currentTime);
    error InsufficientDeposit(bytes32 intentId, address asset, uint256 requested, uint256 available);
    error ZeroAmount();

    // ============ Constructor ============

    /**
     * @notice Constructor
     * @param _aavePool Address of the Aave V3 Pool contract
     * @param _wormhole Address of the Wormhole core contract
     * @param _l1PortalAddress Address of the L1 portal (bytes32 format)
     * @param _sourceChainId Wormhole chain ID of the source chain (L1)
     */
    constructor(address _aavePool, address _wormhole, bytes32 _l1PortalAddress, uint16 _sourceChainId) {
        aavePool = ILendingPool(_aavePool);
        wormhole = IWormhole(_wormhole);
        l1PortalAddress = _l1PortalAddress;
        sourceChainId = _sourceChainId;
    }

    // ============ External Functions ============

    /**
     * @notice Execute a deposit operation by consuming a Wormhole VAA
     * @dev This function is called to process deposits bridged from L1
     *
     * Security checks:
     * 1. Verify VAA signatures via Wormhole core contract
     * 2. Check VAA hasn't been consumed (replay protection)
     * 3. Verify emitter chain and address match expected L1 portal
     * 4. Verify deadline hasn't passed
     *
     * @param encodedVAA The encoded Wormhole VAA containing the deposit intent
     */
    function consumeAndExecuteDeposit(bytes calldata encodedVAA) external {
        // Step 1: Compute VAA hash for replay protection
        bytes32 vaaHash = WormholeParser.computeVAAHash(encodedVAA);

        // Step 2: Check for replay attack
        if (consumedVAAs[vaaHash]) {
            revert VAAAlreadyConsumed(vaaHash);
        }

        // Step 3: Verify VAA via Wormhole core contract
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(encodedVAA);

        if (!valid) {
            revert InvalidVAA(reason);
        }

        // Step 4: Verify emitter chain matches expected source chain
        if (vm.emitterChainId != sourceChainId) {
            revert InvalidEmitterChain(sourceChainId, vm.emitterChainId);
        }

        // Step 5: Verify emitter address matches expected L1 portal
        if (vm.emitterAddress != l1PortalAddress) {
            revert InvalidEmitterAddress(l1PortalAddress, vm.emitterAddress);
        }

        // Step 6: Mark VAA as consumed BEFORE external calls (reentrancy protection)
        consumedVAAs[vaaHash] = true;

        // Step 7: Decode the deposit intent from payload
        DepositIntent memory intent = IntentLib.decodeDepositIntent(vm.payload);

        // Step 8: Verify deadline hasn't passed
        // Using > instead of >= to allow execution at exact deadline timestamp
        if (block.timestamp > intent.deadline) {
            revert DeadlinePassed(intent.deadline, block.timestamp);
        }

        // Step 9: Verify amount is non-zero
        if (intent.amount == 0) {
            revert ZeroAmount();
        }

        // Step 10: Execute the Aave supply
        // Note: Tokens should have been bridged atomically with the VAA via Wormhole Token Bridge
        // The caller is responsible for ensuring tokens are available
        // Using forceApprove to handle tokens that require approval to be 0 before setting new value
        IERC20(intent.asset).forceApprove(address(aavePool), intent.amount);
        aavePool.supply(intent.asset, intent.amount, address(this), 0);

        // Step 11: Track the deposit
        deposits[intent.intentId][intent.asset] += intent.amount;

        // Step 12: Emit event (note: shares = amount for MVP simplification)
        emit DepositExecuted(intent.intentId, intent.ownerHash, intent.asset, intent.amount, intent.amount);
    }

    /**
     * @notice Execute a withdrawal operation by consuming a Wormhole VAA
     * @dev This function is called to process withdrawals requested from L2
     *
     * Security checks:
     * 1. Verify VAA signatures via Wormhole core contract
     * 2. Check VAA hasn't been consumed (replay protection)
     * 3. Verify emitter chain and address match expected L1 portal
     * 4. Verify deadline hasn't passed
     * 5. Verify sufficient deposit exists
     *
     * @param encodedVAA The encoded Wormhole VAA containing the withdraw intent
     * @param asset The asset to withdraw (must match the deposited asset)
     */
    function consumeAndExecuteWithdraw(bytes calldata encodedVAA, address asset) external {
        // Step 1: Compute VAA hash for replay protection
        bytes32 vaaHash = WormholeParser.computeVAAHash(encodedVAA);

        // Step 2: Check for replay attack
        if (consumedVAAs[vaaHash]) {
            revert VAAAlreadyConsumed(vaaHash);
        }

        // Step 3: Verify VAA via Wormhole core contract
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(encodedVAA);

        if (!valid) {
            revert InvalidVAA(reason);
        }

        // Step 4: Verify emitter chain matches expected source chain
        if (vm.emitterChainId != sourceChainId) {
            revert InvalidEmitterChain(sourceChainId, vm.emitterChainId);
        }

        // Step 5: Verify emitter address matches expected L1 portal
        if (vm.emitterAddress != l1PortalAddress) {
            revert InvalidEmitterAddress(l1PortalAddress, vm.emitterAddress);
        }

        // Step 6: Mark VAA as consumed BEFORE external calls (reentrancy protection)
        consumedVAAs[vaaHash] = true;

        // Step 7: Decode the withdraw intent from payload
        WithdrawIntent memory intent = IntentLib.decodeWithdrawIntent(vm.payload);

        // Step 8: Verify deadline hasn't passed
        // Using > instead of >= to allow execution at exact deadline timestamp
        if (block.timestamp > intent.deadline) {
            revert DeadlinePassed(intent.deadline, block.timestamp);
        }

        // Step 9: Verify amount is non-zero
        if (intent.amount == 0) {
            revert ZeroAmount();
        }

        // Step 10: Verify sufficient deposit exists
        uint256 depositedAmount = deposits[intent.intentId][asset];
        if (depositedAmount < intent.amount) {
            revert InsufficientDeposit(intent.intentId, asset, intent.amount, depositedAmount);
        }

        // Step 11: Update deposit tracking BEFORE external calls
        deposits[intent.intentId][asset] -= intent.amount;

        // Step 12: Execute the Aave withdrawal
        uint256 withdrawn = aavePool.withdraw(asset, intent.amount, address(this));

        // Step 13: Emit event
        emit WithdrawExecuted(intent.intentId, intent.ownerHash, asset, withdrawn);

        // Note: The withdrawn tokens need to be bridged back to L1 via Wormhole Token Bridge
        // This would be handled in a separate function or by the caller
    }

    // ============ View Functions ============

    /**
     * @notice Check if a VAA has been consumed
     * @param vaaHash The hash of the VAA to check
     * @return True if the VAA has been consumed
     */
    function isVAAConsumed(bytes32 vaaHash) external view returns (bool) {
        return consumedVAAs[vaaHash];
    }

    /**
     * @notice Get the deposited amount for an intent
     * @param intentId The intent ID
     * @param asset The asset address
     * @return The deposited amount
     */
    function getDeposit(bytes32 intentId, address asset) external view returns (uint256) {
        return deposits[intentId][asset];
    }

    /**
     * @notice Get a failed operation from the queue
     * @param queueIndex The index in the queue
     * @return The failed operation data
     */
    function getFailedOperation(uint256 queueIndex) external view returns (FailedOperation memory) {
        return failedOperations[queueIndex];
    }

    /**
     * @notice Get the aToken shares for an intent
     * @param intentId The intent ID
     * @return The aToken shares held for this intent
     */
    function getIntentShares(bytes32 intentId) external view returns (uint256) {
        return intentShares[intentId];
    }

    /**
     * @notice Check if a queue index has an active failed operation
     * @param queueIndex The index to check
     * @return True if the index has an active operation (non-zero intentId)
     */
    function isQueueIndexActive(uint256 queueIndex) external view returns (bool) {
        return failedOperations[queueIndex].intentId != bytes32(0);
    }
}
