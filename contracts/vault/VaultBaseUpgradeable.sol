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
import {IVault} from "./interfaces/IVault.sol";

/// @title VaultBaseUpgradeable
abstract contract VaultBaseUpgradeable is
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC4626Upgradeable,
    IVault
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant STRATEGY_DEPLOYER_ROLE =
        keccak256("STRATEGY_DEPLOYER_ROLE");

    bytes32 public constant PRICE_PER_SHARE_POSTER_ROLE =
        keccak256("PRICE_PER_SHARE_POSTER_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.VaultBaseUpgradeable
    struct VaultBaseUpgradeableStorage {
        EnumerableSet.AddressSet strategies;
        /// @dev Underlying asset base units per `10 ** decimals()` share units (vault share token decimals).
        uint256 pricePerShare;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.VaultBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_BASE_UPGRADEABLE_STORAGE_LOCATION =
        0xeadb3838d9eaf85055390f4c9c11e3d0e5a14b16d76298126869759876742000;

    function _getVaultBaseUpgradeableStorage()
        internal
        pure
        returns (VaultBaseUpgradeableStorage storage $)
    {
        assembly {
            $.slot := VAULT_BASE_UPGRADEABLE_STORAGE_LOCATION
        }
    }

    /// @notice Posted exchange rate: asset wei per `10 ** decimals()` shares. Used by `_convertToShares` / `_convertToAssets`.
    function pricePerShare() public view returns (uint256) {
        return _getVaultBaseUpgradeableStorage().pricePerShare;
    }

    /// @notice Update `pricePerShare` (`PRICE_PER_SHARE_POSTER_ROLE`). `newPricePerShare` MUST be non-zero.
    function postPricePerShare(
        uint256 newPricePerShare
    ) external onlyRole(PRICE_PER_SHARE_POSTER_ROLE) {
        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        $.pricePerShare = newPricePerShare;
        emit PricePerShareUpdated(
            newPricePerShare,
            totalAssets(),
            uint64(block.timestamp)
        );
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev NAV in asset units: `totalSupply() * pricePerShare / 10**decimals()` (floor), not raw `asset` balance.
    function totalAssets() public view virtual override returns (uint256) {
        return _convertToAssets(totalSupply(), Math.Rounding.Floor);
    }

    /// @inheritdoc ERC4626Upgradeable
    function asset()
        public
        view
        virtual
        override(ERC4626Upgradeable, IVault)
        returns (address)
    {
        return super.asset();
    }

    /// @inheritdoc AccessControlDefaultAdminRulesUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(AccessControlDefaultAdminRulesUpgradeable)
        returns (bool)
    {
        if (interfaceId == type(IERC4626).interfaceId) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }

    /// @notice Register `strategy` for the §B pipe (`docs/spec/002-strategy.md` §B): grants allowance on `asset()`.
    function registerStrategy(
        address strategy
    ) external nonReentrant onlyRole(STRATEGY_DEPLOYER_ROLE) {
        if (strategy == address(0)) revert ZeroAddress();
        _getVaultBaseUpgradeableStorage().strategies.add(strategy);
        SafeERC20.forceApprove(IERC20(asset()), strategy, type(uint256).max);
    }

    /// @notice Whether `strategy` was registered via {registerStrategy}.
    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool) {
        return _getVaultBaseUpgradeableStorage().strategies.contains(strategy);
    }

    /// @dev Roles: `DEFAULT_ADMIN_ROLE` (via rules), `STRATEGY_DEPLOYER_ROLE`, `PRICE_PER_SHARE_POSTER_ROLE`.
    /// @param initialDefaultAdminDelay_ Delay for default-admin transfer / delay changes (OpenZeppelin `AccessControlDefaultAdminRules`).
    function __VaultBase_init(
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_,
        address strategyDeployer_
    ) internal onlyInitializing {
        if (strategyDeployer_ == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        __ReentrancyGuard_init();

        _grantRole(STRATEGY_DEPLOYER_ROLE, strategyDeployer_);


        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        
        // Initial price per share is 1 asset per share.
        $.pricePerShare = 10 ** decimals();
    }

    function __ERC4626Vault_init(
        IERC20 asset_,
        string memory name_,
        string memory symbol_
    ) internal onlyInitializing {
        if (address(asset_) == address(0)) revert ZeroAddress();
        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _convertToShares(
        uint256 assets,
        Math.Rounding rounding
    ) internal view virtual override returns (uint256) {
        return assets.mulDiv(10 ** decimals(), pricePerShare(), rounding);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view virtual override returns (uint256) {
        return shares.mulDiv(pricePerShare(), 10 ** decimals(), rounding);
    }
}
