// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {IVault} from "./interfaces/IVault.sol";
import {PriceRateLimiter} from "./libraries/PriceRateLimiter.sol";

/// @title VaultBaseUpgradeable
abstract contract VaultBaseUpgradeable is
    IERC20Metadata,
    IVault,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PausableUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;
    using PriceRateLimiter for PriceRateLimiter.Bucket;

    bytes32 public constant STRATEGY_DEPLOYER_ROLE =
        keccak256("STRATEGY_DEPLOYER_ROLE");

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant PRICE_PER_SHARE_GUARDIAN_ROLE =
        keccak256("PRICE_PER_SHARE_GUARDIAN_ROLE");

    modifier whenVaultNotPaused() {
        _requireVaultNotPaused();
        _;
    }

    modifier whenVaultPaused() {
        _requireVaultPaused();
        _;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.VaultBaseUpgradeable
    struct VaultBaseUpgradeableStorage {
        EnumerableSet.AddressSet strategies;
        /// @dev Underlying asset base units per `10 ** decimals()` share units (vault share token decimals).
        uint256 pricePerShare;
        /// @dev pause vault ops
        bool vaultPaused;
        IERC20 asset;
        uint8 underlyingDecimals;
        PriceRateLimiter.Bucket ppsRateLimiter;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.VaultBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_BASE_UPGRADEABLE_STORAGE_LOCATION =
        0xeadb3838d9eaf85055390f4c9c11e3d0e5a14b16d76298126869759876742000;

    function _getVaultBaseUpgradeableStorage()
        internal
        pure
        returns (VaultBaseUpgradeableStorage storage $)
    {
        assembly {
            $.slot := VAULT_BASE_UPGRADEABLE_STORAGE_LOCATION
        }
    }

    function __VaultBase_init(
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        address strategyDeployer_,
        IERC20 asset_
    ) internal onlyInitializing {
        if (strategyDeployer_ == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        __ReentrancyGuard_init();

        _grantRole(STRATEGY_DEPLOYER_ROLE, strategyDeployer_);

        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        (bool success, uint8 assetDecimals) = _tryGetAssetDecimals(asset_);
        $.underlyingDecimals = success ? assetDecimals : 18;
        $.asset = asset_;
        // Initial price per share is 1 asset per share.
        _setPricePerShare($, 10 ** decimals());
        $.ppsRateLimiter = PriceRateLimiter.Bucket({
            lastRefill: uint48(block.timestamp),
            capacityBps: 0,
            maxBps: 0,
            refillRate: 0
        });
    }

    /// @notice Posted exchange rate: asset wei per `10 ** decimals()` shares. Used by `_convertToShares` / `_convertToAssets`.
    function pricePerShare() public view returns (uint256) {
        return _getVaultBaseUpgradeableStorage().pricePerShare;
    }

    function postPricePerShare(
        uint256 newPricePerShare
    ) external onlyRole(OPERATOR_ROLE) whenVaultNotPaused {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        uint256 changeBps = PriceRateLimiter._relativeChangeBps($.pricePerShare, newPricePerShare);
        $.ppsRateLimiter._consume(changeBps);
        _setPricePerShare($, newPricePerShare);
    }

    function setPricePerShareRateLimit(
        uint32 maxBucketBps_,
        uint64 refillRate_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PriceRateLimiter.Config memory config = PriceRateLimiter.Config({
            maxBps: maxBucketBps_,
            refillRate: refillRate_
        });
        PriceRateLimiter._validateConfig(config);
        _getVaultBaseUpgradeableStorage().ppsRateLimiter._setConfig(config);
    }

    /// @notice Returns the bucket state with refill virtually applied to `block.timestamp`.
    function pricePerShareRateLimiterState() external view returns (PriceRateLimiter.Bucket memory) {
        return _getVaultBaseUpgradeableStorage().ppsRateLimiter._currentBucketState();
    }

    /// @dev allows to post any price, but pause vault operations
    function forcePostPricePerShare(
        uint256 newPricePerShare
    ) external onlyRole(PRICE_PER_SHARE_GUARDIAN_ROLE) {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        _setPricePerShare($, newPricePerShare);
        _pauseVault();
    }

    function _setPricePerShare(
        VaultBaseUpgradeableStorage storage $,
        uint256 newPricePerShare
    ) internal {
        if (newPricePerShare == 0) {
            revert ZeroPricePerShare();
        }
        $.pricePerShare = newPricePerShare;
        emit PricePerShareUpdated(
            newPricePerShare,
            totalAssets(),
            uint64(block.timestamp)
        );
    }

    function totalAssets() public view virtual returns (uint256) {
        return _convertToAssets(totalSupply(), Math.Rounding.Floor);
    }

    function asset() public view returns (IERC20) {
        return _getVaultBaseUpgradeableStorage().asset;
    }

    /// @notice Register `strategy` for the §B pipe (`docs/spec/002-strategy.md` §B): grants allowance on `asset()`.
    /// TODO: update
    function registerStrategy(
        address strategy
    ) external nonReentrant onlyRole(STRATEGY_DEPLOYER_ROLE) {
        if (strategy == address(0)) revert ZeroAddress();
        _getVaultBaseUpgradeableStorage().strategies.add(strategy);
        SafeERC20.forceApprove(IERC20(asset()), strategy, type(uint256).max);
    }

    /// @notice Whether `strategy` was registered via {registerStrategy}.
    /// TODO: update
    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool) {
        return _getVaultBaseUpgradeableStorage().strategies.contains(strategy);
    }

    function _tryGetAssetDecimals(
        IERC20 asset_
    ) private view returns (bool, uint8) {
        (bool success, bytes memory encodedDecimals) = address(asset_)
            .staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (success && encodedDecimals.length >= 32) {
            uint256 returnedDecimals = abi.decode(encodedDecimals, (uint256));
            if (returnedDecimals <= type(uint8).max) {
                return (true, uint8(returnedDecimals));
            }
        }
        return (false, 0);
    }

    function decimals()
        public
        view
        virtual
        override(IERC20Metadata, ERC20Upgradeable)
        returns (uint8)
    {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        return $.underlyingDecimals + _decimalsOffset();
    }

    function _decimalsOffset() internal view virtual returns (uint8) {
        return 0;
    }

    function _convertToShares(
        uint256 assets,
        Math.Rounding rounding
    ) internal view virtual returns (uint256) {
        return assets.mulDiv(10 ** decimals(), pricePerShare(), rounding);
    }

    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view virtual returns (uint256) {
        return shares.mulDiv(pricePerShare(), 10 ** decimals(), rounding);
    }

    function pauseVaultOperations() external onlyRole(PAUSER_ROLE) {
        _getVaultBaseUpgradeableStorage().vaultPaused = true;
    }

    function unpauseVaultOperations() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getVaultBaseUpgradeableStorage().vaultPaused = false;
    }

    function vaultOperationsPaused() public view virtual returns (bool) {
        return _getVaultBaseUpgradeableStorage().vaultPaused;
    }

    function _requireVaultNotPaused() internal view virtual {
        if (vaultOperationsPaused()) {
            revert EnforcedVaultOperationsPause();
        }
    }

    function _requireVaultPaused() internal view virtual {
        if (!vaultOperationsPaused()) {
            revert ExpectedVaultOperationsPause();
        }
    }

    function _pauseVault() internal virtual whenVaultNotPaused {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        $.vaultPaused = true;
        emit VaultOperationsPaused(_msgSender());
    }

    function _unpauseVault() internal virtual whenVaultPaused {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        $.vaultPaused = false;
        emit VaultOperationsUnpaused(_msgSender());
    }
}
