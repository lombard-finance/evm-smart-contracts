// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFeeManager} from "./interfaces/IFeeManager.sol";
import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title FeeManagerUpgradeable
/// @notice Management and performance fee module minting fee shares to treasury; see `IFeeManager` for economics.
/// @dev Expects `__FeeManager_init` after `__VaultBase_init` so `pricePerShare` and time basis are initialised.
abstract contract FeeManagerUpgradeable is VaultBaseUpgradeable, IFeeManager {
    using Math for uint256;

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

    /// @dev Must be called after {__VaultBase_init} — reads pricePerShare() which is initialised there.
    function __FeeManager_init() internal onlyInitializing {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.highWaterMark = pricePerShare();
        $.lastFeeHarvestAt = uint48(block.timestamp);
    }

    /// @inheritdoc IFeeManager
    function setManagementFeeBps(uint16 bps) external onlyRole(TREASURY_ROLE) {
        if (bps >= _BPS_DENOMINATOR)
            revert FeeManager_ManagementFeeBpsTooHigh();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.managementFeeBps = bps;
        $.lastFeeHarvestAt = uint48(block.timestamp);
        emit ManagementFeeBpsSet(bps);
    }

    /// @inheritdoc IFeeManager
    function setPerformanceFeeBps(uint16 bps) external onlyRole(TREASURY_ROLE) {
        if (bps >= _BPS_DENOMINATOR)
            revert FeeManager_PerformanceFeeBpsTooHigh();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        $.performanceFeeBps = bps;
        $.highWaterMark = pricePerShare();
        emit PerformanceFeeBpsSet(bps);
    }

    /// @inheritdoc IFeeManager
    function harvestManagementFee(
        address to
    ) external onlyRole(TREASURY_ROLE) nonReentrant {
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        if (to == address(0)) revert Vault_ZeroAddress();
        (uint256 shares, uint256 elapsed) = _computeManagementFeeShares(
            $.lastFeeHarvestAt,
            $.managementFeeBps,
            totalSupply()
        );
        if (shares == 0) revert FeeManager_NothingToHarvest();
        $.lastFeeHarvestAt = uint48(block.timestamp);
        _mint(to, shares);
        emit ManagementFeeHarvested(to, shares, elapsed);
    }

    /// @inheritdoc IFeeManager
    function harvestPerformanceFee(
        address to
    ) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0)) revert Vault_ZeroAddress();
        FeeManagerStorage storage $ = _getFeeManagerStorage();
        uint256 pps = pricePerShare();
        uint256 hwm = $.highWaterMark;
        if (pps <= hwm) revert FeeManager_PriceAtOrBelowHighWaterMark();
        uint256 shares = _computePerformanceFeeShares(
            pps,
            hwm,
            $.performanceFeeBps,
            totalSupply()
        );
        if (shares == 0) revert FeeManager_NothingToHarvest();
        $.highWaterMark = pps;
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
