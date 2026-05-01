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
/// @notice Upgradeable ERC-20 vault share with NAV (`pricePerShare`), registered strategies, and a vault-wide pause independent of ERC-20 `Pausable`.
/// @dev Inherits OpenZeppelin `ERC20Pausable` for share transfers while using separate `vaultPaused` + `_pauseVault` for deposit/redemption/strategy entrypoints. Storage is ERC-7201 namespaced — extend via new structs only.
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

    uint256 internal constant _BPS_DENOMINATOR = 10_000;

    modifier whenVaultNotPaused() {
        _requireVaultNotPaused();
        _;
    }

    modifier whenVaultPaused() {
        _requireVaultPaused();
        _;
    }

    /// @dev ERC-7201 namespaced storage is used throughout this contract hierarchy — there are no __gap arrays.
    ///      Any new storage added in future upgrades must use a new namespaced struct; never append to an
    ///      existing struct or add bare state variables, as that would corrupt the storage layout.
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

    /// @dev Shared initializer: access control, reentrancy guard, ERC-20 share metadata + pausable ERC-20, strategy deployer role, underlying asset, initial `pricePerShare`, and zeroed rate-limiter bucket.
    ///      Parent initializers run in C3 linear order (OZ upgrades validator).
    /// @param name_ ERC-20 name for vault shares.
    /// @param symbol_ ERC-20 symbol for vault shares.
    /// @param initialDefaultAdminDelay_ Admin delay for `AccessControlDefaultAdminRules`.
    /// @param defaultAdmin_ Default admin for roles.
    /// @param strategyDeployer_ Receives `STRATEGY_DEPLOYER_ROLE` (must not be zero).
    /// @param asset_ Vault underlying ERC-20 (`asset()`).
    function __VaultBase_init(
        string memory name_,
        string memory symbol_,
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        address strategyDeployer_,
        IERC20 asset_
    ) internal onlyInitializing {
        if (strategyDeployer_ == address(0)) {
            revert Vault_ZeroAddress();
        }

        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        __ReentrancyGuard_init();
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();

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

    /// @notice Updates `pricePerShare` subject to the configured `PriceRateLimiter` capacity and refill rules.
    /// @param newPricePerShare Next asset wei per share unit; must be non-zero.
    function postPricePerShare(
        uint256 newPricePerShare
    ) external onlyRole(OPERATOR_ROLE) whenVaultNotPaused {
        VaultBaseUpgradeableStorage
            storage $ = _getVaultBaseUpgradeableStorage();
        uint256 changeBps = PriceRateLimiter._relativeChangeBps(
            $.pricePerShare,
            newPricePerShare
        );
        $.ppsRateLimiter._consume(changeBps);
        _setPricePerShare($, newPricePerShare);
    }

    /// @notice Configures the PPS move rate limiter (bucket ceiling and refill rate; library-defined semantics).
    /// @param maxBucketBps_ Maximum bucket capacity in PriceRateLimiter micro-bps.
    /// @param refillRate_ Per-second refill parameter passed through to `PriceRateLimiter.Config`.
    function setPricePerShareRateLimit(
        uint32 maxBucketBps_,
        uint64 refillRate_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PriceRateLimiter.Config memory config = PriceRateLimiter.Config({
            maxBps: maxBucketBps_,
            refillRate: refillRate_
        });
        _getVaultBaseUpgradeableStorage().ppsRateLimiter._setConfig(config);
    }

    /// @notice Returns the bucket state with refill virtually applied to `block.timestamp`.
    function pricePerShareRateLimiterState()
        external
        view
        returns (PriceRateLimiter.Bucket memory)
    {
        return _getVaultBaseUpgradeableStorage().ppsRateLimiter._refill();
    }

    /// @notice Posts any non-zero `pricePerShare` without consuming rate-limit capacity, then pauses vault operations.
    /// @param newPricePerShare Next asset wei per share unit.
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
            revert Vault_ZeroPricePerShare();
        }
        $.pricePerShare = newPricePerShare;
        emit PricePerShareUpdated(
            newPricePerShare,
            totalAssets(),
            uint64(block.timestamp)
        );
    }

    /// @notice Returns posted NAV: totalSupply × pricePerShare, NOT the vault's actual token balance.
    ///         Integrators that need real holdings must sum strategy balances off-chain.
    function totalAssets() public view virtual returns (uint256) {
        return _convertToAssets(totalSupply(), Math.Rounding.Floor);
    }

    /// @notice Underlying ERC-20 used for NAV accounting and async redemption payout (same role as ERC-4626 `asset()`).
    /// @return The underlying token set in `__VaultBase_init`.
    function asset() public view returns (IERC20) {
        return _getVaultBaseUpgradeableStorage().asset;
    }

    /// @notice Whether `strategy` is registered for funding.
    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool) {
        return _getVaultBaseUpgradeableStorage().strategies.contains(strategy);
    }

    /// @notice Registers an existing strategy contract address without deploying via the hub.
    /// @param strategy Strategy contract to whitelist for `requestFunding`.
    function registerStrategy(
        address strategy
    ) external onlyRole(STRATEGY_DEPLOYER_ROLE) {
        if (!_getVaultBaseUpgradeableStorage().strategies.add(strategy))
            revert Vault_StrategyAlreadyRegistered();
        emit StrategyRegistered(strategy, _msgSender());
    }

    /// @notice Removes `strategy` from the funding whitelist.
    /// @param strategy Strategy address to remove.
    function deregisterStrategy(
        address strategy
    ) external virtual onlyRole(STRATEGY_DEPLOYER_ROLE) {
        if (!_getVaultBaseUpgradeableStorage().strategies.remove(strategy))
            revert Vault_StrategyNotRegistered();
        emit StrategyDeregistered(strategy, _msgSender());
        _afterStrategyDeregistered(strategy);
    }

    /// @dev Extension point for modules that track per-strategy references (e.g. default deposit routing).
    function _afterStrategyDeregistered(address) internal virtual {}

    /// @notice Transfer `amount` of `token` to the calling strategy.
    /// @dev Only callable by a registered strategy; uses nonReentrant to guard against re-entrancy via token callbacks.
    function requestFunding(
        IERC20 token,
        uint256 amount
    ) external virtual override nonReentrant {
        if (address(token) == address(this))
            revert Vault_ShareTransferNotAllowed();
        if (amount == 0) revert Vault_ZeroAmount();
        address caller = _msgSender();
        if (!_getVaultBaseUpgradeableStorage().strategies.contains(caller))
            revert Vault_StrategyNotRegistered();
        token.safeTransfer(caller, amount);
        emit FundingRequested(caller, address(token), amount);
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
        return $.underlyingDecimals;
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

    /// @notice Sets vault-level pause (blocks `whenVaultNotPaused` routes); distinct from ERC-20 transfer pause.
    function pauseVaultOperations() external onlyRole(PAUSER_ROLE) {
        _pauseVault();
    }

    /// @notice Clears vault-level pause.
    function unpauseVaultOperations() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpauseVault();
    }

    /// @return True if vault operations (deposit/redemption/funding paths using `whenVaultNotPaused`) are paused.
    function vaultOperationsPaused() public view virtual returns (bool) {
        return _getVaultBaseUpgradeableStorage().vaultPaused;
    }

    function _requireVaultNotPaused() internal view virtual {
        if (vaultOperationsPaused()) {
            revert Vault_EnforcedVaultOperationsPause();
        }
    }

    function _requireVaultPaused() internal view virtual {
        if (!vaultOperationsPaused()) {
            revert Vault_ExpectedVaultOperationsPause();
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
