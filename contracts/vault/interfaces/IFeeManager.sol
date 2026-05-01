// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IFeeManager
/// @notice Management fee (time-based, dilution) and performance fee (high-water-mark on `pricePerShare`) harvested as newly minted vault shares.
/// @dev Basis points use `10_000 = 100%`. Fees mint shares to `to` without pulling underlying assets.
interface IFeeManager {
    /// @notice Annual management fee rate was updated (bps).
    event ManagementFeeBpsSet(uint16 bps);

    /// @notice Performance fee rate was updated (bps).
    event PerformanceFeeBpsSet(uint16 bps);

    /// @notice Management fee shares were minted to `to`.
    event ManagementFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 elapsed
    );

    /// @notice Performance fee shares were minted after NAV exceeded the prior high-water mark.
    event PerformanceFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 oldHighWaterMark,
        uint256 newHighWaterMark
    );

    error FeeManager_ManagementFeeBpsTooHigh();
    error FeeManager_PerformanceFeeBpsTooHigh();
    error FeeManager_NothingToHarvest();
    error FeeManager_PriceAtOrBelowHighWaterMark();

    /// @notice Sets management fee in basis points; resets last harvest timestamp tracking.
    /// @param bps Fee rate; must be strictly less than 10000.
    function setManagementFeeBps(uint16 bps) external;

    /// @notice Sets performance fee in basis points and resets high-water mark to current `pricePerShare`.
    /// @param bps Fee rate; must be strictly less than 10000.
    function setPerformanceFeeBps(uint16 bps) external;

    /// @notice Mint management fee shares accrued since `lastFeeHarvestAt` to `to`.
    /// @param to Recipient of minted shares (must not be zero).
    function harvestManagementFee(address to) external;

    /// @notice Mint performance fee shares if `pricePerShare` exceeds `highWaterMark`, then raise HWM.
    /// @param to Recipient of minted shares (must not be zero).
    function harvestPerformanceFee(address to) external;

    /// @return Current management fee in basis points.
    function managementFeeBps() external view returns (uint16);

    /// @return Current performance fee in basis points.
    function performanceFeeBps() external view returns (uint16);

    /// @return Timestamp of the last management fee harvest (unix seconds).
    function lastFeeHarvestAt() external view returns (uint48);

    /// @return Performance fee high-water mark in `pricePerShare` units.
    function highWaterMark() external view returns (uint256);

    /// @return shares Management fee shares that would be minted if harvested now (preview only).
    function previewManagementFee() external view returns (uint256 shares);

    /// @return shares Performance fee shares that would be minted if harvested now (preview only).
    function previewPerformanceFee() external view returns (uint256 shares);
}
