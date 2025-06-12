// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IStakingRouter {
    error StakingRouter_ZeroMailbox();
    error StakingRouter_MailboxExpected();
    error StakingRouter_PayloadAlreadyUsed();
    event RouteSet(
        bytes32 indexed fromToken,
        bytes32 indexed fromChainId,
        bytes32 indexed toToken,
        bytes32 toChainId
    );
    event NamedTokenSet(bytes32 indexed name, address indexed token);

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view returns (bool);

    function getNamedToken(bytes32 name) external view returns (address);
    function containsNamedToken(bytes32 name) external view returns (bool);
    function getNamedTokenKeys() external view returns (bytes32[] memory);

    function startStake(
        bytes32 tolChainId,
        address fromToken,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external returns (address);

    function startUnstake(
        bytes32 tolChainId,
        address fromToken,
        bytes calldata recipient,
        uint256 amount
    ) external;

    function finalizeStakingOperation(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external returns (bool);
}
