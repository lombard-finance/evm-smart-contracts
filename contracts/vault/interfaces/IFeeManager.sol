// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IFeeManager {
    event ManagementFeeBpsSet(uint16 bps);
    event PerformanceFeeBpsSet(uint16 bps);
    event ManagementFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 elapsed
    );
    event PerformanceFeeHarvested(
        address indexed to,
        uint256 shares,
        uint256 oldHighWaterMark,
        uint256 newHighWaterMark
    );

    error ManagementFeeBpsTooHigh();
    error PerformanceFeeBpsTooHigh();
    error NothingToHarvest();
    error PriceAtOrBelowHighWaterMark();

    function setManagementFeeBps(uint16 bps) external;

    function setPerformanceFeeBps(uint16 bps) external;

    function harvestManagementFee(address to) external;

    function harvestPerformanceFee(address to) external;

    function managementFeeBps() external view returns (uint16);

    function performanceFeeBps() external view returns (uint16);

    function lastFeeHarvestAt() external view returns (uint48);

    function highWaterMark() external view returns (uint256);

    function previewManagementFee() external view returns (uint256 shares);

    function previewPerformanceFee() external view returns (uint256 shares);
}
