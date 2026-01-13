// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

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
        address aavePool = vm.envAddress("AAVE_POOL");
        bytes32 l2ContractAddress = vm.envBytes32("L2_CONTRACT_ADDRESS");
        address initialOwner = vm.envAddress("PORTAL_OWNER");

        vm.startBroadcast();

        AztecAavePortalL1 portal = new AztecAavePortalL1(
            aztecOutbox, aztecInbox, tokenPortal, aavePool, l2ContractAddress, initialOwner
        );

        console2.log("AztecAavePortalL1 deployed at:", address(portal));
        console2.log("Aave Pool:", aavePool);
        console2.log("Initial owner:", initialOwner);

        vm.stopBroadcast();
    }
}
