// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";
import { WithdrawTokenPayload, WithdrawTokenPayloadLib } from "../contracts/types/Intent.sol";
import { IWormholeTokenBridge } from "../contracts/interfaces/IWormholeTokenBridge.sol";
import { ITokenPortal } from "../contracts/interfaces/ITokenPortal.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Portal.completeWithdrawal Tests
 * @notice Comprehensive tests for completeWithdrawalTransfer function covering:
 * - Successful token receipt and deposit to L2
 * - VAA replay protection
 * - Token portal deposit verification
 * - Error cases (no tokens, invalid payload, etc.)
 */
contract PortalCompleteWithdrawalTest is Test {
    AztecAavePortalL1 public portal;

    // Mock contracts
    MockWormholeTokenBridge public wormholeTokenBridge;
    MockTokenPortal public tokenPortal;
    MockERC20 public mockToken;

    // Mock addresses
    address public aztecOutbox = makeAddr("aztecOutbox");
    address public aztecInbox = makeAddr("aztecInbox");
    address public wormholeRelayer = makeAddr("wormholeRelayer");
    bytes32 public l2ContractAddress = bytes32(uint256(0x123456));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(0xABCDEF));

    // Test data
    bytes32 public testIntentId = keccak256("test_withdraw_intent");
    bytes32 public testOwnerHash = keccak256(abi.encode(makeAddr("user")));
    bytes32 public testSecretHash = keccak256("user_secret");
    uint256 public testAmount = 1000e18;

    function setUp() public {
        // Deploy mock contracts
        mockToken = new MockERC20("Test Token", "TEST");
        wormholeTokenBridge = new MockWormholeTokenBridge(mockToken);
        tokenPortal = new MockTokenPortal(address(mockToken));

        // Deploy portal
        portal = new AztecAavePortalL1(
            aztecOutbox,
            aztecInbox,
            address(tokenPortal),
            address(wormholeTokenBridge),
            wormholeRelayer,
            l2ContractAddress,
            targetChainId,
            targetExecutor
        );
    }

    // ============ Success Cases ============

    function test_completeWithdrawal_Success() public {
        // Setup: Create withdrawal payload and mock VAA
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);

        // Setup mock to return tokens and payload
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(1))); // Mock VAA

        // Execute completion
        (bytes32 returnedIntentId, uint256 returnedAmount) =
            portal.completeWithdrawalTransfer(mockVAA);

        // Verify return values
        assertEq(returnedIntentId, testIntentId);
        assertEq(returnedAmount, testAmount);

        // Verify VAA was marked as processed
        assertTrue(portal.processedVAAs(keccak256(mockVAA)));

        // Verify token portal received the deposit
        assertTrue(tokenPortal.depositCalled());
        assertEq(tokenPortal.lastAmount(), testAmount);
        assertEq(tokenPortal.lastSecretHash(), testSecretHash);
    }

    function test_completeWithdrawal_EmitsEvents() public {
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(2)));

        // Expect WithdrawalTokensReceived event
        vm.expectEmit(true, true, false, true);
        emit AztecAavePortalL1.WithdrawalTokensReceived(
            testIntentId, address(mockToken), testAmount, testSecretHash
        );

        // Expect TokensDepositedToL2 event
        vm.expectEmit(true, false, false, false);
        emit AztecAavePortalL1.TokensDepositedToL2(testIntentId, bytes32(0), 0);

        portal.completeWithdrawalTransfer(mockVAA);
    }

    function test_completeWithdrawal_AnyoneCanComplete() public {
        // Test that any address can complete the transfer
        address randomCaller = makeAddr("randomCaller");

        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(3)));

        vm.prank(randomCaller);
        (bytes32 returnedIntentId, uint256 returnedAmount) =
            portal.completeWithdrawalTransfer(mockVAA);

        assertEq(returnedIntentId, testIntentId);
        assertEq(returnedAmount, testAmount);
    }

    function test_completeWithdrawal_MultipleWithdrawals() public {
        // Test multiple distinct withdrawals can be completed
        bytes32 intentId1 = keccak256("intent_1");
        bytes32 intentId2 = keccak256("intent_2");

        // First withdrawal
        WithdrawTokenPayload memory payload1 = WithdrawTokenPayload({
            intentId: intentId1,
            ownerHash: testOwnerHash,
            secretHash: keccak256("secret_1"),
            asset: address(mockToken)
        });

        wormholeTokenBridge.setupTransfer(
            1000e18, WithdrawTokenPayloadLib.encode(payload1), address(portal)
        );
        bytes memory vaa1 = abi.encodePacked(bytes32(uint256(10)));

        (bytes32 returned1,) = portal.completeWithdrawalTransfer(vaa1);
        assertEq(returned1, intentId1);

        // Second withdrawal
        WithdrawTokenPayload memory payload2 = WithdrawTokenPayload({
            intentId: intentId2,
            ownerHash: testOwnerHash,
            secretHash: keccak256("secret_2"),
            asset: address(mockToken)
        });

        wormholeTokenBridge.setupTransfer(
            2000e18, WithdrawTokenPayloadLib.encode(payload2), address(portal)
        );
        bytes memory vaa2 = abi.encodePacked(bytes32(uint256(11)));

        (bytes32 returned2,) = portal.completeWithdrawalTransfer(vaa2);
        assertEq(returned2, intentId2);

        // Both VAAs should be marked as processed
        assertTrue(portal.processedVAAs(keccak256(vaa1)));
        assertTrue(portal.processedVAAs(keccak256(vaa2)));
    }

    // ============ Replay Protection ============

    function test_completeWithdrawal_RevertIf_VAAReplayed() public {
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(4)));

        // First completion succeeds
        portal.completeWithdrawalTransfer(mockVAA);

        // Setup for second attempt (would succeed if not for replay protection)
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        // Second attempt with same VAA should fail
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.VAAlreadyProcessed.selector, keccak256(mockVAA)
            )
        );
        portal.completeWithdrawalTransfer(mockVAA);
    }

    function test_completeWithdrawal_ReplayCheckBeforeBridgeCall() public {
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(5)));

        // First completion
        portal.completeWithdrawalTransfer(mockVAA);

        uint256 bridgeCallsBefore = wormholeTokenBridge.completeCallCount();

        // Second attempt - should fail before calling bridge
        vm.expectRevert(
            abi.encodeWithSelector(
                AztecAavePortalL1.VAAlreadyProcessed.selector, keccak256(mockVAA)
            )
        );
        portal.completeWithdrawalTransfer(mockVAA);

        // Verify bridge was not called on replay attempt
        assertEq(wormholeTokenBridge.completeCallCount(), bridgeCallsBefore);
    }

    // ============ Error Cases ============

    function test_completeWithdrawal_RevertIf_NoTokensReceived() public {
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);

        // Setup with zero tokens
        wormholeTokenBridge.setupTransfer(0, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(6)));

        vm.expectRevert("No tokens received from bridge");
        portal.completeWithdrawalTransfer(mockVAA);
    }

    function test_completeWithdrawal_RevertIf_BridgeReverts() public {
        // Don't setup transfer - bridge will revert
        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(7)));

        vm.expectRevert("Transfer not setup");
        portal.completeWithdrawalTransfer(mockVAA);
    }

    // ============ Token Portal Integration ============

    function test_completeWithdrawal_ApprovestokenPortal() public {
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(8)));

        portal.completeWithdrawalTransfer(mockVAA);

        // Verify approval was given (mock token tracks this)
        assertEq(mockToken.allowance(address(portal), address(tokenPortal)), 0); // Spent during deposit
        assertTrue(tokenPortal.depositCalled());
    }

    function test_completeWithdrawal_UsesPrivateDeposit() public {
        // Verify that depositToAztecPrivate is used (not public)
        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(testAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(9)));

        portal.completeWithdrawalTransfer(mockVAA);

        // Mock tracks which function was called
        assertTrue(tokenPortal.privateDepositCalled());
        assertFalse(tokenPortal.publicDepositCalled());
    }

    // ============ Edge Cases ============

    function test_completeWithdrawal_SmallAmount() public {
        uint256 smallAmount = 1; // 1 wei

        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(smallAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(100)));

        (bytes32 returnedIntentId, uint256 returnedAmount) =
            portal.completeWithdrawalTransfer(mockVAA);

        assertEq(returnedAmount, smallAmount);
        assertEq(returnedIntentId, testIntentId);
    }

    function test_completeWithdrawal_LargeAmount() public {
        uint256 largeAmount = type(uint128).max; // Max uint128

        WithdrawTokenPayload memory payload = WithdrawTokenPayload({
            intentId: testIntentId,
            ownerHash: testOwnerHash,
            secretHash: testSecretHash,
            asset: address(mockToken)
        });

        bytes memory encodedPayload = WithdrawTokenPayloadLib.encode(payload);
        wormholeTokenBridge.setupTransfer(largeAmount, encodedPayload, address(portal));

        bytes memory mockVAA = abi.encodePacked(bytes32(uint256(101)));

        (bytes32 returnedIntentId, uint256 returnedAmount) =
            portal.completeWithdrawalTransfer(mockVAA);

        assertEq(returnedAmount, largeAmount);
        assertEq(returnedIntentId, testIntentId);
    }
}

// ============ Mock Contracts ============

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;

    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    uint256 private _totalSupply;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(
        address account
    ) external view override returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        allowances[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }

    // Test helper to mint tokens
    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        _totalSupply += amount;
    }
}

contract MockWormholeTokenBridge is IWormholeTokenBridge {
    MockERC20 public token;
    uint256 public pendingAmount;
    bytes public pendingPayload;
    address public pendingRecipient;
    bool public transferSetup;
    uint256 public completeCallCount;

    constructor(
        MockERC20 _token
    ) {
        token = _token;
    }

    function setupTransfer(uint256 amount, bytes memory payload, address recipient) external {
        pendingAmount = amount;
        pendingPayload = payload;
        pendingRecipient = recipient;
        transferSetup = true;
    }

    function transferTokensWithPayload(
        address,
        uint256,
        uint16,
        bytes32,
        uint32,
        bytes memory
    ) external payable override returns (uint64) {
        return 0;
    }

    function completeTransferWithPayload(
        bytes memory
    ) external override returns (bytes memory) {
        require(transferSetup, "Transfer not setup");
        completeCallCount++;

        // Mint tokens to recipient (simulating bridge release)
        if (pendingAmount > 0) {
            token.mint(pendingRecipient, pendingAmount);
        }

        bytes memory payload = pendingPayload;

        // Reset for next transfer
        transferSetup = false;
        pendingAmount = 0;
        pendingPayload = "";
        pendingRecipient = address(0);

        return payload;
    }

    function normalizeAmount(
        uint256 amount,
        uint8 decimals
    ) external pure override returns (uint256) {
        if (decimals > 8) {
            return amount / (10 ** (decimals - 8));
        }
        return amount * (10 ** (8 - decimals));
    }

    function denormalizeAmount(
        uint256 amount,
        uint8 decimals
    ) external pure override returns (uint256) {
        if (decimals > 8) {
            return amount * (10 ** (decimals - 8));
        }
        return amount / (10 ** (8 - decimals));
    }

    function isTransferCompleted(
        bytes32
    ) external pure override returns (bool) {
        return false;
    }
}

contract MockTokenPortal is ITokenPortal {
    address public immutable token;
    bool public depositCalled;
    bool public privateDepositCalled;
    bool public publicDepositCalled;
    uint256 public lastAmount;
    bytes32 public lastSecretHash;
    bytes32 public lastRecipient;
    uint256 private messageCount;

    constructor(
        address _token
    ) {
        token = _token;
    }

    function depositToAztecPublic(
        bytes32 _to,
        uint256 _amount,
        bytes32 _secretHash
    ) external override returns (bytes32 messageKey, uint256 messageIndex) {
        depositCalled = true;
        publicDepositCalled = true;
        lastRecipient = _to;
        lastAmount = _amount;
        lastSecretHash = _secretHash;

        // Transfer tokens from caller
        IERC20(token).transferFrom(msg.sender, address(this), _amount);

        messageCount++;
        return (keccak256(abi.encode(_to, _amount, _secretHash)), messageCount);
    }

    function depositToAztecPrivate(
        uint256 _amount,
        bytes32 _secretHashForL2MessageConsumption
    ) external override returns (bytes32 messageKey, uint256 messageIndex) {
        depositCalled = true;
        privateDepositCalled = true;
        lastAmount = _amount;
        lastSecretHash = _secretHashForL2MessageConsumption;

        // Transfer tokens from caller
        IERC20(token).transferFrom(msg.sender, address(this), _amount);

        messageCount++;
        return (keccak256(abi.encode(_amount, _secretHashForL2MessageConsumption)), messageCount);
    }

    function underlying() external view override returns (address) {
        return token;
    }
}
