// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IWormholeRelayer
 * @notice Interface for Wormhole Relayer for automatic message delivery
 * @dev Used for sending cross-chain messages with automatic relaying
 *
 * The Wormhole Relayer provides automatic delivery of messages across chains,
 * eliminating the need for off-chain VAA submission. Messages are delivered
 * by the Wormhole guardian network automatically.
 */
interface IWormholeRelayer {
    /**
     * @notice Send a message to another chain with automatic delivery
     * @param targetChain Wormhole chain ID of the destination
     * @param targetAddress Address of the recipient contract (in bytes32 format)
     * @param payload Arbitrary message payload
     * @param receiverValue Native token amount to send to receiver
     * @param gasLimit Gas limit for execution on target chain
     * @return sequence Wormhole sequence number for tracking
     */
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable returns (uint64 sequence);

    /**
     * @notice Send a message to another chain with automatic delivery (bytes32 target)
     * @param targetChain Wormhole chain ID of the destination
     * @param targetAddress Address of the recipient contract (bytes32, left-padded)
     * @param payload Arbitrary message payload
     * @param receiverValue Native token amount to send to receiver
     * @param gasLimit Gas limit for execution on target chain
     * @param refundChain Chain ID where refunds should be sent
     * @param refundAddress Address to receive refunds
     * @return sequence Wormhole sequence number for tracking
     */
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress
    ) external payable returns (uint64 sequence);

    /**
     * @notice Quote the cost of sending a message
     * @param targetChain Wormhole chain ID of the destination
     * @param receiverValue Native token amount to send to receiver
     * @param gasLimit Gas limit for execution on target chain
     * @return nativePriceQuote Cost in native token (wei)
     */
    function quoteEVMDeliveryPrice(uint16 targetChain, uint256 receiverValue, uint256 gasLimit)
        external
        view
        returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused);

    /**
     * @notice Get the registered Wormhole core contract address
     * @return Address of the Wormhole core bridge
     */
    function wormhole() external view returns (address);

    /**
     * @notice Get delivery information for a given delivery hash
     * @param deliveryHash Hash of the delivery
     * @return deliveryInfo Encoded delivery information
     */
    function deliveryAttempted(bytes32 deliveryHash) external view returns (bool);

    /**
     * @notice Deliver a message to the target contract
     * @dev Called automatically by Wormhole relayers, can also be called manually
     * @param encodedVMs Array of signed VAAs to deliver
     */
    function deliver(
        bytes[] memory encodedVMs,
        bytes memory encodedDeliveryVAA,
        address payable relayerRefundAddress,
        bytes memory deliveryOverrides
    ) external payable;
}
