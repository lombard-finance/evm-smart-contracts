// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/**
 * @title Registry to store xxxLBTC tokens addresses
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract SwapRouter is ISwapRouter, Ownable2StepUpgradeable {
    using EnumerableMap for EnumerableMap.Bytes32ToBytes32Map;
    /// @custom:storage-location erc7201:lombardfinance.storage.TokenRegistry
    struct TokenRegistryStorage {
        mapping(bytes32 => Route) routes;
        EnumerableMap.Bytes32ToBytes32Map namedTokens;
    }

    struct Route {
        bytes32 toToken;
        bytes32 toChainId;
    }

    /// TODO: calcualte
    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant TOKEN_REGISTRY_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner) external initializer {
        __Ownable_init(owner);
        __TokenRegistry_init();
    }

    function __TokenRegistry_init() internal onlyInitializing {}

    function getRoute(
        bytes32 fromToken,
        bytes32 toChainId
    ) external view override returns (bytes32 toToken) {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
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
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        $.routes[key] = Route(toToken, toChainId);
    }

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view override returns (bool) {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route memory r = $.routes[key];
        return r.toToken == toToken && r.toChainId == toChainId;
    }

    function setNamedToken(bytes32 name, address token) external onlyOwner {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        $.namedTokens.set(name, bytes32(uint256(uint160(token))));
    }

    function getNamedToken(
        bytes32 name
    ) external view override returns (address) {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        return address(uint160(uint256($.namedTokens.get(name))));
    }

    function containsNamedToken(
        bytes32 name
    ) external view override returns (bool) {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        return $.namedTokens.contains(name);
    }

    function getNamedTokenKeys()
        external
        view
        override
        returns (bytes32[] memory)
    {
        TokenRegistryStorage storage $ = _getTokenRegistryStorage();
        return $.namedTokens.keys();
    }

    function _getTokenRegistryStorage()
        private
        pure
        returns (TokenRegistryStorage storage $)
    {
        assembly {
            $.slot := TOKEN_REGISTRY_STORAGE_LOCATION
        }
    }
}
