// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/**
 * @title Router to store xxxLBTC swap paths and token's name.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract SwapRouter is ISwapRouter, Ownable2StepUpgradeable {
    using EnumerableMap for EnumerableMap.Bytes32ToBytes32Map;
    /// @custom:storage-location erc7201:lombardfinance.storage.SwapRouter
    struct SwapRouterStorage {
        mapping(bytes32 => Route) routes;
        EnumerableMap.Bytes32ToBytes32Map namedTokens;
    }

    struct Route {
        bytes32 toToken;
        bytes32 toChainId;
    }

    /// TODO: calcualte
    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.SwapRouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SWAP_ROUTER_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner) external initializer {
        __Ownable_init(owner);
        __SwapRouter_init();
    }

    function __SwapRouter_init() internal onlyInitializing {}

    function getRoute(
        bytes32 fromToken,
        bytes32 toChainId
    ) external view override returns (bytes32 toToken) {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route memory r = $.routes[key];
        return r.toToken;
    }

    function setRoute(
        bytes32 fromToken,
        bytes32 fromChainId,
        bytes32 toToken,
        bytes32 toChainId
    ) external onlyOwner {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        $.routes[key] = Route(toToken, toChainId);
        emit RouteSet(fromToken, fromChainId, toToken, toChainId);
    }

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view override returns (bool) {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route memory r = $.routes[key];
        return r.toToken == toToken && r.toChainId == toChainId;
    }

    function setNamedToken(bytes32 name, address token) external onlyOwner {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        $.namedTokens.set(name, bytes32(uint256(uint160(token))));
        emit NamedTokenSet(name, token);
    }

    function getNamedToken(
        bytes32 name
    ) external view override returns (address) {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        return address(uint160(uint256($.namedTokens.get(name))));
    }

    function containsNamedToken(
        bytes32 name
    ) external view override returns (bool) {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        return $.namedTokens.contains(name);
    }

    function getNamedTokenKeys()
        external
        view
        override
        returns (bytes32[] memory)
    {
        SwapRouterStorage storage $ = _getSwapRouterStorage();
        return $.namedTokens.keys();
    }

    function _getSwapRouterStorage()
        private
        pure
        returns (SwapRouterStorage storage $)
    {
        assembly {
            $.slot := SWAP_ROUTER_STORAGE_LOCATION
        }
    }
}
