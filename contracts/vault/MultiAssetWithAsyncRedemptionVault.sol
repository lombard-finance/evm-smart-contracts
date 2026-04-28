// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IVault} from "./interfaces/IVault.sol";
import {ERC7540RedemptionUpgradeable} from "./ERC7540RedemptionUpgradeable.sol";
import {MultiAssetDepositUpgradeable} from "./MultiAssetDepositUpgradeable.sol";

contract MultiAssetWithAsyncRedemptionVault is MultiAssetDepositUpgradeable, ERC7540RedemptionUpgradeable {

    constructor() {
        _disableInitializers();
    }
    
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
        __VaultBase_init(initialDefaultAdminDelay_, defaultAdmin_, strategyDeployer_, asset_);
        __MultiAssetDeposit_init();
        __ERC7540Redemption_init(controllerManager_);
    }

    function version() external pure override returns (string memory) {
        return "MultiAssetWithAsyncRedemptionVault-0.0.1";
    }

    /// @inheritdoc ERC7540RedemptionUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(
        AccessControlDefaultAdminRulesUpgradeable,
        ERC7540RedemptionUpgradeable,
        IERC165
    ) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
