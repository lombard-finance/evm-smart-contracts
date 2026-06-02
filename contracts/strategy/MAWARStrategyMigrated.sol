// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {PriceRateLimiter} from "./libraries/PriceRateLimiter.sol";
import {MultiAssetWithAsyncRedemptionStrategy} from "./MultiAssetWithAsyncRedemptionStrategy.sol";

/// @custom:security-contact legal@lombard.finance
contract MAWARStrategyMigrated is MultiAssetWithAsyncRedemptionStrategy {
    uint256 private constant NOT_ENTERED = 1;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE_LOCATION =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    function _getReentrancyGuardInheritedStorage()
        private
        pure
        returns (ReentrancyGuardStorage storage $)
    {
        assembly {
            $.slot := REENTRANCY_GUARD_STORAGE_LOCATION
        }
    }

    /// @notice Migrate from ERC4626VaultWrapper to MAWARStrategyMigrated.
    /// @dev This migration function is intended to be called only once, immediately after upgrade,
    /// to initialize storage and migrate from the legacy ERC4626VaultWrapper to MultiAssetWithAsyncRedemptionStrategy.
    /// Once executed and state verified, recommend upgrading to the standard MultiAssetWithAsyncRedemptionStrategy
    /// implementation with this function removed for cleanliness and to disable any possibility of re-entry.
    /// @param blocklistOracle_ Blocklist oracle address.
    /// @param asset_ Underlying asset address.
    /// @param decimals_ Underlying asset decimals.
    /// @param managementFeeTreasury_ Management fee treasury address.
    /// @param initialPPS_ Initial price per share.
    function migrate(
        address blocklistOracle_,
        IERC20 asset_,
        uint8 decimals_,
        address managementFeeTreasury_,
        uint256 initialPPS_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (blocklistOracle_ == address(0)) revert Strategy_ZeroAddress();
        if (address(asset_) == address(0)) revert Strategy_ZeroAddress();
        if (decimals_ == 0) revert Strategy_ZeroDecimals();
        if (managementFeeTreasury_ == address(0)) revert Strategy_ZeroAddress();

        // initialize ReentrancyGuard storage
        ReentrancyGuardStorage
            storage $ = _getReentrancyGuardInheritedStorage();
        $._status = NOT_ENTERED;

        // initialize StrategyBase storage
        StrategyBaseUpgradeableStorage
            storage baseStorage = _getStrategyBaseUpgradeableStorage();

        // override underlying asset
        baseStorage.underlyingDecimals = decimals_;
        baseStorage.asset = asset_;

        _setBlocklistOracle(baseStorage, blocklistOracle_);
        _setPricePerShare(baseStorage, initialPPS_);
        baseStorage.ppsRateLimiter = PriceRateLimiter.Bucket({
            lastRefill: uint48(block.timestamp),
            capacityBps: 0,
            maxBps: 0,
            refillRate: 0
        });

        // initialize FeeManager storage
        FeeManagerStorage storage feeManagerStorage = _getFeeManagerStorage();
        feeManagerStorage.highWaterMark = pricePerShare();
        feeManagerStorage.lastFeeHarvestAt = uint48(block.timestamp);
        feeManagerStorage.managementFeeTreasury = managementFeeTreasury_;
    }
}
