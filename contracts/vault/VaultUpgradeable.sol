// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title VaultUpgradeable
/// @notice Concrete ERC-4626 vault core (`VaultBaseUpgradeable`) for `BeaconProxy` + `UpgradeableBeacon`.
/// @dev Deploy implementation, point beacon at it, deploy proxies with `abi.encodeCall(this.initialize, (...))`.
contract VaultUpgradeable is VaultBaseUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param asset_ Underlying ERC-20 (`IERC20`).
    /// @param name_ Share token name (`ERC20`).
    /// @param symbol_ Share token symbol (`ERC20`).
    /// @param initialDefaultAdminDelay_ OpenZeppelin default-admin delay (`AccessControlDefaultAdminRules`).
    /// @param defaultAdmin_ Receives `DEFAULT_ADMIN_ROLE`.
    /// @param strategyDeployer_ Receives `STRATEGY_DEPLOYER_ROLE`.
    /// @param pricePerSharePoster_ Receives `PRICE_PER_SHARE_POSTER_ROLE`.
    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        address strategyDeployer_,
        address pricePerSharePoster_
    ) external initializer {
        __ERC4626Vault_init(asset_, name_, symbol_);
        __VaultBase_init(
            initialDefaultAdminDelay_,
            defaultAdmin_,
            strategyDeployer_,
            pricePerSharePoster_
        );
    }
}
