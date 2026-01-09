// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title WormholeAddresses
 * @notice Contract addresses for Wormhole core and token bridge
 * @dev These addresses are network-specific and should be set per deployment
 *
 * Mainnet addresses: https://docs.wormhole.com/wormhole/reference/constants#core-contracts
 * For local devnet, these should be deployed mock contracts or use hardcoded test addresses
 */
library WormholeAddresses {
    // Ethereum Mainnet
    address public constant WORMHOLE_CORE_ETHEREUM = 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B;
    address public constant WORMHOLE_TOKEN_BRIDGE_ETHEREUM =
        0x3ee18B2214AFF97000D974cf647E7C347E8fa585;

    // Arbitrum Mainnet
    address public constant WORMHOLE_CORE_ARBITRUM = 0xa5f208e072434bC67592E4C49C1B991BA79BCA46;
    address public constant WORMHOLE_TOKEN_BRIDGE_ARBITRUM =
        0x0b2402144Bb366A632D14B83F244D2e0e21bD39c;

    // Optimism Mainnet
    address public constant WORMHOLE_CORE_OPTIMISM = 0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722;
    address public constant WORMHOLE_TOKEN_BRIDGE_OPTIMISM =
        0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b;

    // Base Mainnet
    address public constant WORMHOLE_CORE_BASE = 0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6;
    address public constant WORMHOLE_TOKEN_BRIDGE_BASE =
        0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627;

    // Local Devnet (placeholder addresses - should be configured in deployment scripts)
    address public constant WORMHOLE_CORE_LOCAL_L1 = address(0x1111111111111111111111111111111111111111);
    address public constant WORMHOLE_TOKEN_BRIDGE_LOCAL_L1 =
        address(0x2222222222222222222222222222222222222222);
    address public constant WORMHOLE_CORE_LOCAL_TARGET =
        address(0x3333333333333333333333333333333333333333);
    address public constant WORMHOLE_TOKEN_BRIDGE_LOCAL_TARGET =
        address(0x4444444444444444444444444444444444444444);
}
