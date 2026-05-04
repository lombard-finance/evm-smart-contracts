// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAsyncRedemption} from "./interfaces/IAsyncRedemption.sol";
import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title AsyncRedemptionUpgradeable
/// @notice Asynchronous redemption: burns shares on `requestRedeem`, pays underlying on `fulfillRedeemRequests` by accounts with `OPERATOR_ROLE`, optional withdrawal fee in shares.
abstract contract AsyncRedemptionUpgradeable is
    VaultBaseUpgradeable,
    IAsyncRedemption
{
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @dev Per `requestRedeem` ticket; global totals mirror open requests.
    struct RedeemRequest {
        uint256 pendingShares;
        uint256 pendingAssets;
        address owner;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.AsyncRedemptionUpgradeable
    struct AsyncRedemptionStorage {
        uint256 totalPendingShares;
        uint256 totalPendingAssets;
        uint256 nextRequestId;
        mapping(uint256 requestId => RedeemRequest) redeemRequestById;
        uint16 withdrawalFeeBps;
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
    function setWithdrawalFeeBps(
        uint16 bps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps >= _BPS_DENOMINATOR)
            revert AsyncRedemption_WithdrawalFeeBpsTooHigh(bps);
        _getAsyncRedemptionStorage().withdrawalFeeBps = bps;
        emit WithdrawalFeeBpsSet(bps);
    }

    /// @return Withdrawal fee in basis points (same units as {setWithdrawalFeeBps}).
    function withdrawalFee() external view returns (uint16) {
        return _getAsyncRedemptionStorage().withdrawalFeeBps;
    }

    /// @inheritdoc IAsyncRedemption
    function requestRedeem(
        uint256 shares,
        address owner
    )
        external
        override
        nonReentrant
        whenVaultNotPaused
        returns (uint256 requestId)
    {
        AsyncRedemptionStorage storage $ = _getAsyncRedemptionStorage();
        if (shares == 0) revert AsyncRedemption_ZeroRedeemRequestShares();

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
        uint16 feeBps = $.withdrawalFeeBps;
        if (feeBps > 0 && treasury_ != address(0)) {
            feeShares = shares.mulDiv(
                feeBps,
                _BPS_DENOMINATOR,
                Math.Rounding.Floor
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
            emit WithdrawalFeeCharged(treasury_, feeShares);
        }
        emit RedeemRequested(requestId, owner, caller, shares);
    }

    /// @notice Pays underlying against queued requests; requires `OPERATOR_ROLE`.
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
            emit Withdraw(msgSender, owner, assets, shares);
        }

        emit RedeemRequestsFulfilled(requestIds);
    }

    /// @inheritdoc IAsyncRedemption
    function pendingRedeemRequest(
        uint256 requestId_
    ) external view override returns (uint256 shares) {
        return
            _getAsyncRedemptionStorage()
                .redeemRequestById[requestId_]
                .pendingShares;
    }

    /// @dev Passthrough for diamond inheritance with `MultiAssetDepositUpgradeable`.
    function _afterStrategyDeregistered(
        address strategy
    ) internal virtual override {
        super._afterStrategyDeregistered(strategy);
    }
}
