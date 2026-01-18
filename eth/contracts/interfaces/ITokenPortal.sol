// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ITokenPortal
 * @notice Interface for Aztec Token Portal for L1<->L2 token bridging
 * @dev Used to deposit tokens to Aztec L2 during withdrawal completion
 *
 * Token portals enable tokens to flow between L1 and Aztec L2:
 * - depositToAztecPublic: Deposits to a public L2 balance (visible recipient)
 * - depositToAztecPrivate: Deposits to a private L2 balance (hidden recipient)
 *
 * The secretHash mechanism ensures only the intended recipient can claim:
 * - L1 provides secretHash during deposit
 * - L2 user must provide the matching secret to claim tokens
 */
interface ITokenPortal {
    /**
     * @notice Deposit tokens to a public Aztec L2 balance
     * @param _to Recipient address on L2 (as bytes32)
     * @param _amount Amount of tokens to deposit
     * @param _secretHash Hash of secret for L1->L2 message consumption
     * @return messageKey The key of the L1->L2 message
     * @return messageIndex The index of the message in the L2 message tree
     */
    function depositToAztecPublic(
        bytes32 _to,
        uint256 _amount,
        bytes32 _secretHash
    ) external returns (bytes32 messageKey, uint256 messageIndex);

    /**
     * @notice Deposit tokens to a private Aztec L2 balance
     * @dev Recipient is not specified on-chain for privacy; user claims with secret
     * @param _amount Amount of tokens to deposit
     * @param _secretHashForL2MessageConsumption Hash of secret for claiming
     * @return messageKey The key of the L1->L2 message
     * @return messageIndex The index of the message in the L2 message tree
     */
    function depositToAztecPrivate(
        uint256 _amount,
        bytes32 _secretHashForL2MessageConsumption
    ) external returns (bytes32 messageKey, uint256 messageIndex);

    /**
     * @notice Get the underlying ERC20 token address
     * @return The address of the token this portal handles
     */
    function underlying() external view returns (address);

    /**
     * @notice Withdraw tokens from the portal based on L2 burn authorization
     * @param _amount Amount of tokens to withdraw
     * @param _recipient Address to receive the tokens
     */
    function withdraw(uint256 _amount, address _recipient) external;
}
