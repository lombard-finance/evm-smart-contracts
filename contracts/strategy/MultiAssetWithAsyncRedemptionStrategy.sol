// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AsyncRedemptionUpgradeable} from "./AsyncRedemptionUpgradeable.sol";
import {MultiAssetDepositUpgradeable} from "./MultiAssetDepositUpgradeable.sol";

/// @title MultiAssetWithAsyncRedemptionStrategy
/// @notice Concrete strategy combining multi-asset deposits (`MultiAssetDepositUpgradeable`), fee module, and async redemption (`AsyncRedemptionUpgradeable`).
/// @dev Linearization: `AsyncRedemptionUpgradeable` is listed last so diamond-like overrides resolve predictably; parent initializers run via `__StrategyBase_init` + module inits in C3 order.
contract MultiAssetWithAsyncRedemptionStrategy is
    MultiAssetDepositUpgradeable,
    AsyncRedemptionUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Full initializer for ERC-20 metadata, strategy base, fees, deposits, and async redemption operator.
    /// @param name_ ERC-20 name for strategy shares.
    /// @param symbol_ ERC-20 symbol for strategy shares.
    /// @param asset_ Underlying asset (`asset()`).
    /// @param defaultAdmin_ Default admin for access control.
    /// @param initialDefaultAdminDelay_ Admin delay for default admin rules.
    function initialize(
        string memory name_,
        string memory symbol_,
        IERC20 asset_,
        address defaultAdmin_,
        uint48 initialDefaultAdminDelay_
    ) external initializer {
        __StrategyBase_init(
            name_,
            symbol_,
            initialDefaultAdminDelay_,
            defaultAdmin_,
            asset_
        );
        __FeeManager_init();
        __MultiAssetDeposit_init();
        __AsyncRedemption_init();
    }

    /// @notice Human-readable build label for off-chain integrations.
    function version() external pure override returns (string memory) {
        return "MultiAssetWithAsyncRedemptionStrategy-0.0.1";
    }

    /// @inheritdoc AccessControlDefaultAdminRulesUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(AccessControlDefaultAdminRulesUpgradeable, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @dev Resolves `StrategyBaseUpgradeable._afterShardDeregistered` for the diamond base layout.
    function _afterShardDeregistered(
        address shard
    )
        internal
        override(MultiAssetDepositUpgradeable, AsyncRedemptionUpgradeable)
    {
        MultiAssetDepositUpgradeable._afterShardDeregistered(shard);
    }
}
