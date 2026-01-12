// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { AztecAavePortalL1 } from "../contracts/AztecAavePortalL1.sol";

/**
 * @title DeployPortal
 * @notice Deployment script for AztecAavePortalL1 contract
 * @dev Usage: forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployPortal is Script {
    function run() external {
        // Load deployment configuration from environment
        address aztecOutbox = vm.envAddress("AZTEC_OUTBOX");
        address aztecInbox = vm.envAddress("AZTEC_INBOX");
        address tokenPortal = vm.envAddress("TOKEN_PORTAL");
        address wormholeTokenBridge = vm.envAddress("WORMHOLE_TOKEN_BRIDGE");
        address wormholeRelayer = vm.envAddress("WORMHOLE_RELAYER");
        bytes32 l2ContractAddress = vm.envBytes32("L2_CONTRACT_ADDRESS");
        uint16 targetChainId = uint16(vm.envUint("TARGET_CHAIN_ID"));
        bytes32 targetExecutor = vm.envBytes32("TARGET_EXECUTOR");

        vm.startBroadcast();

        AztecAavePortalL1 portal = new AztecAavePortalL1(
            aztecOutbox,
            aztecInbox,
            tokenPortal,
            wormholeTokenBridge,
            wormholeRelayer,
            l2ContractAddress,
            targetChainId,
            targetExecutor
        );

        console2.log("AztecAavePortalL1 deployed at:", address(portal));
        console2.log("Target chain ID:", targetChainId);

        vm.stopBroadcast();
    }
}
