// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable, IERC165} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IHandler, GMPUtils} from "../gmp/IHandler.sol";
import {IMailbox} from "../gmp/IMailbox.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Staking} from "./libraries/Staking.sol";

/**
 * @title Router to store xxxLBTC Staking paths and token's name.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract StakingRouter is
    IStakingRouter,
    IHandler,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable
{
    using EnumerableMap for EnumerableMap.Bytes32ToBytes32Map;

    /// @custom:storage-location erc7201:lombardfinance.storage.StakingRouter
    struct StakingRouterStorage {
        mapping(bytes32 => Route) routes;
        EnumerableMap.Bytes32ToBytes32Map namedTokens;
        uint256 StakingNonce;
        IMailbox mailbox;
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
    }

    struct Route {
        mapping(bytes32 => bool) toTokens;
        bytes32 toChainId;
    }

    /// TODO: calcualte
    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakingRouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant Staking_ROUTER_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        IMailbox mailbox_
    ) external initializer {
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __StakingRouter_init(mailbox_);
    }

    function __StakingRouter_init(IMailbox mailbox_) internal onlyInitializing {
        if (address(mailbox_) == address(0)) {
            revert StakingRouter_ZeroMailbox();
        }
        _getStakingRouterStorage().mailbox = mailbox_;
    }

    function reinitialize() external reinitializer(3) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        // start count nonces from 1
        $.StakingNonce = 1;
    }

    function setRoute(
        bytes32 fromToken,
        bytes32 fromChainId,
        bytes32 toToken,
        bytes32 toChainId
    ) external onlyOwner {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        r.toTokens[toToken] = true;
        emit RouteSet(fromToken, fromChainId, toToken, toChainId);
    }

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) external view override returns (bool) {
        return _isAllowedRoute(fromToken, toChainId, toToken);
    }

    function _isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken
    ) internal view returns (bool) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        return r.toTokens[toToken] && r.toChainId == toChainId;
    }

    function setNamedToken(bytes32 name, address token) external onlyOwner {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        $.namedTokens.set(name, bytes32(uint256(uint160(token))));
        emit NamedTokenSet(name, token);
    }

    function getNamedToken(
        bytes32 name
    ) external view override returns (address) {
        return _getNamedToken(name);
    }

    function _getNamedToken(bytes32 name) internal view returns (address) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return address(uint160(uint256($.namedTokens.get(name))));
    }

    function containsNamedToken(
        bytes32 name
    ) external view override returns (bool) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return $.namedTokens.contains(name);
    }

    function getNamedTokenKeys()
        external
        view
        override
        returns (bytes32[] memory)
    {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return $.namedTokens.keys();
    }

    function _getStakingRouterStorage()
        private
        pure
        returns (StakingRouterStorage storage $)
    {
        assembly {
            $.slot := Staking_ROUTER_STORAGE_LOCATION
        }
    }

    function startStake(
        bytes32 tolChainId,
        address,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external nonReentrant returns (address nativeToken) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        // if token not found will revert with Enum error
        nativeToken = _getNamedToken(keccak256("NativeLBTC"));
        if (!_isAllowedRoute(
                bytes32(uint256(uint160(nativeToken))),
                tolChainId,
                toToken
            )
        ) {
            revert IStaking.StakingNotAllowed();
        }

        bytes memory rawPayload = Staking.encodeStakeRequest(
            tolChainId,
            toToken,
            recipient,
            amount
        );

        $.mailbox.send(
            Staking.LEDGER_LCHAIN_ID,
            Staking.LEDGER_RECIPIENT,
            Staking.LEDGER_CALLER,
            rawPayload
        );

        return nativeToken;
    }

    function startUnstake(
        bytes32 tolChainId,
        address fromToken,
        bytes calldata recipient,
        uint256 amount
    ) external nonReentrant {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        bytes32 fromTokenBytes = bytes32(uint256(uint160(fromToken)));
        if (!_isAllowedRoute(
                fromTokenBytes,
                tolChainId,
                bytes32(0)
            )
        ) {
            revert IStaking.StakingNotAllowed();
        }

        bytes memory rawPayload = Staking.encodeUnstakeRequest(
            tolChainId,
            fromTokenBytes,
            recipient,
            amount
        );

        $.mailbox.send(
            Staking.LEDGER_LCHAIN_ID,
            Staking.LEDGER_RECIPIENT,
            Staking.LEDGER_CALLER,
            rawPayload
        );
    }

    function finalizeStakingOperation(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant returns (bool) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        (, bool success) = $.mailbox.deliverAndHandle(rawPayload, proof);
        return success;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165Upgradeable, IERC165) returns (bool) {
        return
            type(IHandler).interfaceId == interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function handlePayload(
        GMPUtils.Payload memory payload
    ) external override returns (bytes memory) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        if (_msgSender() != address($.mailbox)) {
            revert StakingRouter_MailboxExpected();
        }
        // spend payload
        if ($.usedPayloads[payload.id]) {
            revert StakingRouter_PayloadAlreadyUsed();
        }
        $.usedPayloads[payload.id] = true;
        (Staking.Release memory receipt, ) = Staking.decodeRelease(
            payload.msgBody
        );

        IBaseLBTC(receipt.toToken).mint(receipt.recipient, receipt.amount);
        // emit StakingOperationCompleted(receipt.recipient, toToken, receipt.amount);
        return new bytes(0);
    }
}
