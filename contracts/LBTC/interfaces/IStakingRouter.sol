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
    event StakingRouter_BasculeChanged(address indexed prevVal, address indexed newVal);
    event StakingRouter_OracleChanged(address indexed prevVal, address indexed newVal);
    event StakingRouter_MailboxChanged(address indexed prevVal, address indexed newVal);
    event StakingRouter_FeeChanged(uint256 indexed oldFee, uint256 indexed newFee);

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view returns (bool);

    function getNamedToken(bytes32 name) external view returns (address);
    function containsNamedToken(bytes32 name) external view returns (bool);
    function getNamedTokenKeys() external view returns (bytes32[] memory);
    function getMintFee() external view returns (uint256);
    function getRatio(address token) external view returns (uint256);

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
    ) external returns (bool, address);
}
