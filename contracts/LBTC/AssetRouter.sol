// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC165Upgradeable, IERC165} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {IAssetRouter} from "./interfaces/IAssetRouter.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IHandler, GMPUtils} from "../gmp/IHandler.sol";
import {IMailbox} from "../gmp/IMailbox.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Actions} from "../libs/Actions.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {LChainId} from "../libs/LChainId.sol";
import {Assert} from "./libraries/Assert.sol";
import {Assets} from "./libraries/Assets.sol";
import {Validation} from "./libraries/Validation.sol";

/**
 * @title Router to store xxxLBTC Staking paths and token's name.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract AssetRouter is
    IAssetRouter,
    IHandler,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.AssetRouter
    struct AssetRouterStorage {
        bytes32 ledgerChainId;
        bytes32 bitcoinChainId;
        mapping(bytes32 => Route) routes;
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
        IMailbox mailbox;
        mapping(address => bool) allowedCallers; // tokenAddress => is allowed to use router
        IBascule bascule;
        uint256 maximumFee;
        uint256 dustFeeRate;
        IOracle oracle;
        uint64 toNativeCommission;
        address nativeToken;
    }

    struct Destination {
        bool initialized;
        bool native;
    }
    struct Route {
        mapping(bytes32 => Destination) toTokens;
        bytes32 toChainId;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.AssetRouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant Staking_ROUTER_STORAGE_LOCATION =
        0x634af38ba2564e2d74d7d4e289db84afe1b0f1c101e1349f6428c2bd44a09b00;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint48 initialOwnerDelay_,
        bytes32 ledgerChainId_,
        bytes32 bitcoinChainId_,
        IMailbox mailbox_,
        IOracle oracle_,
        IBascule bascule_,
        uint64 toNativeCommission_
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay_, owner_);
        __ReentrancyGuard_init();
        __AssetRouter_init(
            ledgerChainId_,
            bitcoinChainId_,
            mailbox_,
            oracle_,
            bascule_,
            toNativeCommission_
        );
    }

    function __AssetRouter_init(
        bytes32 ledgerChainId_,
        bytes32 bitcoinChainId_,
        IMailbox mailbox_,
        IOracle oracle_,
        IBascule bascule_,
        uint64 toNativeCommission_
    ) internal onlyInitializing {
        if (address(mailbox_) == address(0)) {
            revert AssetRouter_ZeroMailbox();
        }
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        $.mailbox = mailbox_;
        $.oracle = oracle_;
        $.bascule = bascule_;
        $.ledgerChainId = ledgerChainId_;
        $.bitcoinChainId = bitcoinChainId_;
        $.toNativeCommission = toNativeCommission_;
        $.dustFeeRate = BitcoinUtils.DEFAULT_DUST_FEE_RATE;
    }

    function setRoute(
        bytes32 fromToken,
        bytes32 fromChainId,
        bytes32 toToken,
        bool toTokenIsNative,
        bytes32 toChainId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        r.toTokens[toToken] = Destination({
            initialized: true,
            native: toTokenIsNative
        });
        r.toChainId = toChainId;
        if (fromChainId == LChainId.get()) {
            _checkAndSetNativeToken($, fromToken);
        }
        if (toChainId == LChainId.get()) {
            _checkAndSetNativeToken($, toToken);
        }
        emit AssetRouter_RouteSet(fromToken, fromChainId, toToken, toTokenIsNative, toChainId);
    }

    function removeRoute(
        bytes32 fromToken,
        bytes32 fromChainId,
        bytes32 toToken,
        bytes32 toChainId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        delete r.toTokens[toToken];
        emit AssetRouter_RouteRemoved(fromToken, fromChainId, toToken, toChainId);
    }

    function _checkAndSetNativeToken(AssetRouterStorage storage $, bytes32 token) internal {
        address tokenAddress = GMPUtils.bytes32ToAddress(token);
            $.allowedCallers[tokenAddress] = true;
            if (IBaseLBTC(tokenAddress).isNative()) {
                if (
                    $.nativeToken != address(0) &&
                    $.nativeToken != tokenAddress
                ) {
                    revert AssetRouter_WrongNativeToken();
                }
                $.nativeToken = tokenAddress;
            }
    }

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken,
        bool toNative
    ) external view override returns (bool) {
        return _isAllowedRoute(fromToken, toChainId, toToken, toNative);
    }

    function _isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken,
        bool toNative
    ) internal view returns (bool) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        bytes32 key = keccak256(abi.encode(fromToken, toChainId));
        Route storage r = $.routes[key];
        return
            r.toTokens[toToken].initialized &&
            r.toChainId == toChainId &&
            (r.toTokens[toToken].native == toNative);
    }

    function _isAllowedCaller(
        AssetRouterStorage storage $,
        address caller
    ) internal view returns (bool) {
        return $.allowedCallers[caller];
    }

    function getRatio(address) external view returns (uint256) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        return $.oracle.ratio();
    }

    function getBitcoinChainId() external view override returns (bytes32) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        return $.bitcoinChainId;
    }

    function _getAssetRouterStorage()
        private
        pure
        returns (AssetRouterStorage storage $)
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
        return _getAssetRouterStorage().bascule;
    }

    /**
     * Change the address of the Oracle contract.
     * Setting the address to 0 is nor allowed.
     * @param newVal The new address.
     *
     * Emits a {OracleChanged} event.
     */
    function changeOracle(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeOracle(newVal);
    }

    function Oracle() external view returns (IOracle) {
        return _getAssetRouterStorage().oracle;
    }

    /**
     * Change the address of the Mailbox contract.
     * Setting the address to 0 is not allowed.
     * @param newVal The new address.
     *
     * Emits a {MailboxChanged} event.
     */
    function changeMailbox(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeMailbox(newVal);
    }

    function Mailbox() external view returns (IMailbox) {
        return _getAssetRouterStorage().mailbox;
    }

    function changeToNativeCommission(
        uint64 newValue
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeToNativeCommission(newValue);
    }

    function changeNativeToken(
        address newValue
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeNativeToken(newValue);
    }

    /**
     * @notice Set the contract current fee for mint
     * @param fee New fee value
     * @dev zero allowed to disable fee
     */
    function setMintFee(uint256 fee) external onlyRole(OPERATOR_ROLE) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        uint256 oldFee = $.maximumFee;
        $.maximumFee = fee;
        emit AssetRouter_MintFeeChanged(oldFee, fee);
    }

    function getMintFee() external view returns (uint256) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        return $.maximumFee;
    }

    function deposit(
        address fromAddress,
        address toToken,
        uint256 amount
    ) external nonReentrant {
        address sender = address(_msgSender());
        if (sender != fromAddress && sender != toToken) {
            revert AssetRouter_Unauthorized();
        }
        _deposit(
            fromAddress,
            LChainId.get(),
            GMPUtils.addressToBytes32(toToken),
            GMPUtils.addressToBytes32(fromAddress),
            amount
        );
    }

    function deposit(
        address fromAddress,
        bytes32 tolChainId,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external nonReentrant {
        address sender = address(_msgSender());
        if (sender != fromAddress) {
            revert AssetRouter_Unauthorized();
        }
        _deposit(fromAddress, tolChainId, toToken, recipient, amount);
    }

    function _deposit(
        address fromAddress,
        bytes32 tolChainId,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) internal {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        if (
            !_isAllowedRoute(
                GMPUtils.addressToBytes32($.nativeToken),
                tolChainId,
                toToken,
                false
            )
        ) {
            revert IStaking.StakingNotAllowed();
        }

        bytes memory rawPayload = Assets.encodeStakeRequest(
            tolChainId,
            toToken,
            recipient,
            amount
        );

        $.mailbox.send(
            $.ledgerChainId,
            Assets.LEDGER_SENDER_RECIPIENT,
            Assets.LEDGER_CALLER,
            rawPayload
        );
        IBaseLBTC($.nativeToken).burn(fromAddress, amount);
    }

    function calcUnstakeRequestAmount(
        address token,
        bytes calldata scriptPubkey,
        uint256 amount
    ) external view returns (uint256 amountAfterFee, bool isAboveDust) {
        uint256 redeemFee = IBaseLBTC(token).getRedeemFee();
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        if (IBaseLBTC(token).isNative()) {
            (amountAfterFee, , , isAboveDust) = Validation.calcFeeAndDustLimit(
                scriptPubkey,
                $.dustFeeRate,
                amount - redeemFee,
                $.toNativeCommission
            );
            return (amountAfterFee, isAboveDust);
        }
        (amountAfterFee, , , isAboveDust) = Validation.calcFeeAndDustLimit(
            scriptPubkey,
            $.dustFeeRate,
            amount - redeemFee,
            $.toNativeCommission,
            $.oracle.ratio()
        );
        return (amountAfterFee, isAboveDust);
    }

    function redeemForBtc(
        address fromAddress,
        address fromToken,
        bytes calldata recipient,
        uint256 amount
    ) external nonReentrant {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        uint64 fee = $.toNativeCommission;
        if (!IBaseLBTC(fromToken).isRedeemsEnabled()) {
            revert AssetRouter_RedeemsForBtcDisabled();
        }
        uint256 amountAfterFee = 0;
        uint256 redeemFee = IBaseLBTC(fromToken).getRedeemFee();
        bytes32 gmpRecipient;
        if (IBaseLBTC(fromToken).isNative()) {
            amountAfterFee = Validation.redeemFee(
                recipient,
                $.dustFeeRate,
                amount - redeemFee,
                fee
            );
            gmpRecipient = Assets.LEDGER_NATIVE_SENDER_RECIPIENT;
        } else {
            amountAfterFee = Validation.redeemFee(
                recipient,
                $.dustFeeRate,
                amount - redeemFee,
                fee,
                $.oracle.ratio()
            );
            gmpRecipient = Assets.LEDGER_SENDER_RECIPIENT;
        }
        _redeem(
            $,
            fromAddress,
            $.bitcoinChainId,
            fromToken,
            Assets.BITCOIN_NATIVE_COIN,
            recipient,
            amountAfterFee,
            amount - amountAfterFee,
            gmpRecipient
        );
    }

    function redeem(
        address fromAddress,
        bytes32 tolChainId,
        address fromToken,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external nonReentrant {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        _redeem(
            $,
            fromAddress,
            tolChainId,
            fromToken,
            toToken,
            abi.encodePacked(recipient),
            amount,
            0,
            Assets.LEDGER_SENDER_RECIPIENT
        );
    }

    function redeem(
        address fromAddress,
        address fromToken,
        uint256 amount
    ) external nonReentrant {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        _redeem(
            $,
            fromAddress,
            LChainId.get(),
            fromToken,
            GMPUtils.addressToBytes32($.nativeToken),
            abi.encodePacked(GMPUtils.addressToBytes32(fromAddress)),
            amount,
            0,
            Assets.LEDGER_SENDER_RECIPIENT
        );
    }

    function _redeem(
        AssetRouterStorage storage $,
        address fromAddress,
        bytes32 tolChainId,
        address fromToken,
        bytes32 toToken,
        bytes memory recipient,
        uint256 amount,
        uint256 fee,
        bytes32 gmpRecipient
    ) internal {
        address sender = address(_msgSender());
        if (sender != fromAddress && sender != fromToken) {
            revert AssetRouter_Unauthorized();
        }
        if (!_isAllowedCaller($, fromToken)) {
            revert IStaking.NotStakingToken();
        }
        bytes32 fromTokenBytes = GMPUtils.addressToBytes32(fromToken);
        if (!_isAllowedRoute(fromTokenBytes, tolChainId, toToken, true)) {
            revert IStaking.UnstakeNotAllowed();
        }
        IBaseLBTC tokenContract = IBaseLBTC(fromToken);
        if (fee == 0) {
            uint256 redeemFee = tokenContract.getRedeemFee();
            if (amount <= redeemFee) {
                revert AssetRouter_FeeGreaterThanAmount();
            }
            amount -= redeemFee;
            fee = redeemFee;
        }

        bytes memory rawPayload = Assets.encodeUnstakeRequest(
            tolChainId,
            fromTokenBytes,
            recipient,
            amount
        );

        $.mailbox.send(
            $.ledgerChainId,
            gmpRecipient,
            Assets.LEDGER_CALLER,
            rawPayload
        );
        if (fee > 0) {
            tokenContract.transfer(
                fromAddress,
                tokenContract.getTreasury(),
                fee
            );
        }
        tokenContract.burn(fromAddress, amount);
    }

    function mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant returns (address) {
        (bool success, address recipient,,) = _mint(rawPayload, proof);
        if (!success) {
            revert AssetRouter_MintProcessingError();
        }
        return recipient;
    }

    function batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external nonReentrant {
        Assert.equalLength(payload.length, proof.length);
        for (uint256 i; i < payload.length; ++i) {
            (bool success,,,) = _mint(payload[i], proof[i]);
            if (!success) {
                bytes32 payloadHash = sha256(payload[i]);
                emit AssetRouter_BatchMintError(payloadHash, "", "");
            }
        }
    }
    function mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external nonReentrant {
        bool success = _mintWithFee(mintPayload, proof, feePayload, userSignature);
        if (!success) {
            revert AssetRouter_MintProcessingError();
        }
    }

    function batchMintWithFee(
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external nonReentrant {
        Assert.equalLength(mintPayload.length, proof.length);
        Assert.equalLength(mintPayload.length, feePayload.length);
        Assert.equalLength(mintPayload.length, userSignature.length);

        for (uint256 i; i < mintPayload.length; ++i) {
            bool success = _mintWithFee(
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i]
            );
            if (!success) {
                bytes32 payloadHash = sha256(mintPayload[i]);
                emit AssetRouter_BatchMintError(payloadHash, "", new bytes(0));
            }
        }
    }

    function _mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal returns (bool, address, address, uint256) {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        (, bool success, bytes memory result) = $.mailbox.deliverAndHandle(
            rawPayload,
            proof
        );
        if (!success) {
            return (false, address(0), address(0), 0);
        }
        (address recipient, address token, uint256 amount) = abi.decode(result, (address, address, uint256));
        return (success, recipient, token, amount);
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal virtual returns (bool) {
        (bool success,address recipient, address token, uint256 amount) = _mint(mintPayload, proof);
        if (!success) {
            return false;
        }
        IBaseLBTC tokenContract = IBaseLBTC(token);

        Assert.selector(feePayload, Actions.FEE_APPROVAL_ACTION);
        Actions.FeeApprovalAction memory feeAction = Actions.feeApproval(
            feePayload[4:]
        );

        AssetRouterStorage storage $ = _getAssetRouterStorage();
        address treasury = tokenContract.getTreasury();
        uint256 fee = Math.min($.maximumFee, feeAction.fee);

        {
            bytes32 digest = tokenContract.getFeeDigest(
                feeAction.fee,
                feeAction.expiry
            );
            Assert.feeApproval(digest, recipient, userSignature);
        }
        if (amount < fee) {
            revert AssetRouter_FeeGreaterThanAmount();
        }
        if (fee > 0) {
            tokenContract.transfer(recipient, treasury, fee);
        }

        emit AssetRouter_FeeCharged(fee, userSignature);
        return true;
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
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        if (_msgSender() != address($.mailbox)) {
            revert AssetRouter_MailboxExpected();
        }
        if (payload.msgSender != Assets.LEDGER_SENDER_RECIPIENT) {
            revert AssetRouter_WrongSender();
        }
        // spend payload
        if ($.usedPayloads[payload.id]) {
            revert AssetRouter_PayloadAlreadyUsed();
        }
        $.usedPayloads[payload.id] = true;
        (Assets.Release memory receipt, ) = Assets.decodeRelease(
            payload.msgBody
        );
        _confirmDeposit($, payload.id, receipt.amount);

        IBaseLBTC(receipt.toToken).mint(receipt.recipient, receipt.amount);
        // emit StakingOperationCompleted(receipt.recipient, toToken, receipt.amount);
        return abi.encode(receipt.recipient, receipt.toToken, receipt.amount);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param $ LBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(
        AssetRouterStorage storage $,
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
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        emit AssetRouter_BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    function _changeOracle(address newVal) internal {
        if (address(newVal) == address(0)) revert AssetRouter_ZeroAddress();
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        emit AssetRouter_OracleChanged(address($.oracle), newVal);
        $.oracle = IOracle(newVal);
    }

    function _changeMailbox(address newVal) internal {
        if (address(newVal) == address(0)) revert AssetRouter_ZeroAddress();
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        emit AssetRouter_MailboxChanged(address($.mailbox), newVal);
        $.mailbox = IMailbox(newVal);
    }

    /// @dev allow set to zero
    function _changeToNativeCommission(uint64 newValue) internal {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        uint64 prevValue = $.toNativeCommission;
        $.toNativeCommission = newValue;
        emit AssetRouter_ToNativeCommissionChanged(prevValue, newValue);
    }

    /// @dev allow set to zero
    function _changeNativeToken(address newValue) internal {
        AssetRouterStorage storage $ = _getAssetRouterStorage();
        address prevValue = $.nativeToken;
        $.nativeToken = newValue;
        emit AssetRouter_NativeTokenChanged(prevValue, newValue);
    }

    function getBascule() external view override returns (address) {
        return address(_getAssetRouterStorage().bascule);
    }

    function getOracle() external view override returns (address) {
        return address(_getAssetRouterStorage().oracle);
    }

    function getMailbox() external view override returns (address) {
        return address(_getAssetRouterStorage().mailbox);
    }

    function getToNativeCommission() external view override returns (uint64) {
        return _getAssetRouterStorage().toNativeCommission;
    }

    function getNativeToken() external view override returns (address) {
        return _getAssetRouterStorage().nativeToken;
    }
}
