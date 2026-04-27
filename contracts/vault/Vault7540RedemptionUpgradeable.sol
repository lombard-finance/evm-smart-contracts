// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IRedemptionSettlementPolicy, RedemptionSettlementSlice} from "../interfaces/vault/IRedemptionSettlementPolicy.sol";
import {IERC7540AsyncRedeem} from "../interfaces/vault/IERC7540AsyncRedeem.sol";
import {IVaultRedemptionPlanSource} from "../interfaces/vault/IVaultRedemptionPlanSource.sol";

import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title Vault7540RedemptionUpgradeable
/// @notice ERC-7540 asynchronous **redemption** leg: `requestRedeem` burns shares into pending state; **permissionless**
///         {fulfillRedemptions} applies `IRedemptionSettlementPolicy`; claim via ERC-4626 `withdraw` / `redeem` (no second burn).
/// @dev `requestId` support: only `requestId == 0` (controller-aggregated) is implemented. `previewRedeem` / `previewWithdraw` revert.
contract Vault7540RedemptionUpgradeable is VaultBaseUpgradeable, IERC7540AsyncRedeem, IVaultRedemptionPlanSource {
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @notice Marks an account that may be used as ERC-7540 `controller` on `requestRedeem` (grant via {grantRole}, revoke via {revokeRole}).
    bytes32 public constant REDEEM_CONTROLLER_ROLE = keccak256("REDEEM_CONTROLLER_ROLE");

    /// @notice Role admin for {REDEEM_CONTROLLER_ROLE}; may grant/revoke redeem-controller membership.
    bytes32 public constant CONTROLLER_WHITELIST_ADMIN_ROLE = keccak256("CONTROLLER_WHITELIST_ADMIN_ROLE");

    /// @dev ERC-7540: asynchronous redemption Vault (EIP-7540 ERC-165).
    bytes4 private constant _ERC7540_ASYNC_REDEEM_INTERFACE_ID = 0x620ee8e4;

    /// @dev ERC-7540: operator methods (`setOperator` / `isOperator`) for implementations without ERC-7575.
    bytes4 private constant _ERC7540_OPERATORS_INTERFACE_ID = 0xe3bc4e65;

    error ERC7540PreviewDisabled();

    error ERC7540UnauthorizedClaimCaller(address caller, address controller);

    error ControllerNotWhitelisted(address controller);

    error ERC7540UnsupportedRequestId(uint256 requestId);

    error ERC7540FulfillmentInvariant();

    error ERC7540ZeroSettlementPolicy();

    error ERC7540ZeroRedeemRequestShares();

    /// @custom:storage-location erc7201:lombardfinance.storage.Vault7540AsyncRedemption
    struct Vault7540AsyncRedemptionStorage {
        mapping(address controller => mapping(address operator => bool)) operator_;
        address settlementPolicy;
        mapping(address controller => uint256) pendingShares;
        mapping(address controller => uint256) pendingAssets;
        mapping(address controller => uint256) claimableShares;
        mapping(address controller => uint256) claimableAssets;
        EnumerableSet.AddressSet pendingControllers;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Vault7540AsyncRedemption")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_7540_REDEEM_STORAGE_LOCATION =
        0xe3cc42db32640a10c3298cdc1689e41a093d0aed9a027140ec830cbfd4f45d00;

    function _getVault7540AsyncRedemptionStorage()
        internal
        pure
        returns (Vault7540AsyncRedemptionStorage storage $)
    {
        assembly {
            $.slot := VAULT_7540_REDEEM_STORAGE_LOCATION
        }
    }

    /// @notice Pluggable view-only settlement policy used by {fulfillRedemptions}.
    function settlementPolicy() external view returns (address) {
        return _getVault7540AsyncRedemptionStorage().settlementPolicy;
    }

    /// @notice Binds RBAC and settlement policy. `settlementPolicy_` MUST be non-zero.
    /// @dev Call from concrete `initialize` after `__VaultBase_init`. Use {grantRole}/{revokeRole} with {REDEEM_CONTROLLER_ROLE} on `controller` accounts.
    function __Vault7540Redemption_init(
        address controllerWhitelistAdmin_,
        address settlementPolicy_
    ) internal onlyInitializing {
        _setRoleAdmin(REDEEM_CONTROLLER_ROLE, CONTROLLER_WHITELIST_ADMIN_ROLE);
        if (controllerWhitelistAdmin_ != address(0)) {
            _grantRole(CONTROLLER_WHITELIST_ADMIN_ROLE, controllerWhitelistAdmin_);
        }
        if (settlementPolicy_ == address(0)) revert ERC7540ZeroSettlementPolicy();
        _getVault7540AsyncRedemptionStorage().settlementPolicy = settlementPolicy_;
    }

    /// @notice Replace the settlement policy (`DEFAULT_ADMIN_ROLE`).
    function setSettlementPolicy(address settlementPolicy_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (settlementPolicy_ == address(0)) revert ERC7540ZeroSettlementPolicy();
        _getVault7540AsyncRedemptionStorage().settlementPolicy = settlementPolicy_;
    }

    /// @inheritdoc IERC7540AsyncRedeem
    function setOperator(address operator, bool approved) external returns (bool) {
        _getVault7540AsyncRedemptionStorage().operator_[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    /// @inheritdoc IERC7540AsyncRedeem
    function isOperator(address controller, address operator) external view returns (bool) {
        return _getVault7540AsyncRedemptionStorage().operator_[controller][operator];
    }

    /// @notice Whether `spender` is `owner` or an ERC-7540 operator for `owner` (for `requestRedeem` authorization).
    function _isRedeemRequestOperator(address owner, address spender) internal view returns (bool) {
        return owner == spender || _getVault7540AsyncRedemptionStorage().operator_[owner][spender];
    }

    /// @notice Reverts unless `msg.sender` is `controller` or an operator approved by `controller` (claim path).
    function _requireControllerOrOperator(address controller) internal view {
        if (msg.sender != controller && !_getVault7540AsyncRedemptionStorage().operator_[controller][msg.sender]) {
            revert ERC7540UnauthorizedClaimCaller(msg.sender, controller);
        }
    }

    /// @inheritdoc VaultBaseUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(VaultBaseUpgradeable) returns (bool) {
        if (interfaceId == _ERC7540_ASYNC_REDEEM_INTERFACE_ID || interfaceId == _ERC7540_OPERATORS_INTERFACE_ID) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev EIP-7540: `previewRedeem` MUST revert for asynchronous redemption vaults.
    function previewRedeem(uint256 shares) public view virtual override(ERC4626Upgradeable) returns (uint256) {
        shares;
        revert ERC7540PreviewDisabled();
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev EIP-7540: `previewWithdraw` MUST revert for asynchronous redemption vaults.
    function previewWithdraw(uint256 assets) public view virtual override(ERC4626Upgradeable) returns (uint256) {
        assets;
        revert ERC7540PreviewDisabled();
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev Third argument is the ERC-7540 `controller`; claimable balance is keyed by `controller`, not live `balanceOf`.
    function maxWithdraw(address controller) public view virtual override returns (uint256) {
        return _getVault7540AsyncRedemptionStorage().claimableAssets[controller];
    }

    /// @inheritdoc ERC4626Upgradeable
    function maxRedeem(address controller) public view virtual override returns (uint256) {
        return _getVault7540AsyncRedemptionStorage().claimableShares[controller];
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev ERC-7540: `owner` is the `controller`; does not burn vault shares; transfers `asset` from claimable pool only.
    function withdraw(
        uint256 assets,
        address receiver,
        address controller
    ) public virtual override nonReentrant returns (uint256) {
        Vault7540AsyncRedemptionStorage storage $ = _getVault7540AsyncRedemptionStorage();
        _requireControllerOrOperator(controller);

        uint256 maxAssets = $.claimableAssets[controller];
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxWithdraw(controller, assets, maxAssets);
        }

        uint256 cShares = $.claimableShares[controller];
        uint256 cAssets = maxAssets;
        uint256 sharesPortion = assets == cAssets ? cShares : assets.mulDiv(cShares, cAssets, Math.Rounding.Floor);

        $.claimableAssets[controller] = maxAssets - assets;
        $.claimableShares[controller] = cShares - sharesPortion;

        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);
        emit Withdraw(_msgSender(), receiver, controller, assets, 0);
        return 0;
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev ERC-7540: `owner` is the `controller`; `shares` refers to claimable redeem-request shares, not ERC-20 balance.
    function redeem(
        uint256 shares,
        address receiver,
        address controller
    ) public virtual override nonReentrant returns (uint256 assets) {
        Vault7540AsyncRedemptionStorage storage $ = _getVault7540AsyncRedemptionStorage();
        _requireControllerOrOperator(controller);

        uint256 maxShares = $.claimableShares[controller];
        if (shares > maxShares) {
            revert ERC4626ExceededMaxRedeem(controller, shares, maxShares);
        }

        uint256 cAssets = $.claimableAssets[controller];
        uint256 cShareBal = maxShares;
        assets = shares == cShareBal ? cAssets : shares.mulDiv(cAssets, cShareBal, Math.Rounding.Floor);

        $.claimableShares[controller] = maxShares - shares;
        $.claimableAssets[controller] = cAssets - assets;

        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);
        emit Withdraw(_msgSender(), receiver, controller, assets, 0);
        return assets;
    }

    function _requireRequestIdZero(uint256 requestId) internal pure {
        if (requestId != 0) revert ERC7540UnsupportedRequestId(requestId);
    }

    /// @inheritdoc IERC7540AsyncRedeem
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external override nonReentrant returns (uint256 requestId) {
        if (!hasRole(REDEEM_CONTROLLER_ROLE, controller)) revert ControllerNotWhitelisted(controller);
        if (shares == 0) revert ERC7540ZeroRedeemRequestShares();

        if (msg.sender != owner && !_isRedeemRequestOperator(owner, msg.sender)) {
            _spendAllowance(owner, msg.sender, shares);
        }

        uint256 assetsAtRequest = _convertToAssets(shares, Math.Rounding.Floor);

        Vault7540AsyncRedemptionStorage storage $ = _getVault7540AsyncRedemptionStorage();
        bool wasPending = $.pendingAssets[controller] != 0;
        $.pendingShares[controller] += shares;
        $.pendingAssets[controller] += assetsAtRequest;
        if (!wasPending) {
            $.pendingControllers.add(controller);
        }

        _burn(owner, shares);
        emit RedeemRequest(controller, owner, 0, msg.sender, shares);
        return 0;
    }

    /// @inheritdoc IERC7540AsyncRedeem
    function claimableRedeemRequest(
        uint256 requestId_,
        address controller
    ) external view override returns (uint256 shares) {
        _requireRequestIdZero(requestId_);
        return _getVault7540AsyncRedemptionStorage().claimableShares[controller];
    }

    /// @inheritdoc IVaultRedemptionPlanSource
    function pendingRedeemControllerCount() external view override returns (uint256) {
        return _getVault7540AsyncRedemptionStorage().pendingControllers.length();
    }

    /// @inheritdoc IVaultRedemptionPlanSource
    function pendingRedeemControllerAt(uint256 index) external view override returns (address) {
        return _getVault7540AsyncRedemptionStorage().pendingControllers.at(index);
    }

    /// @inheritdoc IERC7540AsyncRedeem
    /// @dev Same as {IVaultRedemptionPlanSource-pendingRedeemRequest} (`requestId == 0` only).
    function pendingRedeemRequest(
        uint256 requestId_,
        address controller
    ) external view override(IERC7540AsyncRedeem, IVaultRedemptionPlanSource) returns (uint256 shares) {
        _requireRequestIdZero(requestId_);
        return _getVault7540AsyncRedemptionStorage().pendingShares[controller];
    }

    /// @inheritdoc IVaultRedemptionPlanSource
    function pendingRedeemAssetBudget(address controller) external view override returns (uint256 assets) {
        return _getVault7540AsyncRedemptionStorage().pendingAssets[controller];
    }

    /// @notice Move pending redemption to claimable using the configured `IRedemptionSettlementPolicy.settlementPlan`.
    /// @dev Permissionless (no fulfiller role). Budget is this contract’s `asset` balance at call time.
    function fulfillRedemptions() external nonReentrant {
        Vault7540AsyncRedemptionStorage storage $ = _getVault7540AsyncRedemptionStorage();
        address policyAddr = $.settlementPolicy;
        if (policyAddr == address(0)) revert ERC7540ZeroSettlementPolicy();

        uint256 maxAssets = IERC20(asset()).balanceOf(address(this));
        if (maxAssets == 0) {
            return;
        }

        RedemptionSettlementSlice[] memory slices = IRedemptionSettlementPolicy(policyAddr).settlementPlan(
            address(this),
            maxAssets
        );

        uint256 sum;
        uint256 n = slices.length;
        for (uint256 i; i < n; ++i) {
            sum += slices[i].assets;
        }
        if (sum > maxAssets) {
            revert ERC7540FulfillmentInvariant();
        }

        for (uint256 j; j < n; ++j) {
            RedemptionSettlementSlice memory s = slices[j];
            if (s.requestId != 0) revert ERC7540UnsupportedRequestId(s.requestId);
            if (s.controller == address(0)) revert ZeroAddress();
            uint256 give = s.assets;
            if (give == 0) continue;

            uint256 pA = $.pendingAssets[s.controller];
            uint256 pS = $.pendingShares[s.controller];
            if (give > pA) revert ERC7540FulfillmentInvariant();

            uint256 moveShares = give == pA ? pS : give.mulDiv(pS, pA, Math.Rounding.Floor);

            $.pendingAssets[s.controller] = pA - give;
            $.pendingShares[s.controller] = pS - moveShares;
            $.claimableAssets[s.controller] += give;
            $.claimableShares[s.controller] += moveShares;

            if ($.pendingAssets[s.controller] == 0) {
                if ($.pendingShares[s.controller] != 0) {
                    $.claimableShares[s.controller] += $.pendingShares[s.controller];
                    $.pendingShares[s.controller] = 0;
                }
                $.pendingControllers.remove(s.controller);
            }
        }
    }
}
