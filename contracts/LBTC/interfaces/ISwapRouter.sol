// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISwapRouter {
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
