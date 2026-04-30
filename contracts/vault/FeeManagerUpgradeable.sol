// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFeeManager} from "./interfaces/IFeeManager.sol";
import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title FeeManagerUpgradeable
abstract contract FeeManagerUpgradeable is VaultBaseUpgradeable, IFeeManager {
    using Math for uint256;

    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 private constant _BPS_DENOMINATOR = 10_000;
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

    function __FeeManager_init() internal onlyInitializing {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.highWaterMark = pricePerShare();
        $.lastFeeHarvestAt = uint48(block.timestamp);
    }

    function setManagementFeeBps(uint16 bps) external onlyRole(TREASURY_ROLE) {
        if (bps >= _BPS_DENOMINATOR) revert ManagementFeeBpsTooHigh();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.managementFeeBps = bps;
        $.lastFeeHarvestAt = uint48(block.timestamp);
        emit ManagementFeeBpsSet(bps);
    }

    function setPerformanceFeeBps(uint16 bps) external onlyRole(TREASURY_ROLE) {
        if (bps >= _BPS_DENOMINATOR) revert PerformanceFeeBpsTooHigh();
        _getFeeManagerStorage().performanceFeeBps = bps;
        emit PerformanceFeeBpsSet(bps);
    }

    function harvestManagementFee(
        address to
    ) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (uint256 shares, uint256 elapsed) = _computeManagementFeeShares();
        if (shares == 0) revert NothingToHarvest();
        _getFeeManagerStorage().lastFeeHarvestAt = uint48(block.timestamp);
        _mint(to, shares);
        emit ManagementFeeHarvested(to, shares, elapsed);
    }

    function harvestPerformanceFee(
        address to
    ) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        uint256 pps = pricePerShare();
        uint256 hwm = $.highWaterMark;
        if (pps <= hwm) revert PriceAtOrBelowHighWaterMark();
        (uint256 shares, , ) = _computePerformanceFeeShares();
        if (shares == 0) revert NothingToHarvest();
        $.highWaterMark = pps;
        _mint(to, shares);
        emit PerformanceFeeHarvested(to, shares, hwm, pps);
    }

    function managementFeeBps() external view returns (uint16) {
        return _getFeeManagerStorage().managementFeeBps;
    }

    function performanceFeeBps() external view returns (uint16) {
        return _getFeeManagerStorage().performanceFeeBps;
    }

    function lastFeeHarvestAt() external view returns (uint48) {
        return _getFeeManagerStorage().lastFeeHarvestAt;
    }

    function highWaterMark() external view returns (uint256) {
        return _getFeeManagerStorage().highWaterMark;
    }

    function previewManagementFee() external view returns (uint256 shares) {
        (shares, ) = _computeManagementFeeShares();
    }

    function previewPerformanceFee() external view returns (uint256 shares) {
        (shares, , ) = _computePerformanceFeeShares();
    }

    function _computeManagementFeeShares()
        internal
        view
        returns (uint256 shares, uint256 elapsed)
    {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        elapsed = block.timestamp - uint256($.lastFeeHarvestAt);
        uint256 supply = totalSupply();
        uint16 bps = $.managementFeeBps;
        if (bps == 0 || supply == 0 || elapsed == 0) return (0, elapsed);
        // bps <= 9_999 < 2^14, elapsed <= ~3.15e7 < 2^25 → product < 2^39, no overflow
        shares = supply.mulDiv(
            uint256(bps) * elapsed,
            _BPS_DENOMINATOR * _SECONDS_PER_YEAR,
            Math.Rounding.Floor
        );
    }

    function _computePerformanceFeeShares()
        internal
        view
        returns (uint256 shares, uint256 pps, uint256 hwm)
    {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        pps = pricePerShare();
        hwm = $.highWaterMark;
        uint256 supply = totalSupply();
        uint16 bps = $.performanceFeeBps;
        if (pps <= hwm || bps == 0 || supply == 0) return (0, pps, hwm);
        // Two-step mulDiv: avoids overflow for large pps values
        uint256 gainShares = supply.mulDiv(pps - hwm, hwm, Math.Rounding.Floor);
        shares = gainShares.mulDiv(bps, _BPS_DENOMINATOR, Math.Rounding.Floor);
    }
}
