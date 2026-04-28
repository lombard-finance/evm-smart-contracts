// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC4626Upgradeable, ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {IVault} from "./interfaces/IVault.sol";

/// @title VaultBaseUpgradeable
abstract contract VaultBaseUpgradeable is
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC4626Upgradeable,
    PausableUpgradeable,
    IVault
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant STRATEGY_DEPLOYER_ROLE =
        keccak256("STRATEGY_DEPLOYER_ROLE");

    bytes32 public constant OPERATOR_ROLE =
        keccak256("OPERATOR_ROLE");

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant PRICE_PER_SHARE_GUARDIAN_ROLE = keccak256("PRICE_PER_SHARE_GUARDIAN_ROLE");

    modifier whenVaultNotPaused() {
        _requireVaultNotPaused();
        _;
    }

    modifier whenVaultPaused() {
        _requireVaultPaused();
        _;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.VaultBaseUpgradeable
    struct VaultBaseUpgradeableStorage {
        EnumerableSet.AddressSet strategies;
        /// @dev Underlying asset base units per `10 ** decimals()` share units (vault share token decimals).
        uint256 pricePerShare;
        /// @dev pause vault ops
        bool vaultPaused;
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

    function postPricePerShare(
        uint256 newPricePerShare
    ) external onlyRole(OPERATOR_ROLE) whenVaultNotPaused {
        // TODO: check threshold
        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        _setPricePerShare($, newPricePerShare);
    }

    function forcePostPricePerShare(uint256 newPricePerShare) external onlyRole(PRICE_PER_SHARE_GUARDIAN_ROLE) {
        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        _setPricePerShare($, newPricePerShare);
        _pauseVault();
    }

    function _setPricePerShare(VaultBaseUpgradeableStorage storage $, uint256 newPricePerShare) internal {
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

    function pauseVaultOperations() external onlyRole(PAUSER_ROLE) {
        _getVaultBaseUpgradeableStorage().vaultPaused = true;
    }

    function unpauseVaultOperations() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getVaultBaseUpgradeableStorage().vaultPaused = false;
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

    function vaultOperationsPaused() public view virtual returns (bool) {
        return _getVaultBaseUpgradeableStorage().vaultPaused;
    }

    function _requireVaultNotPaused() internal view virtual {
        if (vaultOperationsPaused()) {
            revert EnforcedVaultOperationsPause();
        }
    }

    function _requireVaultPaused() internal view virtual {
        if (!vaultOperationsPaused()) {
            revert ExpectedVaultOperationsPause();
        }
    }

    function _pauseVault() internal virtual whenVaultNotPaused {
        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        $.vaultPaused = true;
        emit VaultOperationsPaused(_msgSender());
    }

    function _unpauseVault() internal virtual whenVaultPaused {
        VaultBaseUpgradeableStorage storage $ = _getVaultBaseUpgradeableStorage();
        $.vaultPaused = false;
        emit VaultOperationsUnpaused(_msgSender());
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override whenNotPaused {
        super._update(from, to, value);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override whenVaultNotPaused {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override whenVaultNotPaused {
        super._withdraw(caller, receiver, owner, assets, shares);
    }

}
