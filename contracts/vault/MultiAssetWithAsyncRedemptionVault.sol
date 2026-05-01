// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC7540RedemptionUpgradeable} from "./ERC7540RedemptionUpgradeable.sol";
import {MultiAssetDepositUpgradeable} from "./MultiAssetDepositUpgradeable.sol";

/// @title MultiAssetWithAsyncRedemptionVault
/// @notice Concrete vault combining multi-asset deposits (`MultiAssetDepositUpgradeable`), fee module, and EIP-7540 async redemption (`ERC7540RedemptionUpgradeable`).
/// @dev Linearization: `ERC7540RedemptionUpgradeable` is listed last so diamond-like overrides resolve predictably; initialise parents in `initialize` as written.
contract MultiAssetWithAsyncRedemptionVault is
    MultiAssetDepositUpgradeable,
    ERC7540RedemptionUpgradeable
{
    constructor() {
        _disableInitializers();
    }

    /// @notice Full initializer for ERC-20 metadata, vault base, fees, deposits, and redemption controller admin.
    /// @param name_ ERC-20 name for vault shares.
    /// @param symbol_ ERC-20 symbol for vault shares.
    /// @param asset_ Underlying asset (`asset()`).
    /// @param defaultAdmin_ Default admin for access control.
    /// @param initialDefaultAdminDelay_ Admin delay for default admin rules.
    /// @param controllerManager_ Receives `CONTROLLER_MANAGER_ROLE` for redeem controllers.
    /// @param strategyDeployer_ Receives `STRATEGY_DEPLOYER_ROLE`.
    function initialize(
        string memory name_,
        string memory symbol_,
        IERC20 asset_,
        address defaultAdmin_,
        uint48 initialDefaultAdminDelay_,
        address controllerManager_,
        address strategyDeployer_
    ) external initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();
        __VaultBase_init(
            initialDefaultAdminDelay_,
            defaultAdmin_,
            strategyDeployer_,
            asset_
        );
        __FeeManager_init();
        __MultiAssetDeposit_init();
        __ERC7540Redemption_init(controllerManager_);
    }

    /// @notice Human-readable build label for off-chain integrations.
    function version() external pure override returns (string memory) {
        return "MultiAssetWithAsyncRedemptionVault-0.0.1";
    }

    /// @inheritdoc ERC7540RedemptionUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(
            AccessControlDefaultAdminRulesUpgradeable,
            ERC7540RedemptionUpgradeable,
            IERC165
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
