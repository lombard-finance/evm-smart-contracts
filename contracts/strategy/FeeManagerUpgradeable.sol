// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFeeManager} from "./interfaces/IFeeManager.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title FeeManagerUpgradeable
/// @notice Management and performance fee module minting fee shares to treasury; see `IFeeManager` for economics.
/// @dev Expects `__FeeManager_init` after `__StrategyBase_init` so `pricePerShare` and time basis are initialised.
abstract contract FeeManagerUpgradeable is
    StrategyBaseUpgradeable,
    IFeeManager
{
    using Math for uint256;

    bytes32 public constant MGMT_FEE_CLAIM_ROLE =
        keccak256("MGMT_FEE_CLAIM_ROLE");
    bytes32 public constant PERF_FEE_CLAIM_ROLE =
        keccak256("PERF_FEE_CLAIM_ROLE");

    uint256 private constant _SECONDS_PER_YEAR = 365 days;

    /// @custom:storage-location erc7201:lombardfinance.storage.FeeManagerUpgradeable
    struct FeeManagerStorage {
        uint16 managementFeeBps;
        uint16 performanceFeeBps;
        uint48 lastFeeHarvestAt;
        uint256 highWaterMark;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.FeeManagerUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FEE_MANAGER_STORAGE_LOCATION =
        0x6bb04eeeee847b5e3aec88250f97eced827d7fe428b8447f130d46e548afb100;

    function _getFeeManagerStorage()
        private
        pure
        returns (FeeManagerStorage storage $)
    {
        assembly {
            $.slot := FEE_MANAGER_STORAGE_LOCATION
        }
    }

    /// @dev Must be called after {__StrategyBase_init} — reads pricePerShare() which is initialised there.
    function __FeeManager_init() internal onlyInitializing {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.highWaterMark = pricePerShare();
        $.lastFeeHarvestAt = uint48(block.timestamp);
    }

    /// @notice Sets management fee in basis points after handling accrued management fee at the **prior** rate.
    /// @param bps Fee rate; must be strictly less than 10000.
    /// @param feeRecipient Recipient when `forfeitAccrued` is false and accrued shares are non-zero.
    /// @param forfeitAccrued If false, mint accrued fee shares to `feeRecipient`. If true, forfeit accrual (clock advances; fee stays with LPs).
    function setManagementFeeBps(
        uint16 bps,
        address feeRecipient,
        bool forfeitAccrued
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (bps >= _BPS_DENOMINATOR)
            revert FeeManager_ManagementFeeBpsTooHigh(bps);
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        _harvestManagementFee($, feeRecipient, forfeitAccrued);
        $.managementFeeBps = bps;
        emit ManagementFeeBpsSet(_msgSender(), bps);
    }

    /// @notice Mint management fee shares accrued since `lastFeeHarvestAt` to `feeRecipient`.
    /// @param feeRecipient Recipient of minted shares (must not be zero).
    function harvestManagementFee(
        address feeRecipient
    ) external onlyRole(MGMT_FEE_CLAIM_ROLE) nonReentrant {
        _harvestManagementFee(_getFeeManagerStorage(), feeRecipient, false);
    }

    /// @dev Harvests management fee at current `managementFeeBps` / `lastFeeHarvestAt`.
    /// @param forfeitAccrued If true and accrued shares are non-zero, advances `lastFeeHarvestAt` without minting (fee forfeited).
    function _harvestManagementFee(
        FeeManagerStorage storage $,
        address to,
        bool forfeitAccrued
    ) internal {
        (uint256 shares, uint256 elapsed) = _computeManagementFeeShares(
            $.lastFeeHarvestAt,
            $.managementFeeBps,
            totalSupply()
        );
        $.lastFeeHarvestAt = uint48(block.timestamp);
        if (shares == 0 || forfeitAccrued) {
            return;
        }
        if (to == address(0)) revert FeeManager_FeeRecipientRequired();
        _mint(to, shares);
        emit ManagementFeeHarvested(to, shares, elapsed);
    }

    /// @notice Sets performance fee in basis points after handling accrued performance fee at the **prior** rate, then resets high-water mark to current `pricePerShare`.
    /// @param bps Fee rate; must be strictly less than 10000.
    /// @param feeRecipient Recipient when `forfeitAccrued` is false and accrued shares are non-zero.
    /// @param forfeitAccrued If false, mint accrued performance fee to `feeRecipient`. If true, forfeit (reset HWM without minting that accrual).
    function setPerformanceFeeBps(
        uint16 bps,
        address feeRecipient,
        bool forfeitAccrued
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (bps >= _BPS_DENOMINATOR)
            revert FeeManager_PerformanceFeeBpsTooHigh(bps);
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        _harvestPerformanceFee($, feeRecipient, forfeitAccrued);
        $.performanceFeeBps = bps;
        emit PerformanceFeeBpsSet(_msgSender(), bps);
    }

    /// @notice Mint performance fee shares if `pricePerShare` exceeds `highWaterMark`, then raise HWM.
    /// @param feeRecipient Recipient of minted shares (must not be zero).
    function harvestPerformanceFee(
        address feeRecipient
    ) external onlyRole(PERF_FEE_CLAIM_ROLE) nonReentrant {
        _harvestPerformanceFee(_getFeeManagerStorage(), feeRecipient, false);
    }

    /// @dev Harvests performance fee at current `performanceFeeBps` / `highWaterMark`.
    /// @param forfeitAccrued If true and fee shares would be non-zero, skips mint; setter resets HWM.
    function _harvestPerformanceFee(
        FeeManagerStorage storage $,
        address to,
        bool forfeitAccrued
    ) internal {
        if (to == address(0)) revert FeeManager_FeeRecipientRequired();
        uint256 pps = pricePerShare();
        uint256 hwm = $.highWaterMark;
        if (pps <= hwm) {
            return;
        }
        uint256 shares = _computePerformanceFeeShares(
            pps,
            hwm,
            $.performanceFeeBps,
            totalSupply()
        );
        $.highWaterMark = pps;
        if (shares == 0 || forfeitAccrued) {
            return;
        }
        _mint(to, shares);
        emit PerformanceFeeHarvested(to, shares, hwm, pps);
    }

    /// @inheritdoc IFeeManager
    function managementFee()
        external
        view
        returns (uint16 feeBps, uint256 previewShares, uint48 lastHarvestAt)
    {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        feeBps = $.managementFeeBps;
        lastHarvestAt = $.lastFeeHarvestAt;
        (previewShares, ) = _computeManagementFeeShares(
            lastHarvestAt,
            feeBps,
            totalSupply()
        );
    }

    /// @inheritdoc IFeeManager
    function performanceFee()
        external
        view
        returns (
            uint16 feeBps,
            uint256 previewShares,
            uint256 performanceHighWaterMark
        )
    {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        feeBps = $.performanceFeeBps;
        performanceHighWaterMark = $.highWaterMark;
        previewShares = _computePerformanceFeeShares(
            pricePerShare(),
            performanceHighWaterMark,
            feeBps,
            totalSupply()
        );
    }

    function _computeManagementFeeShares(
        uint48 lastFeeHarvestAt,
        uint16 bps,
        uint256 totalSupply
    ) internal view returns (uint256 shares, uint256 elapsed) {
        elapsed = block.timestamp - uint256(lastFeeHarvestAt);
        if (bps == 0 || totalSupply == 0 || elapsed == 0) return (0, elapsed);
        // bps <= 9_999 < 2^14, elapsed <= ~3.15e7 < 2^25 → product < 2^39, no overflow
        shares = totalSupply.mulDiv(
            uint256(bps) * elapsed,
            _BPS_DENOMINATOR * _SECONDS_PER_YEAR,
            Math.Rounding.Floor
        );
    }

    function _computePerformanceFeeShares(
        uint256 pps,
        uint256 hwm,
        uint16 bps,
        uint256 totalSupply
    ) internal pure returns (uint256 shares) {
        if (pps <= hwm || bps == 0 || totalSupply == 0) return (0);
        // Two-step mulDiv: avoids overflow for large pps values
        uint256 gainShares = totalSupply.mulDiv(
            pps - hwm,
            hwm,
            Math.Rounding.Floor
        );
        shares = gainShares.mulDiv(bps, _BPS_DENOMINATOR, Math.Rounding.Floor);
    }
}
