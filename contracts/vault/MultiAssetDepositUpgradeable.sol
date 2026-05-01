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
/// @notice Multi-asset deposits and mints: listed ERC-20s convert via `IAssetConverter` into vault base units, then into shares; optional per-asset deposit fees accrue to treasury.
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

    /// @dev No-op today; call after `__FeeManager_init` in concrete initializers to keep a stable extension point.
    function __MultiAssetDeposit_init() internal onlyInitializing {}

    /// @notice Register `depositAsset` with converter and deposit fee (bps strictly less than 10_000).
    /// @param depositAsset ERC-20 token users may deposit.
    /// @param assetConverter_ Pricing adapter to vault base units.
    /// @param depositFeeBps_ Fee on gross deposit, in basis points.
    function addDepositAsset(
        address depositAsset,
        IAssetConverter assetConverter_,
        uint16 depositFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _registerDepositAsset(depositAsset, assetConverter_, depositFeeBps_);
    }

    /// @notice Remove `depositAsset` from the allowlist (requires zero accrued fees for that token).
    function removeDepositAsset(
        address depositAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if ($.accruedDepositFees[depositAsset] != 0) {
            revert VaultDeposit_AccruedFeesNotClaimed(depositAsset);
        }
        if (!$.depositAssets.remove(depositAsset)) {
            revert VaultDeposit_AssetNotListed(depositAsset);
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
            revert VaultDeposit_AssetNotListed(depositAsset);
        }
        if (address(assetConverter_) == address(0)) {
            revert Vault_ZeroAddress();
        }
        $.converters[depositAsset] = assetConverter_;
        emit DepositAssetConverterSet(depositAsset, address(assetConverter_));
    }

    /// @notice Sets deposit fee bps for a listed asset (`bps` strictly below 10_000).
    function setDepositFeeBps(
        address depositAsset,
        uint16 depositFeeBps_
    ) external onlyRole(TREASURY_ROLE) {
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.contains(depositAsset)) {
            revert VaultDeposit_AssetNotListed(depositAsset);
        }
        if (depositFeeBps_ >= _BPS_DENOMINATOR) {
            revert VaultDeposit_FeeBpsTooHigh();
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
            revert Vault_ZeroAddress();
        }
        if (depositFeeBps_ >= _BPS_DENOMINATOR) {
            revert VaultDeposit_FeeBpsTooHigh();
        }
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        if (!$.depositAssets.add(depositAsset)) {
            revert VaultDeposit_AssetAlreadyAdded(depositAsset);
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
    function depositFeeBps(address depositAsset) public view returns (uint16) {
        return _getMultiAssetDepositStorage().depositFeeBps[depositAsset];
    }

    /// @return Converter contract used for `depositAsset`.
    function converterOf(
        address depositAsset
    ) public view returns (IAssetConverter) {
        return _getMultiAssetDepositStorage().converters[depositAsset];
    }

    /// @return Accrued deposit fee balance for `depositAsset` awaiting `claimDepositFees`.
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
            revert VaultDeposit_ExceededMaxDeposit(
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
            revert VaultDeposit_ExceededMaxDeposit(
                receiver,
                depositAsset,
                assets,
                maxAssets
            );
        }

        uint256 shares = previewDeposit(depositAsset, assets);
        if (shares < minSharesOut) {
            revert VaultDeposit_InsufficientSharesOut(shares, minSharesOut);
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
            revert VaultDeposit_ExceededMaxMint(
                receiver,
                depositAsset,
                shares,
                maxShares
            );
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
            revert VaultDeposit_ExceededMaxMint(
                receiver,
                depositAsset,
                shares,
                maxShares
            );
        }

        uint256 assets = previewMint(depositAsset, shares);
        if (assets > maxAssetsIn) {
            revert VaultDeposit_ExcessiveAssetsIn(assets, maxAssetsIn);
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
        // Interaction first: pull tokens before minting shares so that any hook
        // fired during the transfer (e.g. ERC-777) observes a consistent state
        // (totalSupply not yet inflated without matching assets).
        IERC20(depositAsset).safeTransferFrom(sender, address(this), assets);

        (uint256 fee, ) = _splitDepositFeeView(depositAsset, assets);
        if (fee > 0) {
            MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
            $.accruedDepositFees[depositAsset] += fee;
            emit DepositFeeAccrued(depositAsset, fee);
        }

        _mint(receiver, shares);
        emit Deposit(sender, receiver, depositAsset, assets, shares);
    }

    /// @notice Treasury pulls accrued deposit fees for `token` (same ERC-20 units as deposits).
    function claimDepositFees(
        address depositAsset,
        address to,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) {
        if (to == address(0)) {
            revert Vault_ZeroAddress();
        }
        MultiAssetDepositStorage storage $ = _getMultiAssetDepositStorage();
        uint256 acc = $.accruedDepositFees[depositAsset];
        if (amount > acc) {
            revert VaultDeposit_ClaimExceedsAccrued();
        }
        $.accruedDepositFees[depositAsset] = acc - amount;
        IERC20(depositAsset).safeTransfer(to, amount);
        emit DepositFeesClaimed(depositAsset, to, amount);
    }

    /// @inheritdoc IMultiAssetDeposit
    function maxDeposit(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (vaultOperationsPaused()) return 0;
        if (
            !_getMultiAssetDepositStorage().depositAssets.contains(depositAsset)
        ) return 0;
        return type(uint256).max;
    }

    /// @inheritdoc IMultiAssetDeposit
    function maxMint(
        address depositAsset,
        address
    ) public view virtual returns (uint256) {
        if (vaultOperationsPaused()) return 0;
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
        (, uint256 net) = _splitDepositFeeView(depositAsset, assets);
        uint256 btcOut = IAssetConverter($.converters[depositAsset])
            .toBaseUnits(net, Math.Rounding.Floor);
        return _convertToShares(btcOut, Math.Rounding.Floor);
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
        uint256 btcIn = _convertToAssets(shares, Math.Rounding.Ceil);
        uint256 net = IAssetConverter($.converters[depositAsset]).fromBaseUnits(
            btcIn,
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
        uint256 btcOut = $.converters[depositAsset].toBaseUnits(
            assets,
            Math.Rounding.Floor
        );
        return _convertToShares(btcOut, Math.Rounding.Floor);
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
        uint256 btcIn = _convertToAssets(shares, Math.Rounding.Ceil);
        return
            $.converters[depositAsset].fromBaseUnits(btcIn, Math.Rounding.Ceil);
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
