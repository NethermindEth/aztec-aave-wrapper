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
 *
 * Denormalization:
 * - Wormhole normalizes token amounts to 8 decimals for cross-chain transfers
 * - This contract denormalizes back to original decimals using originalDecimals from intent
 * - For tokens with < 8 decimals, no adjustment needed (Wormhole doesn't change them)
 * - For tokens with > 8 decimals, multiply by 10^(originalDecimals - 8)
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

    // ============ Constants ============

    /// @notice Wormhole normalizes token amounts to 8 decimals for cross-chain transfers
    uint8 public constant WORMHOLE_DECIMALS = 8;

    /// @notice Maximum length for error reason strings stored in retry queue
    uint256 private constant MAX_ERROR_REASON_LENGTH = 256;

    // ============ Errors ============

    error VAAAlreadyConsumed(bytes32 vaaHash);
    error InvalidVAA(string reason);
    error InvalidEmitterChain(uint16 expected, uint16 actual);
    error InvalidEmitterAddress(bytes32 expected, bytes32 actual);
    error DeadlinePassed(uint64 deadline, uint256 currentTime);
    error InsufficientDeposit(bytes32 intentId, address asset, uint256 requested, uint256 available);
    error ZeroAmount();
    error DenormalizationOverflow(uint256 amount, uint8 originalDecimals);
    error QueueIndexNotActive(uint256 queueIndex);
    error NotOriginalCaller(address expected, address actual);

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
     * Denormalization:
     * - Wormhole normalizes amounts to 8 decimals for tokens with > 8 decimals
     * - This function denormalizes back to original decimals before supplying to Aave
     *
     * Retry Queue:
     * - If Aave supply fails, the operation is added to the retry queue
     * - Failed operations can be retried later when conditions change
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

        // Step 10: Denormalize amount from Wormhole's 8 decimals to original decimals
        uint256 denormalizedAmount = _denormalizeAmount(intent.amount, intent.originalDecimals);

        // Step 11: Execute the Aave supply with retry queue handling
        _executeAaveSupply(intent, denormalizedAmount);
    }

    /**
     * @notice Internal function to execute Aave supply with retry queue fallback
     * @param intent The deposit intent
     * @param amount The denormalized amount to supply
     */
    function _executeAaveSupply(DepositIntent memory intent, uint256 amount) internal {
        // Approve Aave pool to spend tokens
        // Using forceApprove to handle tokens that require approval to be 0 before setting new value
        IERC20(intent.asset).forceApprove(address(aavePool), amount);

        // Try to execute Aave supply
        try aavePool.supply(intent.asset, amount, address(this), 0) {
            // Success: Track the deposit and shares
            deposits[intent.intentId][intent.asset] += amount;

            // Track per-intent shares (MVP: shares = amount, no yield accounting)
            intentShares[intent.intentId] += amount;

            // Emit success event
            emit DepositExecuted(intent.intentId, intent.ownerHash, intent.asset, amount, amount);
        } catch Error(string memory errorReason) {
            // Reset approval to 0 to prevent unintended spend of tokens held for retry
            IERC20(intent.asset).forceApprove(address(aavePool), 0);
            // Aave reverted with a reason string - add to retry queue
            _addToRetryQueue(intent, amount, errorReason);
        } catch (bytes memory) {
            // Reset approval to 0 to prevent unintended spend of tokens held for retry
            IERC20(intent.asset).forceApprove(address(aavePool), 0);
            // Aave reverted without a reason or with custom error - add to retry queue
            _addToRetryQueue(intent, amount, "Aave supply failed");
        }
    }

    /**
     * @notice Add a failed deposit operation to the retry queue
     * @param intent The deposit intent that failed
     * @param amount The denormalized amount
     * @param errorReason The error reason (truncated if too long)
     */
    function _addToRetryQueue(DepositIntent memory intent, uint256 amount, string memory errorReason) internal {
        // Truncate error reason if too long using assembly for gas efficiency
        string memory truncatedReason = errorReason;
        uint256 reasonLength = bytes(errorReason).length;
        if (reasonLength > MAX_ERROR_REASON_LENGTH) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // Update the length field of the string to truncate it in place
                // This is safe because we're reducing the length, not increasing it
                mstore(errorReason, MAX_ERROR_REASON_LENGTH)
            }
            truncatedReason = errorReason;
        }

        // Create failed operation record
        uint256 queueIndex = nextQueueIndex++;
        failedOperations[queueIndex] = FailedOperation({
            operationType: OperationType.Deposit,
            intentId: intent.intentId,
            ownerHash: intent.ownerHash,
            asset: intent.asset,
            amount: amount,
            failedAt: block.timestamp,
            retryCount: 0,
            originalCaller: msg.sender,
            errorReason: truncatedReason
        });

        queueLength++;

        emit OperationQueued(queueIndex, intent.intentId, OperationType.Deposit, intent.asset, amount, msg.sender);
    }

    /**
     * @notice Denormalize amount from Wormhole's 8 decimals to original token decimals
     * @dev Wormhole normalizes tokens with > 8 decimals by dividing by 10^(decimals-8)
     *      We reverse this by multiplying by 10^(decimals-8)
     *      Tokens with <= 8 decimals are not modified by Wormhole
     * @param amount The Wormhole-normalized amount (up to 8 decimals)
     * @param originalDecimals The original token decimals
     * @return The denormalized amount in original token decimals
     */
    function _denormalizeAmount(uint128 amount, uint8 originalDecimals) internal pure returns (uint256) {
        // Tokens with <= 8 decimals are not normalized by Wormhole
        if (originalDecimals <= WORMHOLE_DECIMALS) {
            return uint256(amount);
        }

        // For tokens with > 8 decimals, multiply by 10^(originalDecimals - 8)
        uint256 decimalDiff = uint256(originalDecimals - WORMHOLE_DECIMALS);

        // Check for potential overflow before multiplication
        // Max uint128 is ~3.4e38, max scaling is 10^10 (18-8 decimals), so ~3.4e48 fits in uint256
        uint256 scaleFactor = 10 ** decimalDiff;
        uint256 result = uint256(amount) * scaleFactor;

        // Sanity check: result should not wrap around (would indicate overflow)
        if (result / scaleFactor != uint256(amount)) {
            revert DenormalizationOverflow(amount, originalDecimals);
        }

        return result;
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

    /**
     * @notice Retry a failed operation from the queue
     * @dev Only the original caller who initiated the operation can retry it.
     *      This ensures accountability and allows for proper gas cost tracking.
     *
     * On success:
     * - Operation is removed from the queue
     * - For deposits: tokens are supplied to Aave and tracked in deposits/intentShares
     * - OperationRetried event is emitted
     *
     * On failure:
     * - Operation stays in the queue with incremented retryCount
     * - Error reason is updated
     * - OperationQueued event is emitted with updated info
     *
     * @param queueIndex The index of the failed operation in the queue
     */
    function retryFailedOperation(uint256 queueIndex) external {
        // Step 1: Verify queue index has an active operation
        FailedOperation storage failedOp = failedOperations[queueIndex];
        if (failedOp.intentId == bytes32(0)) {
            revert QueueIndexNotActive(queueIndex);
        }

        // Step 2: Verify caller is the original caller
        if (msg.sender != failedOp.originalCaller) {
            revert NotOriginalCaller(failedOp.originalCaller, msg.sender);
        }

        // Step 3: Handle based on operation type
        if (failedOp.operationType == OperationType.Deposit) {
            _retryDeposit(queueIndex, failedOp);
        }
        // Note: Withdraw retry would be added here when needed
    }

    /**
     * @notice Internal function to retry a failed deposit operation
     * @param queueIndex The queue index for event emission
     * @param failedOp The failed operation data (storage reference)
     */
    function _retryDeposit(uint256 queueIndex, FailedOperation storage failedOp) internal {
        // Cache all values needed for events and state updates BEFORE any potential storage deletion
        // This ensures we don't read from storage after _removeFromQueue deletes the entry
        bytes32 intentId = failedOp.intentId;
        bytes32 ownerHash = failedOp.ownerHash;
        address asset = failedOp.asset;
        uint256 amount = failedOp.amount;
        uint256 retryCount = failedOp.retryCount + 1;

        // Approve Aave pool to spend tokens
        IERC20(asset).forceApprove(address(aavePool), amount);

        // Try to execute Aave supply
        try aavePool.supply(asset, amount, address(this), 0) {
            // Success: Track the deposit and shares
            deposits[intentId][asset] += amount;
            intentShares[intentId] += amount;

            // Emit success event (using cached values)
            emit DepositExecuted(intentId, ownerHash, asset, amount, amount);
            emit OperationRetried(queueIndex, intentId, retryCount);

            // Remove from queue (safe to delete now since we cached all needed values)
            _removeFromQueue(queueIndex);
        } catch Error(string memory errorReason) {
            // Reset approval
            IERC20(asset).forceApprove(address(aavePool), 0);
            // Update failed operation with new error and increment retry count
            _updateFailedOperation(queueIndex, failedOp, errorReason);
        } catch (bytes memory) {
            // Reset approval
            IERC20(asset).forceApprove(address(aavePool), 0);
            // Update failed operation with generic error
            _updateFailedOperation(queueIndex, failedOp, "Aave supply failed");
        }
    }

    /**
     * @notice Update a failed operation after a retry attempt fails
     * @param queueIndex The queue index
     * @param failedOp The failed operation data
     * @param errorReason The new error reason
     */
    function _updateFailedOperation(uint256 queueIndex, FailedOperation storage failedOp, string memory errorReason)
        internal
    {
        // Truncate error reason if too long
        string memory truncatedReason = errorReason;
        uint256 reasonLength = bytes(errorReason).length;
        if (reasonLength > MAX_ERROR_REASON_LENGTH) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                mstore(errorReason, MAX_ERROR_REASON_LENGTH)
            }
            truncatedReason = errorReason;
        }

        // Update the failed operation
        failedOp.retryCount += 1;
        failedOp.failedAt = block.timestamp;
        failedOp.errorReason = truncatedReason;

        // Emit event to indicate retry failed but operation is still queued
        emit OperationQueued(
            queueIndex, failedOp.intentId, failedOp.operationType, failedOp.asset, failedOp.amount, failedOp.originalCaller
        );
    }

    /**
     * @notice Remove a successfully retried operation from the queue
     * @param queueIndex The queue index to remove
     */
    function _removeFromQueue(uint256 queueIndex) internal {
        bytes32 intentId = failedOperations[queueIndex].intentId;

        // Clear the storage slot
        delete failedOperations[queueIndex];

        // Decrement queue length
        queueLength--;

        emit OperationRemoved(queueIndex, intentId);
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

    /**
     * @notice Get the current value of a position for an intent
     * @dev Calculates the current value including any accrued yield from Aave
     *      For MVP: shares = principal, but current value may differ due to Aave yield
     *
     * The calculation is:
     *   currentValue = (intentShares * normalizedIncome) / RAY
     *
     * where normalizedIncome is the reserve's liquidity index that grows over time
     * as interest accrues.
     *
     * @param intentId The intent ID to query
     * @param asset The underlying asset address
     * @return shares The number of shares held for this intent (principal deposited)
     * @return currentValue The current value of the position including yield
     */
    function getPositionValue(bytes32 intentId, address asset)
        external
        view
        returns (uint256 shares, uint256 currentValue)
    {
        shares = intentShares[intentId];

        if (shares == 0) {
            return (0, 0);
        }

        // Get the normalized income (liquidity index) from Aave pool
        // This represents 1 + accumulated interest rate, in RAY format (1e27)
        uint256 normalizedIncome = aavePool.getReserveNormalizedIncome(asset);

        // Calculate current value: shares * normalizedIncome / RAY
        // RAY = 1e27, represents 1.0 in Aave's math
        // At deposit time, normalizedIncome was captured implicitly (shares = amount)
        // Current value grows as normalizedIncome increases
        currentValue = _rayMul(shares, normalizedIncome);
    }

    /**
     * @notice Get the aToken address for a given asset
     * @dev Retrieves the aToken address from Aave pool's reserve data
     * @param asset The underlying asset address
     * @return aTokenAddress The aToken address for the asset
     */
    function getATokenAddress(address asset) external view returns (address aTokenAddress) {
        (
            , // configuration
            , // liquidityIndex
            , // currentLiquidityRate
            , // variableBorrowIndex
            , // currentVariableBorrowRate
            , // currentStableBorrowRate
            , // lastUpdateTimestamp
            , // id
            aTokenAddress,
            , // stableDebtTokenAddress
            , // variableDebtTokenAddress
            , // interestRateStrategyAddress
            , // accruedToTreasury
            , // unbacked
            // isolationModeTotalDebt
        ) = aavePool.getReserveData(asset);
    }

    /**
     * @notice Get the total aToken balance held by this contract for an asset
     * @dev This is the aggregate of all positions across all intents
     *      Useful for reconciliation and monitoring
     * @param asset The underlying asset address
     * @return totalShares The total shares (scaled balance) held
     * @return totalValue The total current value including yield
     */
    function getTotalPositionValue(address asset) external view returns (uint256 totalShares, uint256 totalValue) {
        // Get aToken address from reserve data
        (
            , // configuration
            , // liquidityIndex
            , // currentLiquidityRate
            , // variableBorrowIndex
            , // currentVariableBorrowRate
            , // currentStableBorrowRate
            , // lastUpdateTimestamp
            , // id
            address aTokenAddress,
            , // stableDebtTokenAddress
            , // variableDebtTokenAddress
            , // interestRateStrategyAddress
            , // accruedToTreasury
            , // unbacked
            // isolationModeTotalDebt
        ) = aavePool.getReserveData(asset);

        if (aTokenAddress == address(0)) {
            return (0, 0);
        }

        // Get scaled balance (shares) - requires calling the aToken directly
        // The IERC20 balanceOf on aToken returns current value including yield
        totalValue = IERC20(aTokenAddress).balanceOf(address(this));

        // Calculate shares from current value using normalized income
        uint256 normalizedIncome = aavePool.getReserveNormalizedIncome(asset);
        if (normalizedIncome > 0) {
            totalShares = _rayDiv(totalValue, normalizedIncome);
        }
    }

    // ============ Internal Math Functions ============

    /// @dev RAY = 1e27, used in Aave's fixed-point math
    uint256 internal constant RAY = 1e27;

    /// @dev Half RAY for rounding
    uint256 internal constant HALF_RAY = RAY / 2;

    /**
     * @notice Multiplies two values in RAY precision, rounding half up
     * @param a First value
     * @param b Second value in RAY
     * @return Result of a * b / RAY
     */
    function _rayMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) {
            return 0;
        }
        return (a * b + HALF_RAY) / RAY;
    }

    /**
     * @notice Divides two values in RAY precision, rounding half up
     * @param a Numerator
     * @param b Denominator in RAY
     * @return Result of a * RAY / b
     */
    function _rayDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        // Return 0 if numerator is 0 (valid case)
        if (a == 0) {
            return 0;
        }
        // Division by zero should revert (indicates an error in caller logic)
        require(b != 0, "Division by zero");
        return (a * RAY + b / 2) / b;
    }
}
