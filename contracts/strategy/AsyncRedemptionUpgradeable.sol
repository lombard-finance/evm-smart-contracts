// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAsyncRedemption} from "./interfaces/IAsyncRedemption.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title AsyncRedemptionUpgradeable
/// @notice Asynchronous redemption: burns shares on `requestRedeem`, pays underlying on `fulfillRedeemRequests` by accounts with `PAY_REDEMPTIONS_ROLE`, optional redeem fee in shares.
abstract contract AsyncRedemptionUpgradeable is
    StrategyBaseUpgradeable,
    IAsyncRedemption
{
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:lombardfinance.storage.AsyncRedemptionUpgradeable
    struct AsyncRedemptionStorage {
        uint256 totalPendingShares;
        uint256 totalPendingAssets;
        uint256 nextRequestId;
        mapping(uint256 requestId => RedeemRequest) redeemRequestById;
        uint16 redeemFeeBps;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.AsyncRedemptionUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ASYNC_REDEMPTION_STORAGE_LOCATION =
        0x25e78afb9d99b38d9c6020ebddcb53d3b9fb3d72bf63e71ca23f105748bbaa00;

    function _getAsyncRedemptionStorage()
        internal
        pure
        returns (AsyncRedemptionStorage storage $)
    {
        assembly {
            $.slot := ASYNC_REDEMPTION_STORAGE_LOCATION
        }
    }

    function __AsyncRedemption_init() internal onlyInitializing {}

    /// @notice Fee taken as shares from `owner` on each `requestRedeem` and sent to {getFeeTreasury}.
    function setRedeemFeeBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps >= _BPS_DENOMINATOR)
            revert AsyncRedemption_RedeemFeeBpsTooHigh(bps);
        _getAsyncRedemptionStorage().redeemFeeBps = bps;
        emit RedeemFeeBpsSet(bps);
    }

    /// @return Redeem fee in basis points (same units as {setRedeemFeeBps}).
    function redeemFee() external view returns (uint16) {
        return _getAsyncRedemptionStorage().redeemFeeBps;
    }

    /// @notice Pending shares and underlying assets across all open redemption requests.
    /// @return totalPendingShares Aggregate burned shares not yet fulfilled.
    /// @return totalPendingAssets Aggregate underlying amount owed for open requests.
    function totalPending()
        external
        view
        returns (uint256 totalPendingShares, uint256 totalPendingAssets)
    {
        AsyncRedemptionStorage storage $ = _getAsyncRedemptionStorage();
        return ($.totalPendingShares, $.totalPendingAssets);
    }

    /// @inheritdoc IAsyncRedemption
    function requestRedeem(
        uint256 shares,
        address owner
    )
        external
        override
        nonReentrant
        whenStrategyNotPaused
        returns (uint256 requestId)
    {
        AsyncRedemptionStorage storage $ = _getAsyncRedemptionStorage();

        address caller = _msgSender();
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        return _requestRedeem($, shares, owner, caller);
    }

    /// @dev Records redeem ticket, burns net shares, routes fee shares to treasury.
    function _requestRedeem(
        AsyncRedemptionStorage storage $,
        uint256 shares,
        address owner,
        address caller
    ) private returns (uint256 requestId) {
        address treasury_ = feeTreasury();
        uint256 feeShares;
        uint16 feeBps = $.redeemFeeBps;
        if (feeBps > 0 && treasury_ != address(0)) {
            feeShares = shares.mulDiv(
                feeBps,
                _BPS_DENOMINATOR,
                Math.Rounding.Ceil
            );
        }
        // check that enough shares are left for the request
        if (feeShares >= shares) {
            revert AsyncRedemption_FeeSharesGreaterThanShares(
                feeShares,
                shares
            );
        }
        uint256 netShares = shares - feeShares;
        uint256 assets = _convertToAssets(netShares, Math.Rounding.Floor);
        requestId = ++$.nextRequestId;
        RedeemRequest storage rq = $.redeemRequestById[requestId];
        rq.pendingShares = netShares;
        rq.pendingAssets = assets;
        rq.owner = owner;

        $.totalPendingShares += netShares;
        $.totalPendingAssets += assets;

        _burn(owner, netShares);
        if (feeShares > 0) {
            _transfer(owner, treasury_, feeShares);
            emit RedeemFeeCharged(treasury_, feeShares);
        }
        emit RedeemRequested(
            requestId,
            owner,
            caller,
            assets,
            netShares,
            feeShares
        );
    }

    /// @notice Pays underlying against queued requests; requires `PAY_REDEMPTIONS_ROLE`.
    function fulfillRedeemRequests(
        uint256[] calldata requestIds
    ) external onlyRole(PAY_REDEMPTIONS_ROLE) nonReentrant {
        AsyncRedemptionStorage storage $ = _getAsyncRedemptionStorage();
        IERC20 asset_ = asset();
        address msgSender = _msgSender();
        uint256 n = requestIds.length;
        for (uint256 i; i < n; ++i) {
            uint256 rid = requestIds[i];
            RedeemRequest storage e = $.redeemRequestById[rid];
            uint256 assets = e.pendingAssets;
            uint256 shares = e.pendingShares;
            address owner = e.owner;

            if (assets == 0) {
                revert AsyncRedemption_NothingToFulfill(rid);
            }

            $.totalPendingShares -= shares;
            $.totalPendingAssets -= assets;
            delete $.redeemRequestById[rid];

            asset_.safeTransfer(owner, assets);
            emit Redeem(msgSender, owner, assets, shares);
        }

        emit RedeemRequestsFulfilled(requestIds);
    }

    /// @inheritdoc IAsyncRedemption
    function pendingRedeemRequest(
        uint256 requestId_
    ) external view override returns (RedeemRequest memory) {
        return _getAsyncRedemptionStorage().redeemRequestById[requestId_];
    }

    /// @dev Passthrough for diamond inheritance with `MultiAssetDepositUpgradeable`.
    function _afterShardDeregistered(address shard) internal virtual override {
        super._afterShardDeregistered(shard);
    }
}
