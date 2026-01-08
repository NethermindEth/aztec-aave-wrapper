// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {AztecAavePortalL1} from "../contracts/AztecAavePortalL1.sol";

/**
 * @title PortalTest
 * @notice Unit tests for AztecAavePortalL1 contract
 */
contract PortalTest is Test {
    AztecAavePortalL1 public portal;

    // Mock addresses
    address public aztecOutbox = makeAddr("aztecOutbox");
    address public aztecInbox = makeAddr("aztecInbox");
    address public tokenPortal = makeAddr("tokenPortal");
    address public wormholeTokenBridge = makeAddr("wormholeTokenBridge");
    address public wormholeRelayer = makeAddr("wormholeRelayer");
    bytes32 public l2ContractAddress = bytes32(uint256(1));
    uint16 public targetChainId = 23; // Arbitrum Wormhole chain ID
    bytes32 public targetExecutor = bytes32(uint256(2));

    function setUp() public {
        portal = new AztecAavePortalL1(
            aztecOutbox,
            aztecInbox,
            tokenPortal,
            wormholeTokenBridge,
            wormholeRelayer,
            l2ContractAddress,
            targetChainId,
            targetExecutor
        );
    }

    function test_Constructor() public view {
        assertEq(portal.aztecOutbox(), aztecOutbox);
        assertEq(portal.aztecInbox(), aztecInbox);
        assertEq(portal.tokenPortal(), tokenPortal);
        assertEq(portal.wormholeTokenBridge(), wormholeTokenBridge);
        assertEq(portal.wormholeRelayer(), wormholeRelayer);
        assertEq(portal.l2ContractAddress(), l2ContractAddress);
        assertEq(portal.targetChainId(), targetChainId);
        assertEq(portal.targetExecutor(), targetExecutor);
    }

    function test_ConsumedIntentsInitiallyFalse() public view {
        bytes32 intentId = keccak256("test_intent");
        assertFalse(portal.consumedIntents(intentId));
    }

    // TODO: Add tests for executeDeposit
    // TODO: Add tests for executeWithdraw
    // TODO: Add tests for receiveWormholeMessages
    // TODO: Add tests for completeTransferWithPayload
}
