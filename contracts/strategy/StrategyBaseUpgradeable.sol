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

import {IStrategy} from "./interfaces/IStrategy.sol";
import {PriceRateLimiter} from "./libraries/PriceRateLimiter.sol";

/// @title StrategyBaseUpgradeable
/// @notice Upgradeable ERC-20 strategy share with NAV (`pricePerShare`), registered shards, and a strategy-wide pause independent of ERC-20 `Pausable`.
/// @dev Inherits OpenZeppelin `ERC20Pausable` for share transfers while using separate `strategyPaused` + `_pauseStrategy` for deposit/redemption/shard entrypoints. Storage is ERC-7201 namespaced — extend via new structs only.
abstract contract StrategyBaseUpgradeable is
    IERC20Metadata,
    IStrategy,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PausableUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;
    using PriceRateLimiter for PriceRateLimiter.Bucket;

    bytes32 public constant MANAGER_ROLE =
        keccak256("MANAGER_ROLE");

    /// @notice Price setter role is used to set the price per share; may pause the strategy operations.
    bytes32 public constant PRICE_SETTER_ROLE = keccak256("PRICE_SETTER_ROLE");

    /// @notice Soft pauser role is used to pause the strategy operations without pausing the ERC-20 transfers.
    bytes32 public constant SOFT_PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Hard pauser role is used to pause the strategy operations and the ERC-20 transfers.
    bytes32 public constant HARD_PAUSER_ROLE = keccak256("HARD_PAUSER_ROLE");

    /// @notice The role is used to fulfill the redemption requests.
    bytes32 public constant PAY_REDEMPTIONS_ROLE =
        keccak256("PAY_REDEMPTIONS_ROLE");

    uint256 internal constant _BPS_DENOMINATOR = 10_000;

    modifier whenStrategyNotPaused() {
        _requireStrategyNotPaused();
        _;
    }

    modifier whenStrategyPaused() {
        _requireStrategyPaused();
        _;
    }

    /// @dev ERC-7201 namespaced storage is used throughout this contract hierarchy — there are no __gap arrays.
    ///      Any new storage added in future upgrades must use a new namespaced struct; never append to an
    ///      existing struct or add bare state variables, as that would corrupt the storage layout.
    /// @custom:storage-location erc7201:lombardfinance.storage.StrategyBaseUpgradeable
    struct StrategyBaseUpgradeableStorage {
        EnumerableSet.AddressSet shards;
        /// @dev Underlying asset base units per `10 ** decimals()` share units (strategy share token decimals).
        uint256 pricePerShare;
        /// @dev pause strategy ops
        bool strategyPaused;
        IERC20 asset;
        uint8 underlyingDecimals;
        PriceRateLimiter.Bucket ppsRateLimiter;
        /// @dev Receives async redemption withdrawal fee shares & skimmed multi-asset deposit fees (`setFeeTreasury`).
        address feeTreasury;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StrategyBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STRATEGY_BASE_UPGRADEABLE_STORAGE_LOCATION =
        0xfed51ddfcaefd85c8bb60b3d58b2af0fe77f5875ff8dd3a36da477495c45c700;

    function _getStrategyBaseUpgradeableStorage()
        internal
        pure
        returns (StrategyBaseUpgradeableStorage storage $)
    {
        assembly {
            $.slot := STRATEGY_BASE_UPGRADEABLE_STORAGE_LOCATION
        }
    }

    /// @dev Shared initializer: access control, reentrancy guard, ERC-20 share metadata + pausable ERC-20, underlying asset, initial `pricePerShare`, and zeroed rate-limiter bucket.
    ///      Parent initializers run in C3 linear order (OZ upgrades validator).
    /// @param name_ ERC-20 name for strategy shares.
    /// @param symbol_ ERC-20 symbol for strategy shares.
    /// @param initialDefaultAdminDelay_ Admin delay for `AccessControlDefaultAdminRules`.
    /// @param defaultAdmin_ Default admin for roles.
    /// @param asset_ Strategy underlying ERC-20 (`asset()`).
    function __StrategyBase_init(
        string memory name_,
        string memory symbol_,
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        IERC20 asset_
    ) internal onlyInitializing {
        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        __ReentrancyGuard_init();
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();

        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
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

    /// @notice Treasury for protocol fee skims: deposit-asset fees and (with `AsyncRedemptionUpgradeable`) withdrawal fee shares.
    /// @param treasury_ Must not be zero.
    function setFeeTreasury(
        address treasury_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert Strategy_ZeroAddress();
        _getStrategyBaseUpgradeableStorage().feeTreasury = treasury_;
        emit FeeTreasurySet(treasury_);
    }

    /// @return Address configured by {setFeeTreasury}.
    function feeTreasury() public view returns (address) {
        return _getStrategyBaseUpgradeableStorage().feeTreasury;
    }

    /// @notice Posted exchange rate: asset wei per `10 ** decimals()` shares. Used by `_convertToShares` / `_convertToAssets`.
    function pricePerShare() public view returns (uint256) {
        return _getStrategyBaseUpgradeableStorage().pricePerShare;
    }

    /// @notice Updates `pricePerShare` subject to the configured `PriceRateLimiter` capacity and refill rules.
    /// @param newPricePerShare Next asset wei per share unit; must be non-zero.
    /// @param revertOnRateLimit If the move exceeds remaining capacity: revert (true), or drain the bucket, set the price, and pause strategy operations (false).
    function postPricePerShare(
        uint256 newPricePerShare,
        bool revertOnRateLimit
    ) external onlyRole(PRICE_SETTER_ROLE) whenStrategyNotPaused {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        uint256 changeBps = PriceRateLimiter._relativeChangeBps(
            $.pricePerShare,
            newPricePerShare
        );
        if (!$.ppsRateLimiter._wouldExceedLimit(changeBps)) {
            $.ppsRateLimiter._consume(changeBps);
            _setPricePerShare($, newPricePerShare);
            return;
        }
        if (revertOnRateLimit) {
            revert PriceRateLimiter.PriceRateLimiter_RateLimitExceeded(
                changeBps,
                $.ppsRateLimiter._availableAfterRefill()
            );
        }
        $.ppsRateLimiter._drainRemaining();
        _setPricePerShare($, newPricePerShare);
        _pauseStrategy();
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
        _getStrategyBaseUpgradeableStorage().ppsRateLimiter._setConfig(config);
    }

    /// @notice Returns the bucket state with refill virtually applied to `block.timestamp`.
    function pricePerShareRateLimiterState()
        external
        view
        returns (PriceRateLimiter.Bucket memory)
    {
        return _getStrategyBaseUpgradeableStorage().ppsRateLimiter._refill();
    }

    function _setPricePerShare(
        StrategyBaseUpgradeableStorage storage $,
        uint256 newPricePerShare
    ) internal {
        if (newPricePerShare == 0) {
            revert Strategy_ZeroPricePerShare();
        }
        $.pricePerShare = newPricePerShare;
        emit PricePerShareUpdated(
            newPricePerShare,
            totalAssets(),
            uint64(block.timestamp)
        );
    }

    /// @notice Returns posted NAV: totalSupply × pricePerShare, NOT the strategy's actual token balance.
    ///         Integrators that need real holdings must sum shard balances off-chain.
    function totalAssets() public view virtual returns (uint256) {
        return _convertToAssets(totalSupply(), Math.Rounding.Floor);
    }

    /// @notice Underlying ERC-20 used for NAV accounting and async redemption payout (same role as ERC-4626 `asset()`).
    /// @return The underlying token set in `__StrategyBase_init`.
    function asset() public view returns (IERC20) {
        return _getStrategyBaseUpgradeableStorage().asset;
    }

    /// @notice Whether `shard` is registered for funding.
    function isRegisteredShard(address shard) external view returns (bool) {
        return _getStrategyBaseUpgradeableStorage().shards.contains(shard);
    }

    /// @notice Registers an existing shard contract address without deploying via the hub.
    /// @param shard Shard contract to whitelist for `requestFunding`.
    function registerShard(
        address shard
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_getStrategyBaseUpgradeableStorage().shards.add(shard))
            revert Strategy_ShardAlreadyRegistered();
        emit ShardRegistered(shard, _msgSender());
    }

    /// @notice Removes `shard` from the funding whitelist.
    /// @param shard Shard address to remove.
    function deregisterShard(
        address shard
    ) external virtual onlyRole(MANAGER_ROLE) {
        if (!_getStrategyBaseUpgradeableStorage().shards.remove(shard))
            revert Strategy_ShardNotRegistered();
        emit ShardDeregistered(shard, _msgSender());
        _afterShardDeregistered(shard);
    }

    /// @dev Extension point for modules that track per-shard references (e.g. default deposit routing).
    function _afterShardDeregistered(address) internal virtual {}

    /// @notice Transfer `amount` of `token` to the calling shard.
    /// @dev Only callable by a registered shard; uses nonReentrant to guard against re-entrancy via token callbacks.
    function requestFunding(
        IERC20 token,
        uint256 amount
    ) external virtual override nonReentrant {
        if (address(token) == address(this))
            revert Strategy_ShareTransferNotAllowed();
        if (amount == 0) revert Strategy_ZeroAmount();
        address caller = _msgSender();
        if (!_getStrategyBaseUpgradeableStorage().shards.contains(caller))
            revert Strategy_ShardNotRegistered();
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
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
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

    /// @notice Sets strategy-level pause (blocks `whenStrategyNotPaused` routes); distinct from ERC-20 transfer pause.
    function pauseStrategyOperations() external onlyRole(SOFT_PAUSER_ROLE) {
        _pauseStrategy();
    }

    /// @notice Clears strategy-level pause.
    function unpauseStrategyOperations() external onlyRole(MANAGER_ROLE) {
        _unpauseStrategy();
    }

    /// @return True if strategy operations (deposit/redemption/funding paths using `whenStrategyNotPaused`) are paused.
    function strategyOperationsPaused() public view virtual returns (bool) {
        return _getStrategyBaseUpgradeableStorage().strategyPaused;
    }

    function _requireStrategyNotPaused() internal view virtual {
        if (strategyOperationsPaused()) {
            revert Strategy_EnforcedStrategyOperationsPause();
        }
    }

    function _requireStrategyPaused() internal view virtual {
        if (!strategyOperationsPaused()) {
            revert Strategy_ExpectedStrategyOperationsPause();
        }
    }

    function _pauseStrategy() internal virtual whenStrategyNotPaused {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        $.strategyPaused = true;
        emit StrategyOperationsPaused(_msgSender());
    }

    function _unpauseStrategy() internal virtual whenStrategyPaused {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        $.strategyPaused = false;
        emit StrategyOperationsUnpaused(_msgSender());
    }

    function pause() external onlyRole(HARD_PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }
}
