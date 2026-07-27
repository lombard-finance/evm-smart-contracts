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

import {IBlocklistOracle} from "./interfaces/IBlocklistOracle.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";
import {PriceRateLimiter} from "./libraries/PriceRateLimiter.sol";

/// @title StrategyBaseUpgradeable
/// @notice Upgradeable ERC-20 strategy share with NAV (`pricePerShare`), registered shards, and independent deposit/redeem pauses distinct from ERC-20 `Pausable`.
/// @dev Inherits OpenZeppelin `ERC20Pausable` for share transfers while using separate deposit/redeem pauses for entrypoints. Storage is ERC-7201 namespaced — extend via new structs only.
/// @custom:security-contact security@lombard.finance
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

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @notice Price setter role is used to set the price per share; may pause the strategy operations.
    bytes32 public constant PRICE_SETTER_ROLE = keccak256("PRICE_SETTER_ROLE");

    /// @notice Strategy pauser role is used to pause the strategy operations without pausing the ERC-20 transfers.
    bytes32 public constant STRATEGY_PAUSER_ROLE =
        keccak256("STRATEGY_PAUSER_ROLE");

    /// @notice Transfers pauser role is used to pause the ERC-20 transfers.
    bytes32 public constant TRANSFERS_PAUSER_ROLE =
        keccak256("TRANSFERS_PAUSER_ROLE");

    /// @notice The role is used to fulfill the redemption requests.
    bytes32 public constant PAY_REDEMPTIONS_ROLE =
        keccak256("PAY_REDEMPTIONS_ROLE");

    uint256 internal constant _BPS_DENOMINATOR = 10_000;

    modifier whenDepositNotPaused() {
        _requireDepositNotPaused();
        _;
    }

    modifier whenRedeemNotPaused() {
        _requireRedeemNotPaused();
        _;
    }

    /// @dev ERC-7201 namespaced storage is used throughout this contract hierarchy — there are no __gap arrays.
    ///      Any new storage added in future upgrades must use a new namespaced struct; never append to an
    ///      existing struct or add bare state variables, as that would corrupt the storage layout.
    /// @custom:storage-location erc7201:lombardfinance.storage.StrategyBaseUpgradeable
    struct StrategyBaseUpgradeableStorage {
        EnumerableSet.AddressSet shards;
        uint256 pricePerShare; // asset wei per `10 ** decimals()` share units
        PriceRateLimiter.Bucket ppsRateLimiter;
        IERC20 asset;
        address feeTreasury;
        address defaultShard;
        uint8 underlyingDecimals;
        /// @dev Compliance oracle (`IBlocklistOracle.check`); required at init; replace via {setBlocklistOracle}.
        address blocklistOracle;
        /// @dev Deposit/mint pause (independent of `redeemPaused`).
        bool depositPaused;
        /// @dev Redeem pause for `requestRedeem` / `fulfillRedeemRequests` (independent of `depositPaused`).
        bool redeemPaused;
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

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC20StorageLocation =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;

    function _getERC20InheritedStorage()
        private
        pure
        returns (ERC20Storage storage $)
    {
        assembly {
            $.slot := ERC20StorageLocation
        }
    }

    /// @dev Shared initializer: access control, reentrancy guard, ERC-20 share metadata + pausable ERC-20, underlying asset,
    ///      mandatory blocklist oracle, initial `pricePerShare`, and zeroed rate-limiter bucket.
    ///      Parent initializers run in C3 linear order (OZ upgrades validator).
    /// @param name_ ERC-20 name for strategy shares.
    /// @param symbol_ ERC-20 symbol for strategy shares.
    /// @param initialDefaultAdminDelay_ Admin delay for `AccessControlDefaultAdminRules`.
    /// @param defaultAdmin_ Default admin for roles.
    /// @param asset_ Strategy underlying ERC-20 (`asset()`).
    /// @param decimals_ Fallback decimals used only when `asset_` does not expose a valid `decimals()`; must not be zero.
    /// @param blocklistOracle_ Compliance oracle (`IBlocklistOracle`); must not be zero.
    function __StrategyBase_init(
        string memory name_,
        string memory symbol_,
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        IERC20 asset_,
        uint8 decimals_,
        address blocklistOracle_
    ) internal onlyInitializing {
        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        __ReentrancyGuard_init();
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();

        if (decimals_ == 0) revert Strategy_ZeroDecimals();
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        (bool success, uint8 assetDecimals) = _tryGetAssetDecimals(asset_);
        $.underlyingDecimals = success ? assetDecimals : decimals_;
        $.asset = asset_;
        _setBlocklistOracle($, blocklistOracle_);
        // Initial price per share is 1 asset per share.
        _setPricePerShare($, _oneShare());
        $.ppsRateLimiter = PriceRateLimiter.Bucket({
            lastRefill: uint48(block.timestamp),
            capacityBps: 0,
            maxBps: 0,
            refillRate: 0
        });
    }

    function changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        ERC20Storage storage $ = _getERC20InheritedStorage();
        $._name = name_;
        $._symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    /// @notice Treasury for protocol fee skims: deposit-asset fees and (with `AsyncRedemptionUpgradeable`) redeem fee shares.
    /// @param treasury_ Must not be zero.
    function setFeeTreasury(address treasury_) external onlyRole(MANAGER_ROLE) {
        _requireNonZeroAddress(treasury_);
        _getStrategyBaseUpgradeableStorage().feeTreasury = treasury_;
        emit FeeTreasurySet(treasury_);
    }

    /// @return Address configured by {setFeeTreasury}.
    function feeTreasury() public view returns (address) {
        return _getStrategyBaseUpgradeableStorage().feeTreasury;
    }

    /// @return Current compliance oracle address (never zero after init).
    function blocklistOracle() public view returns (address) {
        return _getStrategyBaseUpgradeableStorage().blocklistOracle;
    }

    /// @notice Points deposit/redeem compliance checks at a new `IBlocklistOracle` implementation.
    /// @param oracle_ Must not be zero (oracle cannot be disabled on-chain).
    function setBlocklistOracle(
        address oracle_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        _setBlocklistOracle($, oracle_);
    }

    /// @dev Validates `oracle_`, stores it, and emits {BlocklistOracleSet}.
    function _setBlocklistOracle(
        StrategyBaseUpgradeableStorage storage $,
        address oracle_
    ) internal {
        _requireNonZeroAddress(oracle_);
        $.blocklistOracle = oracle_;
        emit BlocklistOracleSet(oracle_);
    }

    /// @dev Reverts with {Strategy_ZeroAddress} when `account` is the zero address. Shared across the
    ///      hierarchy so the revert site is emitted once instead of at every zero-address guard.
    function _requireNonZeroAddress(address account) internal pure {
        if (account == address(0)) revert Strategy_ZeroAddress();
    }

    /// @dev Invokes `IBlocklistOracle.check` (oracle is always set after init).
    function _requireBlocklistAllows(address account) internal view {
        IBlocklistOracle(_getStrategyBaseUpgradeableStorage().blocklistOracle)
            .check(account);
    }

    /// @notice Posted exchange rate: asset wei per `10 ** decimals()` shares. Used by `_convertToShares` / `_convertToAssets`.
    function pricePerShare() public view returns (uint256) {
        return _getStrategyBaseUpgradeableStorage().pricePerShare;
    }

    /// @dev Share supply for `postPricePerShare` reconciliation. Defaults to `totalSupply()`; modules that keep
    ///      burned-but-backed shares in the vault override to include them. Prefer `super` when stacking.
    ///      Normative detail: `docs/spec/003-strategy.md` § Exchange rate.
    function _effectiveShareSupply() internal view virtual returns (uint256) {
        return totalSupply();
    }

    /// @notice Derives and stores a new `pricePerShare` from a NAV/supply snapshot, reconciled for mid-epoch supply changes.
    /// @dev Rate limiter gates on the *reconciled* move. Mid-epoch net Δ at still-stored PPS.
    ///      Reverts {Strategy_PricePerSharePaused} when deposit or redeem is paused.
    /// @param navAtSnapshot Operator-observed NAV (asset units) at snapshot; must be non-zero.
    /// @param effectiveSupplyAtSnapshot Effective supply at that instant (`_effectiveShareSupply` semantics); must be non-zero.
    /// @param revertOnRateLimit On excess reconciled move: revert (true), or drain bucket, set price, pause deposit+redeem (false).
    function postPricePerShare(
        uint256 navAtSnapshot,
        uint256 effectiveSupplyAtSnapshot,
        bool revertOnRateLimit
    ) external onlyRole(PRICE_SETTER_ROLE) whenNotPaused {
        if (depositPaused() || redeemPaused()) {
            revert Strategy_PricePerSharePaused();
        }

        if (navAtSnapshot == 0) revert Strategy_ZeroNavAtSnapshot();
        if (effectiveSupplyAtSnapshot == 0)
            revert Strategy_ZeroSharesAtSnapshot();
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();

        uint256 oneShare = _oneShare();
        uint256 effectiveSupplyNow = _effectiveShareSupply();

        uint256 priceToSet = navAtSnapshot.mulDiv(
            oneShare,
            effectiveSupplyAtSnapshot,
            Math.Rounding.Floor
        );
        if (effectiveSupplyNow != 0) {
            // Single Floor in PPS-scaled space.
            priceToSet = navAtSnapshot.mulDiv(
                oneShare,
                effectiveSupplyNow,
                Math.Rounding.Floor
            );
            uint256 oldPps = $.pricePerShare;
            if (effectiveSupplyNow >= effectiveSupplyAtSnapshot) {
                priceToSet += (effectiveSupplyNow - effectiveSupplyAtSnapshot)
                    .mulDiv(oldPps, effectiveSupplyNow, Math.Rounding.Floor);
            } else {
                uint256 removalValue = (effectiveSupplyAtSnapshot -
                    effectiveSupplyNow).mulDiv(
                        oldPps,
                        effectiveSupplyNow,
                        Math.Rounding.Ceil
                    );
                if (priceToSet < removalValue) {
                    revert Strategy_InsufficientNavForReconciliation();
                }
                priceToSet -= removalValue;
            }
        }

        uint256 changeBps = PriceRateLimiter._relativeChangeBps(
            $.pricePerShare,
            priceToSet
        );
        if (!$.ppsRateLimiter._wouldExceedLimit(changeBps)) {
            $.ppsRateLimiter._consume(changeBps);
            _setPricePerShare($, priceToSet);
            return;
        }
        if (revertOnRateLimit) {
            revert PriceRateLimiter.PriceRateLimiterRateLimitExceeded(
                changeBps,
                $.ppsRateLimiter._availableAfterRefill()
            );
        }
        $.ppsRateLimiter._drainRemaining();
        _setPricePerShare($, priceToSet);
        _pauseDeposit();
        _pauseRedeem();
    }

    /// @notice Configures the PPS move rate limiter (bucket ceiling and refill rate; library-defined semantics).
    /// @param maxBucketBps_ Maximum bucket capacity in PriceRateLimiter micro-bps.
    /// @param refillRate_ Per-second refill parameter passed through to `PriceRateLimiter.Config`.
    function setPricePerShareRateLimit(
        uint32 maxBucketBps_,
        uint64 refillRate_
    ) external onlyRole(MANAGER_ROLE) {
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
    /// @dev May disagree with economic NAV mid-epoch until a later inclusive `postPricePerShare`.
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

    /// @notice All shard addresses registered for funding (order not stable across adds/removals).
    /// @dev Copies the full set to memory; intended for off-chain / view calls.
    function shards() external view returns (address[] memory) {
        return _getStrategyBaseUpgradeableStorage().shards.values();
    }

    /// @notice Registers an existing shard contract address without deploying via the hub.
    /// @param shard Shard contract to whitelist for `requestFunding`.
    function registerShard(
        address shard
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireNonZeroAddress(shard);
        if (!_getStrategyBaseUpgradeableStorage().shards.add(shard))
            revert Strategy_ShardAlreadyRegistered();
        emit ShardRegistered(shard, _msgSender());
    }

    /// @notice Removes `shard` from the funding whitelist.
    /// @param shard Shard address to remove.
    function deregisterShard(
        address shard
    ) external virtual onlyRole(MANAGER_ROLE) {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();

        if (!$.shards.remove(shard)) revert Strategy_ShardNotRegistered();

        if ($.defaultShard == shard) {
            $.defaultShard = address(0);
            emit DefaultShardSet(address(0), _msgSender());
        }
        emit ShardDeregistered(shard, _msgSender());
    }

    function setDefaultShard(address shard) external onlyRole(MANAGER_ROLE) {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        if (shard != address(0)) {
            if (!$.shards.contains(shard)) {
                revert Strategy_ShardNotRegistered();
            }
        }
        $.defaultShard = shard;
        emit DefaultShardSet(shard, _msgSender());
    }

    function defaultShard() public view returns (address) {
        return _getStrategyBaseUpgradeableStorage().defaultShard;
    }

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

    /// @dev One share unit in asset-conversion terms: `10 ** decimals()`. Centralised so the
    ///      exponentiation is emitted once rather than at every conversion site.
    function _oneShare() internal view returns (uint256) {
        return 10 ** decimals();
    }

    function _convertToShares(
        uint256 assets,
        Math.Rounding rounding
    ) internal view virtual returns (uint256) {
        return assets.mulDiv(_oneShare(), pricePerShare(), rounding);
    }

    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view virtual returns (uint256) {
        return shares.mulDiv(pricePerShare(), _oneShare(), rounding);
    }

    /// @notice Pauses deposit/mint entrypoints; distinct from ERC-20 transfer pause.
    function pauseDeposit() external onlyRole(STRATEGY_PAUSER_ROLE) {
        _pauseDeposit();
    }

    /// @notice Pauses redemption request entrypoints; distinct from ERC-20 transfer pause.
    function pauseRedeem() external onlyRole(STRATEGY_PAUSER_ROLE) {
        _pauseRedeem();
    }

    /// @notice Clears deposit pause only.
    function unpauseDeposit() external onlyRole(MANAGER_ROLE) {
        _unpauseDeposit();
    }

    /// @notice Clears redeem pause only.
    function unpauseRedeem() external onlyRole(MANAGER_ROLE) {
        _unpauseRedeem();
    }

    /// @return True if deposit/mint paths are paused.
    function depositPaused() public view returns (bool) {
        return _getStrategyBaseUpgradeableStorage().depositPaused;
    }

    /// @return True if redemption request paths are paused.
    function redeemPaused() public view returns (bool) {
        return _getStrategyBaseUpgradeableStorage().redeemPaused;
    }

    function _requireDepositNotPaused() internal view virtual {
        if (_getStrategyBaseUpgradeableStorage().depositPaused) {
            revert Strategy_EnforcedDepositPause();
        }
    }

    function _requireRedeemNotPaused() internal view virtual {
        if (_getStrategyBaseUpgradeableStorage().redeemPaused) {
            revert Strategy_EnforcedRedeemPause();
        }
    }

    function _pauseDeposit() internal virtual whenDepositNotPaused {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        $.depositPaused = true;
        emit DepositPaused(_msgSender());
    }

    function _pauseRedeem() internal virtual whenRedeemNotPaused {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        $.redeemPaused = true;
        emit RedeemPaused(_msgSender());
    }

    function _unpauseDeposit() internal virtual {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        if (!$.depositPaused) {
            revert Strategy_ExpectedDepositPause();
        }
        $.depositPaused = false;
        emit DepositUnpaused(_msgSender());
    }

    function _unpauseRedeem() internal virtual {
        StrategyBaseUpgradeableStorage
            storage $ = _getStrategyBaseUpgradeableStorage();
        if (!$.redeemPaused) {
            revert Strategy_ExpectedRedeemPause();
        }
        $.redeemPaused = false;
        emit RedeemUnpaused(_msgSender());
    }

    function pause() external onlyRole(TRANSFERS_PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    /// @dev Compliance gate on every share balance change (transfer, mint, burn).
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20PausableUpgradeable) {
        _requireBlocklistAllows(from);
        _requireBlocklistAllows(to);
        super._update(from, to, value);
    }
}
