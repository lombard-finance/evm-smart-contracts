// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IStakingRouter {
    event RouteSet(
        bytes32 indexed fromToken,
        bytes32 indexed fromChainId,
        bytes32 indexed toToken,
        bytes32 toChainId
    );
    event NamedTokenSet(bytes32 indexed name, address indexed token);

    function getRoute(
        bytes32 fromToken,
        bytes32 toChainId
    ) external view returns (bytes32 toToken);
    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view returns (bool);

    function getNamedToken(bytes32 name) external view returns (address);
    function containsNamedToken(bytes32 name) external view returns (bool);
    function getNamedTokenKeys() external view returns (bytes32[] memory);
}
