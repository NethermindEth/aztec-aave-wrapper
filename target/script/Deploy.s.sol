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
 *   - WORMHOLE_CORE: Wormhole core contract address
 *   - L1_PORTAL_ADDRESS: L1 portal address in bytes32 format
 *   - SOURCE_CHAIN_ID: Wormhole chain ID of the source chain
 */
contract DeployScript is Script {
    // Aave V3 Pool addresses by network
    address public constant AAVE_POOL_MAINNET = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address public constant AAVE_POOL_SEPOLIA = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;

    // Wormhole Core addresses
    address public constant WORMHOLE_CORE_MAINNET = 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B;
    address public constant WORMHOLE_CORE_SEPOLIA = 0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78;

    // Wormhole chain IDs
    uint16 public constant CHAIN_ID_ETHEREUM = 2;

    function run() public {
        // Get deployment parameters from environment
        address aavePool = vm.envOr("AAVE_POOL", AAVE_POOL_SEPOLIA);
        address wormholeCore = vm.envOr("WORMHOLE_CORE", WORMHOLE_CORE_SEPOLIA);
        bytes32 l1PortalAddress = vm.envBytes32("L1_PORTAL_ADDRESS");
        uint16 sourceChainId = uint16(vm.envOr("SOURCE_CHAIN_ID", uint256(CHAIN_ID_ETHEREUM)));

        console2.log("Deploying AaveExecutorTarget...");
        console2.log("  Aave Pool:", aavePool);
        console2.log("  Wormhole Core:", wormholeCore);
        console2.log("  Source Chain ID:", sourceChainId);

        vm.startBroadcast();

        AaveExecutorTarget executor =
            new AaveExecutorTarget(aavePool, wormholeCore, l1PortalAddress, sourceChainId);

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }

    /// @notice Deploy to Sepolia testnet with default addresses
    function deploySepolia() public {
        bytes32 l1PortalAddress = vm.envBytes32("L1_PORTAL_ADDRESS");

        console2.log("Deploying to Sepolia...");

        vm.startBroadcast();

        AaveExecutorTarget executor = new AaveExecutorTarget(
            AAVE_POOL_SEPOLIA, WORMHOLE_CORE_SEPOLIA, l1PortalAddress, CHAIN_ID_ETHEREUM
        );

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }

    /// @notice Deploy to Mainnet with production addresses
    function deployMainnet() public {
        bytes32 l1PortalAddress = vm.envBytes32("L1_PORTAL_ADDRESS");

        console2.log("Deploying to Mainnet...");
        console2.log("WARNING: This is a production deployment!");

        vm.startBroadcast();

        AaveExecutorTarget executor = new AaveExecutorTarget(
            AAVE_POOL_MAINNET, WORMHOLE_CORE_MAINNET, l1PortalAddress, CHAIN_ID_ETHEREUM
        );

        vm.stopBroadcast();

        console2.log("AaveExecutorTarget deployed at:", address(executor));
    }
}
