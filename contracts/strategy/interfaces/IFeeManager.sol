// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IFeeManager
/// @notice Management fee (time-based, dilution) and performance fee (high-water-mark on `pricePerShare`) harvested as newly minted strategy shares.
/// @dev Basis points use `10_000 = 100%`. Fees mint shares to `to` without pulling underlying assets or reducing
///      posted `pricePerShare`; `totalAssets()` may overstate economic NAV until the next `postPricePerShare`
///      reconciles fee-minted supply against operator NAV.
///      Management fee share math uses full `totalSupply()`; treasury-held fee shares compound into later accruals.
interface IFeeManager {
    /// @notice Annual management fee rate was updated (bps).
    event ManagementFeeBpsSet(address indexed account, uint16 bps);

    /// @notice Performance fee rate was updated (bps).
    event PerformanceFeeBpsSet(address indexed account, uint16 bps);

    /// @notice Management fee shares were minted to `to`.
    event ManagementFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 elapsed
    );

    /// @notice Management fee treasury updated.
    event ManagementFeeTreasurySet(
        address indexed account,
        address indexed treasury
    );

    /// @notice Performance fee shares were minted after NAV exceeded the prior high-water mark.
    event PerformanceFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 oldHighWaterMark,
        uint256 newHighWaterMark
    );

    /// @param bps The management fee rate that failed validation (must be < 10_000).
    error FeeManager_ManagementFeeBpsTooHigh(uint16 bps);
    /// @param bps The performance fee rate that failed validation (must be < 10_000).
    error FeeManager_PerformanceFeeBpsTooHigh(uint16 bps);
    /// @dev Accrued fee shares require a non-zero recipient when settling via fee `bps` setters.
    error FeeManager_FeeRecipientRequired();
    /// @param pricePerShare Current `pricePerShare` when the harvest was attempted.
    /// @param highWaterMark Stored high-water mark that was not exceeded.
    error FeeManager_PriceAtOrBelowHighWaterMark(
        uint256 pricePerShare,
        uint256 highWaterMark
    );

    /// @return feeBps Configured management fee in basis points.
    /// @return lastHarvestAt Last management fee accrual timestamp (unix seconds); accrual clock starts here.
    /// @return managementFeeTreasury Address receiving management fee share mints.
    function managementFee()
        external
        view
        returns (
            uint16 feeBps,
            uint48 lastHarvestAt,
            address managementFeeTreasury
        );

    /// @return feeBps Configured performance fee in basis points.
    /// @return previewShares Shares that would be minted if `harvestPerformanceFee` succeeded now (0 if at/below HWM).
    /// @return performanceHighWaterMark Stored high-water mark for performance fee (`pricePerShare` units).
    function performanceFee()
        external
        view
        returns (
            uint16 feeBps,
            uint256 previewShares,
            uint256 performanceHighWaterMark
        );
}
