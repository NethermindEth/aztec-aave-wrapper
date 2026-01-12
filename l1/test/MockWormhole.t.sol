// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import { Test, console2 } from "forge-std/Test.sol";
import { MockWormholeTokenBridge } from "../contracts/mocks/MockWormholeTokenBridge.sol";
import { MockWormholeRelayer } from "../contracts/mocks/MockWormholeRelayer.sol";
import { MockWormholeCore } from "../contracts/mocks/MockWormholeCore.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Simple ERC20 for testing
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}

/**
 * @title MockWormholeTest
 * @notice Comprehensive tests for Wormhole mock contracts
 */
contract MockWormholeTest is Test {
    MockWormholeTokenBridge public tokenBridge;
    MockWormholeRelayer public relayer;
    MockWormholeCore public wormholeCore;

    MockERC20 public usdc; // 6 decimals
    MockERC20 public weth; // 18 decimals
    MockERC20 public wbtc; // 8 decimals

    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");

    uint16 public constant TARGET_CHAIN_ID = 23; // Arbitrum
    bytes32 public constant RECIPIENT =
        bytes32(uint256(uint160(0x1234567890123456789012345678901234567890)));

    function setUp() public {
        // Deploy mock contracts
        wormholeCore = new MockWormholeCore(2); // Chain ID 2 = Ethereum
        tokenBridge = new MockWormholeTokenBridge();
        relayer = new MockWormholeRelayer(address(wormholeCore));

        // Deploy test tokens with different decimals
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        wbtc = new MockERC20("Wrapped Bitcoin", "WBTC", 8);

        // Mint tokens to test users
        usdc.mint(user1, 1_000_000 * 10 ** 6); // 1M USDC
        weth.mint(user1, 1000 * 10 ** 18); // 1000 WETH
        wbtc.mint(user1, 100 * 10 ** 8); // 100 WBTC
    }

    // ============ MockWormholeCore Tests ============

    function test_WormholeCore_ChainId() public view {
        assertEq(wormholeCore.chainId(), 2);
    }

    function test_WormholeCore_MessageFee() public view {
        assertEq(wormholeCore.messageFee(), 0);
    }

    function test_WormholeCore_PublishMessage() public {
        bytes memory payload = abi.encode("test message");
        uint64 sequence = wormholeCore.publishMessage(0, payload, 1);

        assertEq(sequence, 0);
        assertEq(wormholeCore.getCurrentSequence(), 1);
    }

    function test_WormholeCore_SequenceIncrement() public {
        bytes memory payload = abi.encode("message 1");
        uint64 seq1 = wormholeCore.publishMessage(0, payload, 1);
        uint64 seq2 = wormholeCore.publishMessage(0, payload, 1);

        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(wormholeCore.getCurrentSequence(), 2);
    }

    // ============ MockWormholeTokenBridge Tests ============

    function test_TokenBridge_TransferTokens() public {
        uint256 amount = 1000 * 10 ** 6; // 1000 USDC
        bytes memory payload = abi.encode("deposit intent");

        vm.startPrank(user1);
        usdc.approve(address(tokenBridge), amount);

        uint64 sequence = tokenBridge.transferTokensWithPayload(
            address(usdc), amount, TARGET_CHAIN_ID, RECIPIENT, 0, payload
        );

        vm.stopPrank();

        assertEq(sequence, 0);
        assertEq(usdc.balanceOf(address(tokenBridge)), amount);
        assertEq(usdc.balanceOf(user1), 1_000_000 * 10 ** 6 - amount);
    }

    function test_TokenBridge_CompleteTransfer() public {
        uint256 amount = 1000 * 10 ** 6; // 1000 USDC
        bytes memory payload = abi.encode("deposit intent");

        // Step 1: Initiate transfer
        vm.startPrank(user1);
        usdc.approve(address(tokenBridge), amount);
        uint64 sequence = tokenBridge.transferTokensWithPayload(
            address(usdc), amount, TARGET_CHAIN_ID, RECIPIENT, 0, payload
        );
        vm.stopPrank();

        // Step 2: Generate VAA
        bytes memory vaa = tokenBridge.generateMockVAA(sequence);

        // Step 3: Complete transfer
        bytes memory returnedPayload = tokenBridge.completeTransferWithPayload(vaa);

        assertEq(returnedPayload, payload);
        assertEq(usdc.balanceOf(address(uint160(uint256(RECIPIENT)))), amount);
    }

    function test_TokenBridge_CannotCompleteTransferTwice() public {
        uint256 amount = 1000 * 10 ** 6;
        bytes memory payload = abi.encode("deposit intent");

        vm.startPrank(user1);
        usdc.approve(address(tokenBridge), amount);
        uint64 sequence = tokenBridge.transferTokensWithPayload(
            address(usdc), amount, TARGET_CHAIN_ID, RECIPIENT, 0, payload
        );
        vm.stopPrank();

        bytes memory vaa = tokenBridge.generateMockVAA(sequence);

        // First completion should succeed
        tokenBridge.completeTransferWithPayload(vaa);

        // Second completion should fail
        vm.expectRevert("Transfer already completed");
        tokenBridge.completeTransferWithPayload(vaa);
    }

    function test_TokenBridge_NormalizeAmount_6Decimals() public view {
        // USDC has 6 decimals, should scale up to 8
        uint256 amount = 1000 * 10 ** 6; // 1000 USDC
        uint256 normalized = tokenBridge.normalizeAmount(amount, 6);

        // Expected: 1000 * 10^8 (scaled from 6 to 8 decimals)
        assertEq(normalized, 1000 * 10 ** 8);
    }

    function test_TokenBridge_NormalizeAmount_18Decimals() public view {
        // WETH has 18 decimals, should scale down to 8
        uint256 amount = 1 * 10 ** 18; // 1 WETH
        uint256 normalized = tokenBridge.normalizeAmount(amount, 18);

        // Expected: 1 * 10^8 (scaled from 18 to 8 decimals)
        assertEq(normalized, 1 * 10 ** 8);
    }

    function test_TokenBridge_NormalizeAmount_8Decimals() public view {
        // WBTC has 8 decimals, should remain the same
        uint256 amount = 1 * 10 ** 8; // 1 WBTC
        uint256 normalized = tokenBridge.normalizeAmount(amount, 8);

        assertEq(normalized, amount);
    }

    function test_TokenBridge_DenormalizeAmount_6Decimals() public view {
        uint256 normalized = 1000 * 10 ** 8; // 1000 in 8 decimals
        uint256 denormalized = tokenBridge.denormalizeAmount(normalized, 6);

        // Expected: 1000 * 10^6 (scaled from 8 to 6 decimals)
        assertEq(denormalized, 1000 * 10 ** 6);
    }

    function test_TokenBridge_DenormalizeAmount_18Decimals() public view {
        uint256 normalized = 1 * 10 ** 8; // 1 in 8 decimals
        uint256 denormalized = tokenBridge.denormalizeAmount(normalized, 18);

        // Expected: 1 * 10^18 (scaled from 8 to 18 decimals)
        assertEq(denormalized, 1 * 10 ** 18);
    }

    function test_TokenBridge_IsTransferCompleted() public {
        uint256 amount = 1000 * 10 ** 6;
        bytes memory payload = abi.encode("test");

        vm.startPrank(user1);
        usdc.approve(address(tokenBridge), amount);
        uint64 sequence = tokenBridge.transferTokensWithPayload(
            address(usdc), amount, TARGET_CHAIN_ID, RECIPIENT, 0, payload
        );
        vm.stopPrank();

        bytes memory vaa = tokenBridge.generateMockVAA(sequence);
        bytes32 vaaHash = keccak256(vaa);

        assertFalse(tokenBridge.isTransferCompleted(vaaHash));

        tokenBridge.completeTransferWithPayload(vaa);

        assertTrue(tokenBridge.isTransferCompleted(vaaHash));
    }

    // ============ MockWormholeRelayer Tests ============

    function test_Relayer_WormholeAddress() public view {
        assertEq(relayer.wormhole(), address(wormholeCore));
    }

    function test_Relayer_QuoteDeliveryPrice() public view {
        (uint256 price, uint256 refund) = relayer.quoteEVMDeliveryPrice(TARGET_CHAIN_ID, 0, 200_000);

        assertEq(price, 0.1 ether);
        assertEq(refund, 0);
    }

    function test_Relayer_SendPayload() public {
        bytes memory payload = abi.encode("test message");
        address targetAddress = makeAddr("targetContract");

        uint64 sequence = relayer.sendPayloadToEvm{ value: 0.1 ether }(
            TARGET_CHAIN_ID, targetAddress, payload, 0, 200_000
        );

        assertEq(sequence, 0);

        (uint16 targetChain, address target, bytes memory storedPayload,,) =
            relayer.getPendingMessage(sequence);

        assertEq(targetChain, TARGET_CHAIN_ID);
        assertEq(target, targetAddress);
        assertEq(storedPayload, payload);
    }

    function test_Relayer_SendPayload_InsufficientFee() public {
        bytes memory payload = abi.encode("test");
        address targetAddress = makeAddr("target");

        vm.expectRevert("Insufficient delivery fee");
        relayer.sendPayloadToEvm{ value: 0.05 ether }(
            TARGET_CHAIN_ID, targetAddress, payload, 0, 200_000
        );
    }

    function test_Relayer_SendPayloadWithRefund() public {
        bytes memory payload = abi.encode("test message");
        address targetAddress = makeAddr("targetContract");

        uint64 sequence = relayer.sendPayloadToEvm{ value: 0.1 ether }(
            TARGET_CHAIN_ID,
            targetAddress,
            payload,
            0,
            200_000,
            2, // refund chain
            user1 // refund address
        );

        assertEq(sequence, 0);
    }

    function test_Relayer_SequenceIncrement() public {
        bytes memory payload = abi.encode("test");
        address target = makeAddr("target");

        uint64 seq1 = relayer.sendPayloadToEvm{ value: 0.1 ether }(
            TARGET_CHAIN_ID, target, payload, 0, 200_000
        );
        uint64 seq2 = relayer.sendPayloadToEvm{ value: 0.1 ether }(
            TARGET_CHAIN_ID, target, payload, 0, 200_000
        );

        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(relayer.getCurrentSequence(), 2);
    }

    // ============ Integration Tests ============

    function test_Integration_TokenBridgeWithNormalization() public {
        // Test the full flow with USDC (6 decimals)
        uint256 amount = 1000 * 10 ** 6; // 1000 USDC (6 decimals)

        // Step 1: Normalize the amount (as would happen in real Wormhole)
        uint256 normalized = tokenBridge.normalizeAmount(amount, 6);
        assertEq(normalized, 1000 * 10 ** 8); // Should be 8 decimals

        // Step 2: Transfer tokens
        vm.startPrank(user1);
        usdc.approve(address(tokenBridge), amount);
        uint64 sequence = tokenBridge.transferTokensWithPayload(
            address(usdc), amount, TARGET_CHAIN_ID, RECIPIENT, 0, abi.encode("test")
        );
        vm.stopPrank();

        // Step 3: On target chain, denormalize back to original decimals
        uint256 denormalized = tokenBridge.denormalizeAmount(normalized, 6);
        assertEq(denormalized, amount);

        // Step 4: Complete transfer
        bytes memory vaa = tokenBridge.generateMockVAA(sequence);
        tokenBridge.completeTransferWithPayload(vaa);

        assertEq(usdc.balanceOf(address(uint160(uint256(RECIPIENT)))), amount);
    }
}
