// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAssetConverter} from "./interfaces/IAssetConverter.sol";
import {IMultiAssetDeposit} from "./interfaces/IMultiAssetDeposit.sol";
import {FeeManagerUpgradeable} from "./FeeManagerUpgradeable.sol";

/// @title MultiAssetDepositUpgradeable
/// @notice Multi-asset deposits and mints: listed ERC-20s convert via `IAssetConverter` into strategy base units, then into shares; optional per-asset deposit fees route immediately to the strategy fee treasury (`feeTreasury` / `setFeeTreasury`).
/// @dev Composes `FeeManagerUpgradeable`; deposit paths pull ERC-20 **before** minting shares. Extend `_deposit` / previews in subclasses if accounting changes.
abstract contract MultiAssetDepositUpgradeable is
    FeeManagerUpgradeable,
    IMultiAssetDeposit
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:lombardfinance.storage.MultiAssetDepositUpgradeable
    struct MultiAssetDepositStorage {
        EnumerableSet.AddressSet depositAssets;
        mapping(address token => uint16) depositFeeBps;
        mapping(address token => IAssetConverter) converters;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.MultiAssetDepositUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MULTI_ASSET_DEPOSIT_STORAGE_LOCATION =
        0x205ebf402180340af1992a5cf7a005100053ec859585a3da270f4e9a29e85400;

    function _getMultiAssetDepositStorage()
        private
        pure
        returns (MultiAssetDepositStorage storage $)
    {
        assembly {
            $.slot := MULTI_ASSET_DEPOSIT_STORAGE_LOCATION
        }
    }

    /// @dev No-op today; call after `__FeeManager_init(managementFeeTreasury)` in concrete initializers to keep a stable extension point.
    function __MultiAssetDeposit_init() internal onlyInitializing {}

    /// @notice Register `depositAsset` with converter and deposit fee (bps strictly less than 10_000).
    /// @param depositAsset ERC-20 token users may deposit.
    /// @param assetConverter_ Pricing adapter to strategy base units.
    /// @param depositFeeBps_ Fee on gross deposit, in basis points.
    function addDepositAsset(
        address depositAsset,
        IAssetConverter assetConverter_,
        uint16 depositFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _registerDepositAsset(depositAsset, assetConverter_, depositFeeBps_);
    }

    /// @notice Remove `depositAsset` from the allowlist.
    function removeDepositAsset(
        address depositAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.remove(depositAsset)) {
            revert StrategyDeposit_AssetNotListed(depositAsset);
        }
        delete $.depositFeeBps[depositAsset];
        delete $.converters[depositAsset];
        emit DepositAssetRemoved(depositAsset);
    }

    /// @notice Updates the converter used to price `depositAsset`.
    /// @param assetConverter_ Must not be zero address.
    function setAssetConverter(
        address depositAsset,
        IAssetConverter assetConverter_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            revert StrategyDeposit_AssetNotListed(depositAsset);
        }
        if (address(assetConverter_) == address(0))
            revert Strategy_ZeroAddress();
        $.converters[depositAsset] = assetConverter_;
        emit DepositAssetConverterSet(depositAsset, address(assetConverter_));
    }

    /// @notice Sets deposit fee bps for a listed asset (`bps` strictly below 10_000).
    function setDepositFeeBps(
        address depositAsset,
        uint16 depositFeeBps_
    ) external onlyRole(MANAGER_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            revert StrategyDeposit_AssetNotListed(depositAsset);
        }
        if (depositFeeBps_ >= _BPS_DENOMINATOR)
            revert StrategyDeposit_FeeBpsTooHigh(depositFeeBps_);
        $.depositFeeBps[depositAsset] = depositFeeBps_;
        emit DepositFeeBpsSet(depositAsset, depositFeeBps_);
    }

    function _registerDepositAsset(
        address depositAsset,
        IAssetConverter assetConverter_,
        uint16 depositFeeBps_
    ) private {
        if (depositAsset == address(0)) revert Strategy_ZeroAddress();
        if (address(assetConverter_) == address(0))
            revert Strategy_ZeroAddress();
        if (depositFeeBps_ >= _BPS_DENOMINATOR)
            revert StrategyDeposit_FeeBpsTooHigh(depositFeeBps_);
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.add(depositAsset)) {
            revert StrategyDeposit_AssetAlreadyAdded(depositAsset);
        }
        $.depositFeeBps[depositAsset] = depositFeeBps_;
        $.converters[depositAsset] = assetConverter_;
        emit DepositAssetAdded(_msgSender(), depositAsset);
        emit DepositFeeBpsSet(depositAsset, depositFeeBps_);
        emit DepositAssetConverterSet(depositAsset, address(assetConverter_));
    }

    /// @return True if `depositAsset` is listed for deposits.
    function isDepositAsset(address depositAsset) public view returns (bool) {
        return
            _getMultiAssetDepositStorage().depositAssets.contains(depositAsset);
    }

    /// @return Configured deposit fee in basis points for `depositAsset`.
    function depositFee(address depositAsset) public view returns (uint16) {
        return _getMultiAssetDepositStorage().depositFeeBps[depositAsset];
    }

    /// @return Converter contract used for `depositAsset`.
    function converterOf(
        address depositAsset
    ) public view returns (IAssetConverter) {
        return _getMultiAssetDepositStorage().converters[depositAsset];
    }

    function deposit(
        address depositAsset,
        uint256 assets,
        address receiver
    )
        public
        virtual
        override
        nonReentrant
        whenDepositNotPaused
        returns (uint256)
    {
        uint256 shares = previewDeposit(depositAsset, assets);
        _deposit(_msgSender(), receiver, depositAsset, assets, shares);

        return shares;
    }

    function deposit(
        address depositAsset,
        uint256 assets,
        address receiver,
        uint256 minSharesOut
    )
        public
        virtual
        override
        nonReentrant
        whenDepositNotPaused
        returns (uint256)
    {
        uint256 shares = previewDeposit(depositAsset, assets);
        if (shares < minSharesOut) {
            revert StrategyDeposit_InsufficientSharesOut(shares, minSharesOut);
        }
        _deposit(_msgSender(), receiver, depositAsset, assets, shares);

        return shares;
    }

    function mint(
        address depositAsset,
        uint256 shares,
        address receiver
    )
        public
        virtual
        override
        nonReentrant
        whenDepositNotPaused
        returns (uint256)
    {
        uint256 assets = previewMint(depositAsset, shares);
        _deposit(_msgSender(), receiver, depositAsset, assets, shares);

        return assets;
    }

    function mint(
        address depositAsset,
        uint256 shares,
        address receiver,
        uint256 maxAssetsIn
    )
        public
        virtual
        override
        nonReentrant
        whenDepositNotPaused
        returns (uint256)
    {
        uint256 assets = previewMint(depositAsset, shares);
        if (assets > maxAssetsIn) {
            revert StrategyDeposit_ExcessiveAssetsIn(assets, maxAssetsIn);
        }
        _deposit(_msgSender(), receiver, depositAsset, assets, shares);

        return assets;
    }

    function _deposit(
        address sender,
        address receiver,
        address depositAsset,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        _requireBlocklistAllows(sender);
        _requireBlocklistAllows(receiver);
        _accrueManagementFee();

        // Interaction first: pull tokens before minting shares so that any hook
        // fired during the transfer (e.g. ERC-777) observes a consistent state
        // (totalSupply not yet inflated without matching assets).
        IERC20(depositAsset).safeTransferFrom(sender, address(this), assets);

        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        (uint256 feeAssets, uint256 netAssets) = _splitDepositFeeView(
            $.depositFeeBps[depositAsset],
            assets
        );
        if (netAssets == 0) revert Strategy_ZeroAmount();
        if (feeAssets > 0) {
            address tr = feeTreasury();
            if (tr == address(0))
                revert StrategyDeposit_FeeTreasuryNotSet(depositAsset);
            IERC20(depositAsset).safeTransfer(tr, feeAssets);
            emit DepositFeeTransferred(depositAsset, tr, feeAssets);
        }

        _mint(receiver, shares);
        emit Deposit(
            sender,
            receiver,
            depositAsset,
            netAssets,
            shares,
            feeAssets
        );

        address ds = defaultShard();
        if (ds != address(0)) {
            IERC20(depositAsset).safeTransfer(ds, netAssets);
            emit DepositRoutedToDefaultShard(ds, depositAsset, netAssets);
        }
    }

    /// @inheritdoc IMultiAssetDeposit
    function maxDeposit(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (
            !_getMultiAssetDepositStorage().depositAssets.contains(
                depositAsset
            ) || depositPaused()
        ) return 0;
        return type(uint256).max;
    }

    /// @inheritdoc IMultiAssetDeposit
    function maxMint(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (depositPaused()) return 0;
        if (
            !_getMultiAssetDepositStorage().depositAssets.contains(depositAsset)
        ) return 0;
        return type(uint256).max;
    }

    /// @inheritdoc IMultiAssetDeposit
    function previewDeposit(
        address depositAsset,
        uint256 assets
    ) public view virtual returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        if (assets == 0) {
            return 0;
        }
        (, uint256 net) = _splitDepositFeeView(
            $.depositFeeBps[depositAsset],
            assets
        );
        uint256 assetsOut = IAssetConverter($.converters[depositAsset])
            .toBaseUnits(net, Math.Rounding.Floor);
        return _convertToShares(assetsOut, Math.Rounding.Floor);
    }

    /// @inheritdoc IMultiAssetDeposit
    function previewMint(
        address depositAsset,
        uint256 shares
    ) public view virtual override returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        if (shares == 0) {
            return 0;
        }
        uint256 assetsIn = _convertToAssets(shares, Math.Rounding.Ceil);
        uint256 net = IAssetConverter($.converters[depositAsset]).fromBaseUnits(
            assetsIn,
            Math.Rounding.Ceil
        );
        uint16 bps = $.depositFeeBps[depositAsset];
        return
            net.mulDiv(
                _BPS_DENOMINATOR,
                _BPS_DENOMINATOR - bps,
                Math.Rounding.Ceil
            );
    }

    /// @inheritdoc IMultiAssetDeposit
    function convertToShares(
        address depositAsset,
        uint256 assets
    ) public view virtual returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        uint256 assetsOut = $.converters[depositAsset].toBaseUnits(
            assets,
            Math.Rounding.Floor
        );
        return _convertToShares(assetsOut, Math.Rounding.Floor);
    }

    /// @inheritdoc IMultiAssetDeposit
    function convertToAssets(
        address depositAsset,
        uint256 shares
    ) public view virtual returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        uint256 assetsIn = _convertToAssets(shares, Math.Rounding.Floor);
        return
            $.converters[depositAsset].fromBaseUnits(
                assetsIn,
                Math.Rounding.Ceil
            );
    }

    function _splitDepositFeeView(
        uint16 bps,
        uint256 gross
    ) private pure returns (uint256 fee, uint256 net) {
        fee = gross.mulDiv(bps, _BPS_DENOMINATOR, Math.Rounding.Ceil);
        net = gross - fee;
    }
}
