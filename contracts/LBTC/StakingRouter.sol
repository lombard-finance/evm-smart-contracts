// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable, IERC165} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IHandler, GMPUtils} from "../gmp/IHandler.sol";
import {IMailbox} from "../gmp/IMailbox.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {LChainId} from "../libs/LChainId.sol";
import {Staking} from "./libraries/Staking.sol";

/**
 * @title Router to store xxxLBTC Staking paths and token's name.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract StakingRouter is
    IStakingRouter,
    IHandler,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable
{
    using EnumerableMap for EnumerableMap.Bytes32ToBytes32Map;

    /// @custom:storage-location erc7201:lombardfinance.storage.StakingRouter
    struct StakingRouterStorage {
        mapping(bytes32 => Route) routes;
        EnumerableMap.Bytes32ToBytes32Map namedTokens;
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
        uint256 StakingNonce;
        IMailbox mailbox;
        mapping(address => bool) allowedCallers; // tokenAddress => is allowed to use router
        IBascule bascule;
        uint256 maximumFee;
        IOracle oracle;
    }

    struct Route {
        mapping(bytes32 => bool) toTokens;
        bytes32 toChainId;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakingRouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant Staking_ROUTER_STORAGE_LOCATION =
        0x657e838a5e5e7bc2c6ca514c2bec49dc0f583b9ed809ee15916b1bcccebe3d00;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint48 initialOwnerDelay_,
        IMailbox mailbox_,
        IOracle oracle_
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay_, owner_);
        __ReentrancyGuard_init();
        __StakingRouter_init(mailbox_, oracle_);
    }

    function __StakingRouter_init(
        IMailbox mailbox_,
        IOracle oracle_
    ) internal onlyInitializing {
        if (address(mailbox_) == address(0)) {
            revert StakingRouter_ZeroMailbox();
        }
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        $.mailbox = mailbox_;
        $.oracle = oracle_;
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
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        r.toTokens[toToken] = true;
        r.toChainId = toChainId;
        if (fromChainId == LChainId.get()) {
            $.allowedCallers[GMPUtils.bytes32ToAddress(fromToken)] = true;
        }
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

    function _isAllowedCaller(
        StakingRouterStorage storage $,
        address caller
    ) internal view returns (bool) {
        return $.allowedCallers[caller];
    }

    function setNamedToken(
        bytes32 name,
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        $.namedTokens.set(name, GMPUtils.addressToBytes32(token));
        emit NamedTokenSet(name, token);
    }

    function getNamedToken(
        bytes32 name
    ) external view override returns (address) {
        return _getNamedToken(name);
    }

    function _getNamedToken(bytes32 name) internal view returns (address) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return GMPUtils.bytes32ToAddress($.namedTokens.get(name));
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

    function getRatio(address) external view returns (uint256) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return $.oracle.ratio();
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

    /**
     * Change the address of the Bascule drawbridge contract.
     * Setting the address to 0 disables the Bascule check.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function changeBascule(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeBascule(newVal);
    }

    function Bascule() external view returns (IBascule) {
        return _getStakingRouterStorage().bascule;
    }

    /**
     * Change the address of the Bascule drawbridge contract.
     * Setting the address to 0 disables the Bascule check.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function changeOracle(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeOracle(newVal);
    }

    function Oracle() external view returns (IOracle) {
        return _getStakingRouterStorage().oracle;
    }

    /**
     * Change the address of the Bascule drawbridge contract.
     * Setting the address to 0 disables the Bascule check.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function changeMaibox(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeMailbox(newVal);
    }

    function Mailbox() external view returns (IMailbox) {
        return _getStakingRouterStorage().mailbox;
    }

    /**
     * @notice Set the contract current fee for mint
     * @param fee New fee value
     * @dev zero allowed to disable fee
     */
    function setMintFee(uint256 fee) external onlyRole(OPERATOR_ROLE) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        uint256 oldFee = $.maximumFee;
        $.maximumFee = fee;
        emit StakingRouter_FeeChanged(oldFee, fee);
    }

    function getMintFee() external view returns (uint256) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        return $.maximumFee;
    }

    function startStake(
        bytes32 tolChainId,
        address,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external nonReentrant returns (address nativeToken) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        if (!_isAllowedCaller($, _msgSender())) {
            revert IStaking.NotStakingToken();
        }
        // if token not found will revert with Enum error
        nativeToken = _getNamedToken(keccak256("NativeLBTC"));
        if (
            !_isAllowedRoute(
                GMPUtils.addressToBytes32(nativeToken),
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
        if (!_isAllowedCaller($, _msgSender())) {
            revert IStaking.NotStakingToken();
        }
        bytes32 fromTokenBytes = GMPUtils.addressToBytes32(fromToken);
        if (
            !_isAllowedRoute(
                fromTokenBytes,
                tolChainId,
                Staking.BITCOIN_NAITIVE_COIN
            )
        ) {
            revert IStaking.UnstakeNotAllowed();
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
    ) external nonReentrant returns (bool, address) {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        (, bool success, bytes memory result) = $.mailbox.deliverAndHandle(
            rawPayload,
            proof
        );
        address recipient = abi.decode(result, (address));
        return (success, recipient);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(AccessControlDefaultAdminRulesUpgradeable, IERC165)
        returns (bool)
    {
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
        _confirmDeposit($, payload.id, receipt.amount);

        IBaseLBTC(receipt.toToken).mint(receipt.recipient, receipt.amount);
        // emit StakingOperationCompleted(receipt.recipient, toToken, receipt.amount);
        return abi.encode(receipt.recipient);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param $ LBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(
        StakingRouterStorage storage $,
        bytes32 depositID,
        uint256 amount
    ) internal {
        IBascule bascule = $.bascule;
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
        }
    }

    /// @dev Zero Address allowed to disable bascule check
    function _changeBascule(address newVal) internal {
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        emit StakingRouter_BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    function _changeOracle(address newVal) internal {
        if (address(newVal) == address(0)) revert StakingRouter_ZeroAddress();
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        emit StakingRouter_OracleChanged(address($.oracle), newVal);
        $.oracle = IOracle(newVal);
    }

    function _changeMailbox(address newVal) internal {
        if (address(newVal) == address(0)) revert StakingRouter_ZeroAddress();
        StakingRouterStorage storage $ = _getStakingRouterStorage();
        emit StakingRouter_MailboxChanged(address($.mailbox), newVal);
        $.mailbox = IMailbox(newVal);
    }
}
