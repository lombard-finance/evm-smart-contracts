// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

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

    /// @notice May {setWithdrawalFeeBps} and {setWithdrawalTreasury}.
    bytes32 public constant WITHDRAWAL_FEE_MANAGER_ROLE =
        keccak256("WITHDRAWAL_FEE_MANAGER_ROLE");

    uint256 private constant _BPS_DENOMINATOR = 10_000;

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
        /// @dev Registered controllers for tracking and enumeration; {stopRedeemRequests} does not remove entries.
        EnumerableSet.AddressSet controllers;
        mapping(address controller => EnumerableSet.AddressSet) operators;
        /// @dev Last issued request id (ids are `1 .. nextRequestId`).
        uint256 nextRequestId;
        mapping(uint256 requestId => RedeemRequest) redeemRequestById;
        /// @dev Max redeem shares per redeem request for controller
        mapping(address controller => uint256) maxRedeemShares;
        uint16 withdrawalFeeBps;
        address withdrawalTreasury;
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
        address controller,
        uint256 maxRedeemShares
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        if (controller == address(0)) revert ZeroAddress();
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if ($.controllers.contains(controller)) {
            revert ERC7540RedeemControllerAlreadyTracked(controller);
        }
        $.controllers.add(controller);
        $.maxRedeemShares[controller] = maxRedeemShares;
        emit RedeemControllerRegistered(controller);
        emit MaxRedeemSet(controller, maxRedeemShares);
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
        // it's expected that there only few operators for each controller, so we can use a simple loop to remove all operators
        while ($.operators[controller].length() > 0) {
            $.operators[controller].remove($.operators[controller].at(0));
        }
        delete $.maxRedeemShares[controller];
        emit RedeemControllerRemoved(controller);
    }

    /// @dev use to limit max redeem amount and stop new redeem requests
    function setMaxControllerRedeem(
        address ctrl,
        uint256 maxShares
    ) external onlyRole(CONTROLLER_MANAGER_ROLE) {
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (!$.controllers.contains(ctrl)) {
            revert ERC7540RedeemControllerNotTracked(ctrl);
        }
        $.maxRedeemShares[ctrl] = maxShares;
        emit MaxRedeemSet(ctrl, maxShares);
    }

    function maxControllerRedeem(
        address controller
    ) external view returns (uint256) {
        return _getERC7540RedemptionStorage().maxRedeemShares[controller];
    }

    function setWithdrawalFeeBps(
        uint16 bps
    ) external onlyRole(WITHDRAWAL_FEE_MANAGER_ROLE) {
        if (bps >= _BPS_DENOMINATOR) revert WithdrawalFeeBpsTooHigh();
        _getERC7540RedemptionStorage().withdrawalFeeBps = bps;
        emit WithdrawalFeeBpsSet(bps);
    }

    function setWithdrawalTreasury(
        address treasury_
    ) external onlyRole(WITHDRAWAL_FEE_MANAGER_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        _getERC7540RedemptionStorage().withdrawalTreasury = treasury_;
        emit WithdrawalTreasurySet(treasury_);
    }

    function getWithdrawalFeeBps() external view returns (uint16) {
        return _getERC7540RedemptionStorage().withdrawalFeeBps;
    }

    function getWithdrawalTreasury() external view returns (address) {
        return _getERC7540RedemptionStorage().withdrawalTreasury;
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

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        if (
            interfaceId == _ERC7540_ASYNC_REDEEM_INTERFACE_ID ||
            interfaceId == _ERC7540_OPERATORS_INTERFACE_ID
        ) {
            return true;
        }
        return super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IERC7540Redemption
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    )
        external
        override
        nonReentrant
        whenVaultNotPaused
        returns (uint256 requestId)
    {
        ERC7540RedemptionStorage storage $ = _getERC7540RedemptionStorage();
        if (shares == 0) revert ERC7540ZeroRedeemRequestShares();

        if (!$.controllers.contains(controller)) {
            revert ERC7540RedeemControllerNotTracked(controller);
        }

        uint256 maxCtrlShares = $.maxRedeemShares[controller];
        if (shares > maxCtrlShares) {
            revert ERC7540ExceededMaxRedeem(controller, shares, maxCtrlShares);
        }

        address caller = _msgSender();
        // Allow request redeem by allowance
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        uint256 feeShares;
        {
            uint16 feeBps = $.withdrawalFeeBps;
            address treasury_ = $.withdrawalTreasury;
            if (feeBps > 0 && treasury_ != address(0)) {
                feeShares = shares.mulDiv(feeBps, _BPS_DENOMINATOR, Math.Rounding.Floor);
            }
        }
        uint256 netShares = shares - feeShares;
        uint256 assets = _convertToAssets(netShares, Math.Rounding.Floor);
        requestId = ++$.nextRequestId;
        RedeemRequest storage rq = $.redeemRequestById[requestId];
        rq.controller = controller;
        rq.pendingShares = netShares;
        rq.pendingAssets = assets;
        rq.owner = owner;

        $.pendingShares[controller] += netShares;
        $.pendingAssets[controller] += assets;

        _burn(owner, netShares);
        if (feeShares > 0) {
            address treasury_ = $.withdrawalTreasury;
            _transfer(owner, treasury_, feeShares);
            emit WithdrawalFeeCharged(treasury_, feeShares);
        }
        emit RedeemRequested(requestId, owner, controller, caller, shares);
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
            uint256 assets = e.pendingAssets;
            uint256 shares = e.pendingShares;
            address owner = e.owner;

            if (assets == 0) {
                revert ERC7540NothingToFulfill(rid);
            }

            // only operator can fulfill redeem requests
            if (!$.operators[ctrl].contains(msgSender)) {
                revert ERC7540UnauthorizedClaimCaller(msgSender, ctrl, rid);
            }

            $.pendingShares[ctrl] -= shares;
            $.pendingAssets[ctrl] -= assets;
            delete $.redeemRequestById[rid];

            asset_.safeTransfer(owner, assets);
            emit Withdraw(msgSender, owner, assets, shares);
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
