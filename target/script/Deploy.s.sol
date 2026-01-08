// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AaveExecutorTarget} from "../contracts/AaveExecutorTarget.sol";

/**
 * @title DeployScript
 * @notice Deployment script for AaveExecutorTarget
 * @dev Uses Foundry's scripting system for deterministic deployments
 *
 * Usage:
 *   # Dry run (simulation)
 *   forge script script/Deploy.s.sol --rpc-url sepolia
 *
 *   # Broadcast transaction
 *   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast
 *
 *   # With verification
 *   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
 *
 * Required Environment Variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - AAVE_POOL: Aave V3 Pool address for target network
 *   - AZTEC_PORTAL: Aztec portal contract address
 */
contract DeployScript is Script {
    // Aave V3 Pool addresses by network
    address public constant AAVE_POOL_MAINNET = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address public constant AAVE_POOL_SEPOLIA = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;

    function run() public {
        // Get deployment parameters from environment
        address aavePool = vm.envOr("AAVE_POOL", AAVE_POOL_SEPOLIA);
        address aztecPortal = vm.envAddress("AZTEC_PORTAL");

        console2.log("Deploying AaveExecutorTarget...");
        console2.log("  Aave Pool:", aavePool);
        console2.log("  Aztec Portal:", aztecPortal);

        vm.startBroadcast();

        AaveExecutorTarget executor = new AaveExecutorTarget(aavePool, aztecPortal);

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }

    /// @notice Deploy to Sepolia testnet with default addresses
    function deploySepolia() public {
        address aztecPortal = vm.envAddress("AZTEC_PORTAL");

        console2.log("Deploying to Sepolia...");

        vm.startBroadcast();

        AaveExecutorTarget executor = new AaveExecutorTarget(AAVE_POOL_SEPOLIA, aztecPortal);

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }

    /// @notice Deploy to Mainnet with production addresses
    function deployMainnet() public {
        address aztecPortal = vm.envAddress("AZTEC_PORTAL");

        console2.log("Deploying to Mainnet...");
        console2.log("WARNING: This is a production deployment!");

        vm.startBroadcast();

        AaveExecutorTarget executor = new AaveExecutorTarget(AAVE_POOL_MAINNET, aztecPortal);

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }
}
