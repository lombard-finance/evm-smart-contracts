// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IERC7540Redemption} from "./interfaces/IERC7540Redemption.sol";
import {VaultBaseUpgradeable} from "./VaultBaseUpgradeable.sol";

/// @title ERC7540RedemptionUpgradeable
abstract contract ERC7540RedemptionUpgradeable is
    VaultBaseUpgradeable,
    IERC7540Redemption
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using Math for uint256;
    using SafeERC20 for IERC20;

    /// @notice May {registerRedeemController}, {allowRedeemRequests}, {stopRedeemRequests}, or {removeRedeemController} for ERC-7540 redeem controllers.
    bytes32 public constant CONTROLLER_MANAGER_ROLE =
        keccak256("CONTROLLER_MANAGER_ROLE");

    /// @dev EIP-7540 ERC-165: asynchronous **redemption** (`requestRedeem`, pending/claimable views). Not the same interface id as operators below.
    bytes4 private constant _ERC7540_ASYNC_REDEEM_INTERFACE_ID = 0x620ee8e4;

    /// @dev EIP-7540 ERC-165: **operator** API (`setOperator` / `isOperator`, `OperatorSet`). Not the same interface id as async redeem above; {supportsInterface} returns true for both when implemented.
    bytes4 private constant _ERC7540_OPERATORS_INTERFACE_ID = 0xe3bc4e65;

    /// @dev Per {requestRedeem} ticket; aggregates below remain the sum over open requests per controller.
    struct RedeemRequest {
        address controller;
        uint256 pendingShares;
        uint256 pendingAssets;
        address owner;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.ERC7540RedemptionUpgradeable
    struct ERC7540RedemptionStorage {
        mapping(address controller => uint256) pendingShares;
        mapping(address controller => uint256) pendingAssets;
        /// @dev When true, `controller` may receive new `requestRedeem` calls.
        mapping(address controller => bool) acceptsRedeemRequests;
        /// @dev Registered controllers for tracking and enumeration; {stopRedeemRequests} does not remove entries.
        EnumerableSet.AddressSet controllers;
        mapping(address controller => EnumerableSet.AddressSet) operators;
        /// @dev Last issued request id (ids are `1 .. nextRequestId`).
        uint256 nextRequestId;
        mapping(uint256 requestId => RedeemRequest) redeemRequestById;
        /// @dev ERC-4626 `maxRedeem(controller)`; set via {setMaxRedeem}.
        mapping(address controller => uint256) maxRedeemShares;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.ERC7540RedemptionUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC7540_REDEMPTION_STORAGE_LOCATION =
        0x9c01f18dddaaab15c233548caccdb2a9c5954fe8f0428b2811e9454281bbc200;

    function _getERC7540RedemptionStorage()
        internal
        pure
        returns (ERC7540RedemptionStorage storage $)
    {
        assembly {
            $.slot := ERC7540_REDEMPTION_STORAGE_LOCATION
        }
    }

    function __ERC7540Redemption_init(
        address controllerManager_
    ) internal onlyInitializing {
        if (controllerManager_ == address(0)) revert ZeroAddress();
        _grantRole(CONTROLLER_MANAGER_ROLE, controllerManager_);
    }

    function registerRedeemController(
        address controller
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        if (controller == address(0)) revert ZeroAddress();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if ($.controllers.contains(controller)) {
            revert ERC7540RedeemControllerAlreadyTracked(controller);
        }
        $.controllers.add(controller);
        emit RedeemControllerRegistered(controller);
    }

    function allowRedeemRequests(
        address controller
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        if (controller == address(0)) revert ZeroAddress();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(controller)) {
            revert ERC7540RedeemControllerNotTracked(controller);
        }
        if ($.acceptsRedeemRequests[controller]) {
            revert ERC7540RedeemRequestsAlreadyAllowed(controller);
        }
        $.acceptsRedeemRequests[controller] = true;
        emit RedeemRequestsAllowed(controller);
    }

    function stopRedeemRequests(
        address controller
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        if (controller == address(0)) revert ZeroAddress();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(controller)) {
            revert ERC7540RedeemControllerNotTracked(controller);
        }
        if (!$.acceptsRedeemRequests[controller]) {
            revert ERC7540RedeemRequestsAlreadyStopped(controller);
        }
        $.acceptsRedeemRequests[controller] = false;
        emit RedeemRequestsStopped(controller);
    }

    function removeRedeemController(
        address controller
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        if (controller == address(0)) revert ZeroAddress();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(controller)) {
            revert ERC7540RemoveControllerNotTracked(controller);
        }
        if (
            $.pendingAssets[controller] != 0 || $.pendingShares[controller] != 0
        ) {
            revert ERC7540RemoveControllerHasPending(controller);
        }
        $.controllers.remove(controller);
        delete $.acceptsRedeemRequests[controller];
        delete $.operators[controller];
        delete $.maxRedeemShares[controller];
        emit RedeemControllerRemoved(controller);
    }

    /// @inheritdoc IERC7540Redemption
    function acceptsRedeemRequests(
        address controller
    ) external view returns (bool) {
        return _getERC7540RedemptionStorage().acceptsRedeemRequests[controller];
    }

    /// @inheritdoc IERC7540Redemption
    /// @dev {_msgSender} MUST be a registered redeem controller ({registerRedeemController}).
    function setOperator(
        address operator,
        bool approved
    ) external returns (bool) {
        if (operator == address(0)) revert ZeroAddress();

        address controllerCaller = _msgSender();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(controllerCaller)) {
            revert ERC7540RedeemControllerNotTracked(controllerCaller);
        }
        if (approved) {
            $.operators[controllerCaller].add(operator);
        } else {
            $.operators[controllerCaller].remove(operator);
        }
        emit OperatorSet(controllerCaller, operator, approved);
        return true;
    }

    /// @inheritdoc IERC7540Redemption
    function isOperator(
        address controller,
        address operator
    ) external view returns (bool) {
        return
            _getERC7540RedemptionStorage().operators[controller].contains(
                operator
            );
    }

    /// @inheritdoc VaultBaseUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(VaultBaseUpgradeable) returns (bool) {
        if (
            interfaceId == _ERC7540_ASYNC_REDEEM_INTERFACE_ID ||
            interfaceId == _ERC7540_OPERATORS_INTERFACE_ID
        ) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev EIP-7540: `previewRedeem` MUST revert for asynchronous redemption vaults.
    function previewRedeem(
        uint256 shares
    ) public view virtual override(ERC4626Upgradeable) returns (uint256) {
        shares;
        revert ERC7540PreviewDisabled();
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev EIP-7540: `previewWithdraw` MUST revert for asynchronous redemption vaults.
    function previewWithdraw(
        uint256 assets
    ) public view virtual override(ERC4626Upgradeable) returns (uint256) {
        assets;
        revert ERC7540PreviewDisabled();
    }

    function maxWithdraw(
        address
    ) public view virtual override returns (uint256) {
        revert ERC7540ERC4626ClaimDisabled();
    }

    function maxRedeem(
        address controller
    ) public view virtual override returns (uint256) {
        return _getERC7540RedemptionStorage().maxRedeemShares[controller];
    }

    function setMaxRedeem(uint256 maxShares) external {
        address controller = _msgSender();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(controller)) {
            revert ERC7540RedeemControllerNotTracked(controller);
        }
        $.maxRedeemShares[controller] = maxShares;
        emit MaxRedeemSet(controller, maxShares);
    }

    /// @inheritdoc ERC4626Upgradeable
    function withdraw(
        uint256,
        address,
        address
    ) public virtual override returns (uint256) {
        revert ERC7540ERC4626ClaimDisabled();
    }

    /// @inheritdoc ERC4626Upgradeable
    function redeem(
        uint256,
        address,
        address
    ) public virtual override returns (uint256) {
        revert ERC7540ERC4626ClaimDisabled();
    }

    /// @inheritdoc IERC7540Redemption
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external override nonReentrant returns (uint256 requestId) {
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.acceptsRedeemRequests[controller])
            revert RedeemRequestsNotAccepted(controller);
        if (shares == 0) revert ERC7540ZeroRedeemRequestShares();

        uint256 maxShares = $.maxRedeemShares[controller];
        if (shares > maxShares) {
            revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        }

        address sender = _msgSender();
        // Allow request redeeem by allowance
        if (sender != owner) {
            _spendAllowance(owner, sender, shares);
        }

        uint256 assets = _convertToAssets(shares, Math.Rounding.Floor);
        requestId = ++$.nextRequestId;
        RedeemRequest storage rq = $.redeemRequestById[requestId];
        rq.controller = controller;
        rq.pendingShares = shares;
        rq.pendingAssets = assets;
        rq.owner = owner;

        $.pendingShares[controller] += shares;
        $.pendingAssets[controller] += assets;

        _burn(owner, shares);
        emit RedeemRequested(requestId, owner, controller, sender, shares);
    }

    function fulfillRedeemRequests(
        uint256[] calldata requestIds
    ) external nonReentrant {
        address msgSender = _msgSender();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        IERC20 asset_ = IERC20(asset());
        uint256 n = requestIds.length;
        for (uint256 i; i < n; ++i) {
            uint256 rid = requestIds[i];
            RedeemRequest storage e = $.redeemRequestById[rid];
            address ctrl = e.controller;
            uint256 pendingA = e.pendingAssets;

            if (e.pendingAssets == 0) {
                revert ERC7540NothingToFulfill(rid);
            }

            // only operator can fulfill redeem requests
            if (!$.operators[ctrl].contains(msgSender)) {
                revert ERC7540UnauthorizedClaimCaller(msgSender, ctrl);
            }

            $.pendingShares[ctrl] -= e.pendingShares;
            $.pendingAssets[ctrl] -= pendingA;
            delete $.redeemRequestById[rid];

            asset_.safeTransfer(e.owner, pendingA);
            // TODO: maybe emit event for each request
        }

        // TODO: maybe add more summary
        emit RedeemRequestsFulfilled(requestIds);
    }

    /// @inheritdoc IERC7540Redemption
    /// @notice Claimable redeem request is not supported in this implementation
    function claimableRedeemRequest(
        uint256,
        address
    ) external pure override returns (uint256 shares) {
        return 0;
    }

    /// @inheritdoc IERC7540Redemption
    /// @notice Claimer is not required to get redeem request
    function pendingRedeemRequest(
        uint256 requestId_,
        address
    ) external view override returns (uint256 shares) {
        return
            _getERC7540RedemptionStorage()
                .redeemRequestById[requestId_]
                .pendingShares;
    }
}
