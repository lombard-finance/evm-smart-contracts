// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ERC165Upgradeable, IERC165} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IBridgeV2} from "./IBridgeV2.sol";
import {IHandler, GMPUtils} from "../gmp/IHandler.sol";
import {IMailbox} from "../gmp/IMailbox.sol";
import {IERC20MintableBurnable} from "../interfaces/IERC20MintableBurnable.sol";
import {RateLimits} from "../libs/RateLimits.sol";

/// @title ERC20 Token Bridge
/// @author Lombard.Finance
/// @notice The contract is a part of Lombard Finance protocol. The bridge utilize GMP for cross-chain communication.
/// @custom:security-contact legal@lombard.finance
contract BridgeV2 is
    IBridgeV2,
    IHandler,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable
{
    struct SenderConfig {
        bool whitelisted;
        uint32 feeDiscount; // percentage
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.BridgeV2
    struct BridgeV2Storage {
        mapping(bytes32 => bytes32) bridgeContract; // destination chain => PathConfig
        mapping(bytes32 => bytes32) allowedDestinationToken; // keccak256( destinationChain | sourceToken ) => destinationToken token, see `_calcAllowedTokenId`
        mapping(bytes32 => address) allowedSourceToken; // keccak256( destinationChain | destinationToken ) => sourceToken
        IMailbox mailbox;
        mapping(bytes32 => bool) payloadSpent;
        mapping(address => SenderConfig) senderConfig;
        mapping(bytes32 => RateLimits.Data) rateLimit; // rate limit withdraw (keccak256(sourceChain | token) => RateLimits.Data)
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BridgeV2")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_STORAGE_LOCATION =
        0xc94507416bfc109a2751d5191119e07e0958874eb50a6e7baf934f22dc74c000;

    uint32 internal constant FEE_DISCOUNT_BASE = 100_00;

    /// @dev The version of the bridge message. Should be less or equal on another chain to be compatible.
    uint8 public constant MSG_VERSION = 1;
    uint256 internal constant MSG_LENGTH = 129;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Proxy initializer
    /// @param owner_ The owner of the contract
    /// @param mailbox_ The GMP Mailbox contract address
    function initialize(
        address owner_,
        IMailbox mailbox_
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __ERC165_init();

        __BridgeV2_init(mailbox_);
    }

    function __BridgeV2_init(IMailbox mailbox_) internal onlyInitializing {
        if (address(mailbox_) == address(0)) {
            revert BridgeV2_ZeroMailbox();
        }
        _getStorage().mailbox = mailbox_;
    }

    /// @notice Enable bridge to the `destinationBridge_` contract on `destinationChain`
    /// @dev to disable path set destination bridge as bytes32(0)
    /// @param destinationChain The chain where `destinationBridge_` presented
    /// @param destinationBridge_ The bridge contract on `destinationChain`
    function setDestinationBridge(
        bytes32 destinationChain,
        bytes32 destinationBridge_
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert BridgeV2_ZeroChainId();
        }

        BridgeV2Storage storage $ = _getStorage();
        $.bridgeContract[destinationChain] = destinationBridge_;
        emit DestinationBridgeSet(destinationChain, destinationBridge_);
    }

    /// @notice Add token pathway
    /// @param destinationChain The destination chain
    /// @param sourceToken The bridgeable token on this chain
    /// @param destinationToken The token address on destination chain to be minted
    function addDestinationToken(
        bytes32 destinationChain,
        address sourceToken,
        bytes32 destinationToken
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert BridgeV2_ZeroPath();
        }

        if (sourceToken == address(0)) {
            revert BridgeV2_ZeroToken();
        }

        if (destinationToken == bytes32(0)) {
            revert BridgeV2_ZeroToken();
        }

        if (
            !GMPUtils.validateAddressLength(destinationChain, destinationToken)
        ) {
            revert BridgeV2_InvalidToken();
        }

        BridgeV2Storage storage $ = _getStorage();

        if ($.bridgeContract[destinationChain] == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        bytes32 destTokenId = _calcAllowedTokenId(
            destinationChain,
            GMPUtils.addressToBytes32(sourceToken)
        );
        bytes32 srcTokenId = _calcAllowedTokenId(
            destinationChain,
            destinationToken
        );

        if ($.allowedDestinationToken[destTokenId] != bytes32(0)) {
            revert BridgeV2_AlreadyAllowed(destTokenId);
        }
        if ($.allowedSourceToken[srcTokenId] != address(0)) {
            revert BridgeV2_AlreadyAllowed(srcTokenId);
        }

        $.allowedDestinationToken[destTokenId] = destinationToken;
        $.allowedSourceToken[srcTokenId] = sourceToken;

        emit DestinationTokenAdded(
            destinationChain,
            destinationToken,
            sourceToken
        );
    }

    /// @dev The method is made for [BridgeTokenAdapter] contract, because [burn] method not called directly on token.
    /// @param token The spendable token
    /// @param tokenAdapter The token adapter contract
    /// @param allow The flag. If true, then allow uint256.max to spend by `tokenAdapter`
    /// @custom:access The caller must be the owner.
    function setAllowance(
        IERC20 token,
        address tokenAdapter,
        bool allow
    ) external onlyOwner {
        SafeERC20.forceApprove(
            token,
            tokenAdapter,
            allow ? type(uint256).max : 0
        );
    }

    /// @notice Get token on destination chain
    /// @param destinationChain The destination chain where token presented
    /// @param sourceToken The bridgeable token on this chain
    function getAllowedDestinationToken(
        bytes32 destinationChain,
        address sourceToken
    ) external view override returns (bytes32) {
        // do not return allowed token if bridge on destination chain is not available
        if (destinationBridge(destinationChain) == bytes32(0)) {
            return bytes32(0);
        }

        return
            _getStorage().allowedDestinationToken[
                _calcAllowedTokenId(
                    destinationChain,
                    GMPUtils.addressToBytes32(sourceToken)
                )
            ];
    }

    /// @notice Remove token pathway
    /// @param destinationChain The chain where token can be bridged (non-zero)
    /// @param sourceToken The token on this chain (non-zero)
    /// @custom:access Only owner
    function removeDestinationToken(
        bytes32 destinationChain,
        address sourceToken
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert BridgeV2_ZeroPath();
        }

        if (sourceToken == address(0)) {
            revert BridgeV2_ZeroToken();
        }

        BridgeV2Storage storage $ = _getStorage();

        if ($.bridgeContract[destinationChain] == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        bytes32 destTokenId = _calcAllowedTokenId(
            destinationChain,
            GMPUtils.addressToBytes32(sourceToken)
        );

        bytes32 destinationToken = $.allowedDestinationToken[destTokenId];
        if (destinationToken == bytes32(0)) {
            revert BridgeV2_TokenNotAllowed();
        }

        bytes32 srcTokenId = _calcAllowedTokenId(
            destinationChain,
            destinationToken
        );
        if ($.allowedSourceToken[srcTokenId] != sourceToken) {
            revert BridgeV2_TokenNotAllowed();
        }

        delete $.allowedDestinationToken[destTokenId];
        delete $.allowedSourceToken[srcTokenId];

        emit DestinationTokenRemoved(
            destinationChain,
            destinationToken,
            sourceToken
        );
    }

    /// @notice Set withdrawal limits for token and destination chain
    /// @param token The token on this chain
    /// @param config Rate limit config
    function setTokenRateLimits(
        address token,
        RateLimits.Config memory config
    ) external onlyOwner {
        RateLimits.setRateLimit(
            _getStorage().rateLimit[_calcRateLimitId(config.chainId, token)],
            config
        );
        emit RateLimitsSet(token, config.chainId, config.limit, config.window);
    }

    /// @notice Get withdrawal rate limit
    /// @param token The token address on this chain
    /// @param sourceChainId The chain of where bridge deposited (source of the bridge)
    /// @return currentAmountInFlight The amount in the current window.
    /// @return amountCanBeSent The amount that can be sent.
    function getTokenRateLimit(
        address token,
        bytes32 sourceChainId
    )
        external
        view
        returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)
    {
        return
            RateLimits.availableAmountToSend(
                _getStorage().rateLimit[_calcRateLimitId(sourceChainId, token)]
            );
    }

    /// @notice Set config of sender
    /// @param sender The sender (e.g. CCIP TokenPool)
    /// @param feeDiscount The fee discount in percents (100_00 = 100%)
    /// @param whitelisted Is sender allowed to interact with the bridge.
    function setSenderConfig(
        address sender,
        uint32 feeDiscount,
        bool whitelisted
    ) external onlyOwner {
        if (sender == address(0)) {
            revert BridgeV2_ZeroSender();
        }

        if (feeDiscount > FEE_DISCOUNT_BASE) {
            revert BridgeV2_TooBigDiscount();
        }
        SenderConfig storage conf = _getStorage().senderConfig[sender];

        conf.feeDiscount = feeDiscount;
        conf.whitelisted = whitelisted;

        emit SenderConfigChanged(sender, feeDiscount, whitelisted);
    }

    /// @notice Get current sender config
    /// @param sender The sender address
    /// @return senderConfig The config of sender
    function getSenderConfig(
        address sender
    ) external view returns (SenderConfig memory) {
        return _getStorage().senderConfig[sender];
    }

    /// @notice Get the fee for relaying bridge message through GMP protocol.
    /// @param sender The caller of deposit method
    /// @return fee The fee in native currency to be paid during deposit
    function getFee(address sender) external view returns (uint256) {
        bytes memory body = _encodeMsg(
            bytes32(0),
            bytes32(0),
            bytes32(0),
            uint256(0)
        );
        return _getFee(_getStorage(), sender, body);
    }

    /**
     * @notice Deposits on behalf of the `sender` and burns tokens from `msg.sender` in order to mint on `destinationChain`.
     * Emits a `DepositToBridge` event.
     * @param destinationChain The chain where bridge the token.
     * @param token Address of the token burned on the source chain.
     * @param sender The initial address that bridge the token.
     * @param recipient Address of recipient on `destinationChain`, as bytes32 (must be non-zero)
     * @param amount Amount of tokens to burn (must be non-zero)
     * @param destinationCaller Caller on the `destinationChain`, as bytes32
     * @return nonce The nonce of payload.
     * @return payloadHash The hash of payload
     */
    function deposit(
        bytes32 destinationChain,
        address token,
        address sender,
        bytes32 recipient,
        uint256 amount,
        bytes32 destinationCaller
    ) external payable override nonReentrant returns (uint256, bytes32) {
        if (sender == address(0)) {
            revert BridgeV2_ZeroSender();
        }
        return
            _deposit(
                destinationChain,
                IERC20MintableBurnable(token),
                sender,
                recipient,
                amount,
                destinationCaller
            );
    }

    /// @notice Deposits and burns tokens from tx sender to be minted on `destinationChain`.
    /// Emits a `DepositToBridge` event.
    /// @param destinationChain The chain where bridge the token.
    /// @param token address of the token burned on the source chain
    /// @param recipient address of mint recipient on `destinationChain`, as bytes32 (must be non-zero)
    /// @param amount amount of tokens to burn (must be non-zero)
    /// @param destinationCaller caller on the `destinationChain`, as bytes32
    /// @return nonce The nonce of payload.
    /// @return payloadHash The hash of payload
    function deposit(
        bytes32 destinationChain,
        address token,
        bytes32 recipient,
        uint256 amount,
        bytes32 destinationCaller
    ) external payable override nonReentrant returns (uint256, bytes32) {
        return
            _deposit(
                destinationChain,
                IERC20MintableBurnable(token),
                _msgSender(),
                recipient,
                amount,
                destinationCaller
            );
    }

    function _deposit(
        bytes32 destinationChain,
        IERC20MintableBurnable token,
        address sender,
        bytes32 recipient,
        uint256 amount,
        bytes32 destinationCaller
    ) internal returns (uint256 nonce, bytes32 payloadHash) {
        // amount must be nonzero
        if (amount == 0) {
            revert BridgeV2_ZeroAmount();
        }

        // recipient must be nonzero
        if (recipient == bytes32(0)) {
            revert BridgeV2_ZeroRecipient();
        }
        if (!GMPUtils.validateAddressLength(destinationChain, recipient)) {
            revert BridgeV2_InvalidRecipient();
        }

        BridgeV2Storage storage $ = _getStorage();

        if (!$.senderConfig[_msgSender()].whitelisted) {
            revert BridgeV2_SenderNotWhitelisted(_msgSender());
        }

        bytes32 _destinationBridge = $.bridgeContract[destinationChain];
        // destination bridge must be nonzero
        if (_destinationBridge == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        bytes32 destinationToken = $.allowedDestinationToken[
            _calcAllowedTokenId(
                destinationChain,
                GMPUtils.addressToBytes32(address(token))
            )
        ];
        // destination token must be nonzero
        if (destinationToken == bytes32(0)) {
            revert BridgeV2_TokenNotAllowed();
        }

        _burnToken(token, amount);

        bytes memory body = _encodeMsg(
            destinationToken,
            GMPUtils.addressToBytes32(sender),
            recipient,
            amount
        );

        _assertFee($, body);

        // send message via mailbox
        (nonce, payloadHash) = $.mailbox.send{value: msg.value}(
            destinationChain,
            _destinationBridge,
            destinationCaller,
            body
        );

        emit DepositToBridge(sender, recipient, payloadHash);
        return (nonce, payloadHash);
    }

    function _burnToken(IERC20MintableBurnable token, uint256 amount) internal {
        // take and burn `token` from `_msgSender()`
        SafeERC20.safeTransferFrom(token, _msgSender(), address(this), amount);
        token.burn(amount);
    }

    function _assertFee(BridgeV2Storage storage $, bytes memory body) internal {
        uint256 expectedFee = _getFee($, _msgSender(), body);
        if (msg.value < expectedFee) {
            revert BridgeV2_NotEnoughFee(expectedFee, msg.value);
        }
    }

    function _getFee(
        BridgeV2Storage storage $,
        address sender,
        bytes memory body
    ) internal view returns (uint256) {
        uint32 feeDiscount = $.senderConfig[sender].feeDiscount;

        // the bridge is excluded from the fees on mailbox,
        // because some providers can't transfer additional value in tx
        // e.g. CCIP TokenPool
        // so, the calculation of fee is based on zero address
        uint256 fee = $.mailbox.getFee(address(0), body);

        // each sender could be discounted from fee for some percentage
        // because as mentioned above, bridge itself excluded from fees,
        // what means bridge can use any arbitrary fee
        return fee - ((fee * feeDiscount) / FEE_DISCOUNT_BASE);
    }

    /**
     * @notice Handles an incoming notarized payload received by the Mailbox,
     * mints the token to the requested recipient on the chain.
     * @dev Validates the `msg.sender` is the Mailbox, and the payload `msgSender`
     * is a registered bridge for `msgPath`.
     * @param payload The parsed payload.
     * @return result Empty bytes.
     */
    function handlePayload(
        GMPUtils.Payload memory payload
    ) external nonReentrant returns (bytes memory) {
        BridgeV2Storage storage $ = _getStorage();

        // only mailbox is authorized to call
        if (_msgSender() != address($.mailbox)) {
            revert BridgeV2_MailboxExpected();
        }

        // prevent double spend
        if ($.payloadSpent[payload.id]) {
            revert BridgeV2_PayloadSpent();
        }
        $.payloadSpent[payload.id] = true;

        bytes32 chainId = $.mailbox.getInboundMessagePath(payload.msgPath);

        bytes32 sourceBridge = $.bridgeContract[chainId];
        if (sourceBridge == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        if (payload.msgSender != sourceBridge) {
            revert BridgeV2_BadMsgSender();
        }

        _withdraw($, chainId, payload.msgBody);

        return new bytes(0);
    }

    function _withdraw(
        BridgeV2Storage storage $,
        bytes32 chainId,
        bytes memory msgBody
    ) internal {
        (address token, , address recipient, uint256 amount) = decodeMsgBody(
            msgBody
        );

        if (
            $.allowedDestinationToken[
                _calcAllowedTokenId(chainId, GMPUtils.addressToBytes32(token))
            ] == bytes32(0)
        ) {
            revert BridgeV2_TokenNotAllowed();
        }

        // check rate limits
        RateLimits.Data storage rl = $.rateLimit[
            _calcRateLimitId(chainId, token)
        ];
        RateLimits.updateLimit(rl, amount);

        IERC20MintableBurnable(token).mint(recipient, amount);

        emit WithdrawFromBridge(recipient, chainId, token, amount);
    }

    /// @notice Decode bridge message. The version of message should be less or equal to current.
    /// @param msgBody Encoded body of bridge message.
    /// @return token The address of token to be minted
    /// @return sender The sender of tokens
    /// @return recipient The recipient of tokens
    /// @return amount The amount to be minted on destination chain
    function decodeMsgBody(
        bytes memory msgBody
    ) public pure returns (address, address, address, uint256) {
        if (msgBody.length != MSG_LENGTH) {
            revert BridgeV2_InvalidMsgBodyLength(MSG_LENGTH, msgBody.length);
        }

        uint8 version;
        bytes32 token;
        bytes32 sender;
        bytes32 recipient;
        uint256 amount;

        assembly {
            version := byte(0, mload(add(msgBody, 0x20))) // first byte

            token := mload(add(msgBody, 0x21)) // bytes 1..32
            sender := mload(add(msgBody, 0x41)) // bytes 33..64
            recipient := mload(add(msgBody, 0x61)) // bytes 65..96
            amount := mload(add(msgBody, 0x81)) // bytes 97..128
        }

        if (version != MSG_VERSION) {
            revert BridgeV2_VersionMismatch(MSG_VERSION, version);
        }

        if (amount == 0) {
            revert BridgeV2_ZeroAmount();
        }

        if (sender == bytes32(0)) {
            revert BridgeV2_ZeroSender();
        }

        if (recipient == bytes32(0)) {
            revert BridgeV2_ZeroRecipient();
        }

        if (token == bytes32(0)) {
            revert BridgeV2_ZeroToken();
        }

        return (
            GMPUtils.bytes32ToAddress(token),
            GMPUtils.bytes32ToAddress(sender),
            GMPUtils.bytes32ToAddress(recipient),
            amount
        );
    }

    /**
     * @notice Rescue ERC20 tokens locked up in this contract.
     * @dev Only Owner
     * @param tokenContract ERC20 token contract address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function rescueERC20(
        IERC20 tokenContract,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) {
            revert BridgeV2_ZeroRecipient();
        }
        SafeERC20.safeTransfer(tokenContract, to, amount);
    }

    /// @notice Get the address of bridge contract on destination chain
    /// @param chainId The destination chain id
    /// @return bridge The address of the bridge contract
    function destinationBridge(bytes32 chainId) public view returns (bytes32) {
        return _getStorage().bridgeContract[chainId];
    }

    /// @notice Get the mailbox contract address
    /// @return mailbox The mailbox address
    function mailbox() external view returns (address) {
        return address(_getStorage().mailbox);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165Upgradeable, IERC165) returns (bool) {
        return
            type(IBridgeV2).interfaceId == interfaceId ||
            type(IHandler).interfaceId == interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _encodeMsg(
        bytes32 destinationToken,
        bytes32 sender,
        bytes32 recipient,
        uint256 amount
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                MSG_VERSION,
                destinationToken,
                sender,
                recipient,
                amount
            );
    }

    function _calcAllowedTokenId(
        bytes32 destinationChain,
        bytes32 token
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(destinationChain, token));
    }

    function _calcRateLimitId(
        bytes32 sourceChain,
        address destinationToken
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sourceChain, destinationToken));
    }

    function _getStorage() private pure returns (BridgeV2Storage storage $) {
        assembly {
            $.slot := BRIDGE_STORAGE_LOCATION
        }
    }
}
