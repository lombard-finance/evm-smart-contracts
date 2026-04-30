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
abstract contract MultiAssetDepositUpgradeable is
    FeeManagerUpgradeable,
    IMultiAssetDeposit
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @dev Upper bound for fee denominator (100%).
    uint256 private constant _BPS_DENOMINATOR = 10_000;

    /// @custom:storage-location erc7201:lombardfinance.storage.MultiAssetDepositUpgradeable
    struct MultiAssetDepositStorage {
        EnumerableSet.AddressSet depositAssets;
        mapping(address token => uint16) depositFeeBps;
        mapping(address token => IAssetConverter) converters;
        mapping(address token => uint256) accruedDepositFees;
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

    function __MultiAssetDeposit_init() internal onlyInitializing {}

    /// @notice Register a token as a deposit asset with pricing adapter and fee in basis points.
    function addDepositAsset(
        address depositAsset,
        IAssetConverter assetConverter_,
        uint16 depositFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _registerDepositAsset(depositAsset, assetConverter_, depositFeeBps_);
    }

    function removeDepositAsset(
        address depositAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if ($.accruedDepositFees[depositAsset] != 0) {
            revert AccruedFeesNotClaimed(depositAsset);
        }
        if (!$.depositAssets.remove(depositAsset)) {
            revert DepositAssetNotListed(depositAsset);
        }
        delete $.depositFeeBps[depositAsset];
        delete $.converters[depositAsset];
        emit DepositAssetRemoved(depositAsset);
    }

    function setAssetConverter(
        address depositAsset,
        IAssetConverter assetConverter_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            revert DepositAssetNotListed(depositAsset);
        }
        if (address(assetConverter_) == address(0)) {
            revert ZeroAddress();
        }
        $.converters[depositAsset] = assetConverter_;
        emit DepositAssetConverterSet(depositAsset, address(assetConverter_));
    }

    function setDepositFeeBps(
        address depositAsset,
        uint16 depositFeeBps_
    ) external onlyRole(TREASURY_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            revert DepositAssetNotListed(depositAsset);
        }
        if (depositFeeBps_ >= _BPS_DENOMINATOR) {
            revert DepositFeeBpsTooHigh();
        }
        $.depositFeeBps[depositAsset] = depositFeeBps_;
        emit DepositFeeBpsSet(depositAsset, depositFeeBps_);
    }

    function _registerDepositAsset(
        address depositAsset,
        IAssetConverter assetConverter_,
        uint16 depositFeeBps_
    ) private {
        if (
            depositAsset == address(0) || address(assetConverter_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (depositFeeBps_ >= _BPS_DENOMINATOR) {
            revert DepositFeeBpsTooHigh();
        }
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.add(depositAsset)) {
            revert DepositAssetAlreadyAdded(depositAsset);
        }
        $.depositFeeBps[depositAsset] = depositFeeBps_;
        $.converters[depositAsset] = assetConverter_;
        emit DepositAssetAdded(_msgSender(), depositAsset);
        emit DepositFeeBpsSet(depositAsset, depositFeeBps_);
        emit DepositAssetConverterSet(depositAsset, address(assetConverter_));
    }

    function isDepositAsset(address depositAsset) public view returns (bool) {
        return
            _getMultiAssetDepositStorage().depositAssets.contains(depositAsset);
    }

    function depositFeeBps(address depositAsset) public view returns (uint16) {
        return _getMultiAssetDepositStorage().depositFeeBps[depositAsset];
    }

    function converterOf(
        address depositAsset
    ) public view returns (IAssetConverter) {
        return _getMultiAssetDepositStorage().converters[depositAsset];
    }

    function accruedDepositFees(
        address depositAsset
    ) public view returns (uint256) {
        return _getMultiAssetDepositStorage().accruedDepositFees[depositAsset];
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
        whenVaultNotPaused
        returns (uint256)
    {
        uint256 maxAssets = maxDeposit(depositAsset, receiver);
        if (assets > maxAssets) {
            revert ExceededMaxDeposit(
                receiver,
                depositAsset,
                assets,
                maxAssets
            );
        }

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
        whenVaultNotPaused
        returns (uint256)
    {
        uint256 maxAssets = maxDeposit(depositAsset, receiver);
        if (assets > maxAssets) {
            revert ExceededMaxDeposit(
                receiver,
                depositAsset,
                assets,
                maxAssets
            );
        }

        uint256 shares = previewDeposit(depositAsset, assets);
        if (shares < minSharesOut) {
            revert InsufficientSharesOut(shares, minSharesOut);
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
        whenVaultNotPaused
        returns (uint256)
    {
        uint256 maxShares = maxMint(depositAsset, receiver);
        if (shares > maxShares) {
            revert ExceededMaxMint(receiver, depositAsset, shares, maxShares);
        }

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
        whenVaultNotPaused
        returns (uint256)
    {
        uint256 maxShares = maxMint(depositAsset, receiver);
        if (shares > maxShares) {
            revert ExceededMaxMint(receiver, depositAsset, shares, maxShares);
        }

        uint256 assets = previewMint(depositAsset, shares);
        if (assets > maxAssetsIn) {
            revert ExcessiveAssetsIn(assets, maxAssetsIn);
        }
        _deposit(_msgSender(), receiver, depositAsset, assets, shares);

        return assets;
    }

    function _deposit(
        address caller,
        address receiver,
        address depositAsset,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        // Interaction first: pull tokens before minting shares so that any hook
        // fired during the transfer (e.g. ERC-777) observes a consistent state
        // (totalSupply not yet inflated without matching assets).
        IERC20(depositAsset).safeTransferFrom(caller, address(this), assets);

        (uint256 fee, ) = _splitDepositFeeView(depositAsset, assets);
        if (fee > 0) {
            MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
            $.accruedDepositFees[depositAsset] += fee;
            emit DepositFeeAccrued(depositAsset, fee);
        }

        _mint(receiver, shares);
        emit Deposit(caller, receiver, depositAsset, assets, shares);
    }

    /// @notice Treasury pulls accrued deposit fees for `token` (same ERC-20 units as deposits).
    function claimDepositFees(
        address depositAsset,
        address to,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        uint256 acc = $.accruedDepositFees[depositAsset];
        if (amount > acc) {
            revert ClaimExceedsAccrued();
        }
        $.accruedDepositFees[depositAsset] = acc - amount;
        IERC20(depositAsset).safeTransfer(to, amount);
        emit DepositFeesClaimed(depositAsset, to, amount);
    }

    function maxDeposit(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (
            !_getMultiAssetDepositStorage().depositAssets.contains(depositAsset)
        ) return 0;
        return type(uint256).max;
    }

    function maxMint(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (
            !_getMultiAssetDepositStorage().depositAssets.contains(depositAsset)
        ) return 0;
        return type(uint256).max;
    }

    /// @dev Preview deposit assets to shares
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
        (, uint256 net) = _splitDepositFeeView(depositAsset, assets);
        uint256 btcOut = IAssetConverter($.converters[depositAsset]).toBtcUnits(
            net
        );
        return _convertToShares(btcOut, Math.Rounding.Floor);
    }

    /// @dev Preview mint shares to assets
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
        uint256 btcIn = _convertToAssets(shares, Math.Rounding.Ceil);
        uint256 net = IAssetConverter($.converters[depositAsset]).toTokenAmount(
            btcIn
        );
        uint16 bps = $.depositFeeBps[depositAsset];
        return
            net.mulDiv(
                _BPS_DENOMINATOR,
                _BPS_DENOMINATOR - bps,
                Math.Rounding.Ceil
            );
    }

    /// @dev Convert assets to shares (excluding fees)
    function convertToShares(
        address depositAsset,
        uint256 assets
    ) public view virtual returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        uint256 btcOut = $.converters[depositAsset].toBtcUnits(assets);
        return _convertToShares(btcOut, Math.Rounding.Floor);
    }

    /// @dev Convert shares to assets (excluding fees)
    function convertToAssets(
        address depositAsset,
        uint256 shares
    ) public view virtual returns (uint256) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            return 0;
        }
        uint256 btcIn = _convertToAssets(shares, Math.Rounding.Ceil);
        return $.converters[depositAsset].toTokenAmount(btcIn);
    }

    function _splitDepositFeeView(
        address token,
        uint256 gross
    ) private view returns (uint256 fee, uint256 net) {
        uint256 bps = _getMultiAssetDepositStorage().depositFeeBps[token];
        fee = gross.mulDiv(bps, _BPS_DENOMINATOR, Math.Rounding.Floor);
        net = gross - fee;
    }
}
