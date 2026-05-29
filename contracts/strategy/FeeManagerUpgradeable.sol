// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFeeManager} from "./interfaces/IFeeManager.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title FeeManagerUpgradeable
/// @notice Management and performance fee module minting fee shares to treasury; see `IFeeManager` for economics.
/// @dev Expects `__FeeManager_init` after `__StrategyBase_init` so `pricePerShare` and time basis are initialised.
///      Management fee accrual uses `totalSupply()` as the share base, so prior management-fee mints held by
///      `managementFeeTreasury` compound into later accruals (intended; treasury balance is not excluded).
/// @custom:security-contact legal@lombard.finance
///      Fee mints do not reduce `pricePerShare`; posted NAV (`totalAssets`) may read above custody until the next
///      `postPricePerShare`.
abstract contract FeeManagerUpgradeable is
    StrategyBaseUpgradeable,
    IFeeManager
{
    using Math for uint256;

    bytes32 public constant PERF_FEE_CLAIM_ROLE =
        keccak256("PERF_FEE_CLAIM_ROLE");

    uint256 private constant _SECONDS_PER_YEAR = 365 days;

    /// @custom:storage-location erc7201:lombardfinance.storage.FeeManagerUpgradeable
    struct FeeManagerStorage {
        uint16 managementFeeBps;
        uint16 performanceFeeBps;
        uint48 lastFeeHarvestAt;
        address managementFeeTreasury;
        uint256 highWaterMark;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.FeeManagerUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FEE_MANAGER_STORAGE_LOCATION =
        0x6bb04eeeee847b5e3aec88250f97eced827d7fe428b8447f130d46e548afb100;

    function _getFeeManagerStorage()
        internal
        pure
        returns (FeeManagerStorage storage $)
    {
        assembly {
            $.slot := FEE_MANAGER_STORAGE_LOCATION
        }
    }

    /// @dev Must be called after {__StrategyBase_init} — reads pricePerShare() which is initialised there.
    /// @param managementFeeTreasury_ Recipient for management fee share mints; must not be zero.
    function __FeeManager_init(
        address managementFeeTreasury_
    ) internal onlyInitializing {
        if (managementFeeTreasury_ == address(0)) revert Strategy_ZeroAddress();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.highWaterMark = pricePerShare();
        $.lastFeeHarvestAt = uint48(block.timestamp);
        $.managementFeeTreasury = managementFeeTreasury_;
    }

    /// @notice Sets management fee treasury address.
    /// @param treasury Address receiving management fee share mints.
    function setManagementFeeTreasury(
        address treasury
    ) external onlyRole(MANAGER_ROLE) {
        if (treasury == address(0)) revert Strategy_ZeroAddress();
        _getFeeManagerStorage().managementFeeTreasury = treasury;
        emit ManagementFeeTreasurySet(_msgSender(), treasury);
    }

    /// @notice Sets management fee in basis points after accruing at the **prior** rate (updates `lastFeeHarvestAt`), so the new rate applies only from this timestamp onward.
    /// @param bps Fee rate; must be strictly less than 10000.
    function setManagementFeeBps(
        uint16 bps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (bps >= _BPS_DENOMINATOR)
            revert FeeManager_ManagementFeeBpsTooHigh(bps);
        _accrueManagementFee();
        _getFeeManagerStorage().managementFeeBps = bps;
        emit ManagementFeeBpsSet(_msgSender(), bps);
    }

    /// @dev Exact management fee accrual hook. Call unconditionally before user share mint/burn operations.
    ///      Accrues at current `managementFeeBps` / `lastFeeHarvestAt`, minting dilution shares to
    ///      `managementFeeTreasury` without changing `pricePerShare`. The share base is full `totalSupply()`,
    ///      including shares already minted to the treasury on prior accruals, so the effective rate compounds
    ///      on treasury holdings.
    function _accrueManagementFee() internal virtual {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        (uint256 shares, uint256 elapsed) = _computeManagementFeeShares(
            $.lastFeeHarvestAt,
            $.managementFeeBps,
            totalSupply()
        );
        $.lastFeeHarvestAt = uint48(block.timestamp);
        if (shares == 0) {
            return;
        }
        _mint($.managementFeeTreasury, shares);
        emit ManagementFeeHarvested($.managementFeeTreasury, shares, elapsed);
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

    /// @dev Harvests performance fee at current `performanceFeeBps` / `highWaterMark`. Mints shares without
    ///      reducing `pricePerShare`; raises HWM to the pre-mint posted rate.
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
        returns (
            uint16 feeBps,
            uint48 lastHarvestAt,
            address managementFeeTreasury_
        )
    {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        feeBps = $.managementFeeBps;
        lastHarvestAt = $.lastFeeHarvestAt;
        managementFeeTreasury_ = $.managementFeeTreasury;
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

    /// @dev Computes the management fee shares to mint, grossed up for self-dilution. The configured rate maps
    ///      to a value fraction `f = bps * elapsed / (_BPS_DENOMINATOR * _SECONDS_PER_YEAR)` that holders should
    ///      be charged over `elapsed`. Because fee shares dilute themselves the instant they are minted, minting
    ///      `totalSupply * f` would leave the treasury owning only `f / (1 + f)` of the post-mint supply. To make
    ///      the treasury own exactly `f`, solve `x / (totalSupply + x) = f` ⇒ mint `totalSupply * f / (1 - f)`,
    ///      i.e. `totalSupply * num / (den - num)`.
    ///
    ///      The charged interval is capped at one year. Since every `bps` setter enforces `bps < _BPS_DENOMINATOR`,
    ///      this guarantees `num <= (_BPS_DENOMINATOR - 1) * _SECONDS_PER_YEAR < den`, so `den - num >= _SECONDS_PER_YEAR > 0`:
    ///      the gross-up never divides by zero and never reverts in the deposit/redeem hot paths that call this.
    ///      Dormancy beyond one year is not charged — a linear annual rate is undefined past 100% and the gross-up
    ///      would otherwise diverge. The returned `elapsed` is the *charged* interval (also capped at one year), so
    ///      the {ManagementFeeHarvested} `(shares, elapsed)` pair it feeds is always mutually consistent; the true
    ///      wall-clock gap is recoverable from `managementFee().lastHarvestAt` and the prior harvest.
    ///
    ///      `totalSupply` is the full outstanding share count (user + treasury). Fee shares previously minted to
    ///      `managementFeeTreasury` remain in that supply and therefore increase later accruals.
    function _computeManagementFeeShares(
        uint48 lastFeeHarvestAt,
        uint16 bps,
        uint256 totalSupply
    ) internal view returns (uint256 shares, uint256 elapsed) {
        elapsed = block.timestamp - uint256(lastFeeHarvestAt);
        if (bps == 0 || totalSupply == 0 || elapsed == 0) return (0, elapsed);
        // Cap the charged interval at one year so that, with bps < _BPS_DENOMINATOR, num stays strictly below den.
        // `elapsed` is also what {ManagementFeeHarvested} reports, so capping it (not just the share base) keeps the
        // emitted (shares, elapsed) pair consistent: shares always reflect exactly `elapsed` of accrual.
        elapsed = Math.min(elapsed, _SECONDS_PER_YEAR);
        // bps <= 9_999 < 2^14, elapsed <= _SECONDS_PER_YEAR < 2^25 → num < 2^39, no overflow.
        uint256 num = uint256(bps) * elapsed;
        uint256 den = _BPS_DENOMINATOR * _SECONDS_PER_YEAR;
        // Gross-up: totalSupply * f / (1 - f) = totalSupply * num / (den - num); den - num >= _SECONDS_PER_YEAR.
        shares = totalSupply.mulDiv(num, den - num, Math.Rounding.Floor);
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
