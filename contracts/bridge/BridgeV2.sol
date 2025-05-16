// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ERC165Upgradeable, IERC165} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FeeUtils} from "../libs/FeeUtils.sol";
import {IAdapter} from "./adapters/IAdapter.sol";
import {IBridge, ILBTC, INotaryConsortium} from "./IBridge.sol";
import {IBridgeV2} from "./IBridgeV2.sol";
import {IHandler, GMPUtils} from "../gmp/IHandler.sol";
import {IMailbox} from "../gmp/IMailbox.sol";
import {IERC20MintableBurnable} from "../interfaces/IERC20MintableBurnable.sol";

/**
 * @title ERC20 Token Bridge
 * @author Lombard.Finance
 * @notice The contract is a part of Lombard Finance protocol. The bridge utilize GMP for cross-chain communication.
 */
contract BridgeV2 is
    IBridgeV2,
    IHandler,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.BridgeV2
    struct BridgeV2Storage {
        mapping(bytes32 => bytes32) bridgeContract; // destination chain => PathConfig
        mapping(bytes32 => bytes32) allowedToken; // keccak256( destinationChain | sourceToken ) => bytes32 token, see `_calcAllowedTokenId`
        IMailbox mailbox;
        mapping(bytes32 => bool) payloadSpent;
    }

    // TODO: calculate
    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.v2.Bridge")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_STORAGE_LOCATION =
        0x577a31cbb7f7b010ebd1a083e4c4899bcd53b83ce9c44e72ce3223baedbbb600;

    uint8 public constant MSG_VERSION = 1;
    uint256 internal constant MSG_LENGTH = 97;

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
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __ERC165_init();

        __BridgeV2_init(mailbox_);
    }

    function __BridgeV2_init(IMailbox mailbox_) internal onlyInitializing {
        _getStorage().mailbox = mailbox_;
        // TODO: emit event, verify for zero
    }

    /// to disable path set destination bridge as bytes32(0)
    function setDestinationBridge(
        bytes32 destinationChain,
        bytes32 destinationBridge
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert BridgeV2_ZeroChainId();
        }

        BridgeV2Storage storage $ = _getStorage();
        $.bridgeContract[destinationChain] = destinationBridge;
        // TODO: emit event
    }

    /// allow to set bytes32(0) destination token in case if we want to disable it
    function setDestinationToken(
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

        BridgeV2Storage storage $ = _getStorage();

        if ($.bridgeContract[destinationChain] == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        $.allowedToken[
            _calcAllowedTokenId(destinationChain, sourceToken)
        ] = destinationToken;
        // TODO: emit event
    }

    // TODO: implement fees
    // TODO: whitelisting
    // TODO: rate limits
    function deposit(
        bytes32 destinationChain,
        IERC20MintableBurnable token,
        bytes32 recipient,
        uint256 amount,
        bytes32 destinationCaller
    ) external payable nonReentrant returns (uint256, bytes32) {
        if (amount == 0) {
            revert BridgeV2_ZeroAmount();
        }

        if (recipient == bytes32(0)) {
            revert BridgeV2_ZeroRecipient();
        }

        BridgeV2Storage storage $ = _getStorage();

        bytes32 destinationBridge = $.bridgeContract[destinationChain];

        if (destinationBridge == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        bytes32 destinationToken = $.allowedToken[
            _calcAllowedTokenId(destinationChain, address(token))
        ];
        if (destinationToken == bytes32(0)) {
            revert BridgeV2_TokenNotAllowed();
        }

        // take asset
        SafeERC20.safeTransferFrom(token, _msgSender(), address(this), amount);

        token.burn(amount);

        bytes memory body = abi.encodePacked(
            MSG_VERSION,
            destinationToken,
            recipient,
            amount
        );
        // send message via mailbox
        (uint256 nonce, bytes32 payloadHash) = $.mailbox.send(
            destinationChain,
            destinationBridge,
            destinationCaller,
            body
        );

        emit DepositToBridge(_msgSender(), recipient, payloadHash);
        return (nonce, payloadHash);
    }

    function handlePayload(
        GMPUtils.Payload memory payload
    ) external nonReentrant returns (bytes memory) {
        BridgeV2Storage storage $ = _getStorage();

        if (_msgSender() != address($.mailbox)) {
            revert BridgeV2_MailboxExpected();
        }

        if ($.payloadSpent[payload.id]) {
            revert BridgeV2_PayloadSpent();
        }

        bytes32 chainId = $.mailbox.getInboundMessagePath(payload.msgPath);

        bytes32 sourceBridge = $.bridgeContract[chainId];
        if (sourceBridge == bytes32(0)) {
            revert BridgeV2_PathNotAllowed();
        }

        if (payload.msgSender != sourceBridge) {
            revert BridgeV2_BadMsgSender();
        }

        _withdraw(chainId, payload.msgBody);

        return new bytes(0);
    }

    function _withdraw(bytes32 chainId, bytes memory msgBody) internal {
        (address token, address recipient, uint256 amount) = decodeMsgBody(
            msgBody
        );
        IERC20MintableBurnable(token).mint(recipient, amount);

        emit WithdrawFromBridge(recipient, chainId, token, amount);
    }

    function decodeMsgBody(
        bytes memory msgBody
    ) public pure returns (address, address, uint256) {
        if (msgBody.length != MSG_LENGTH) {
            revert BridgeV2_InvalidMsgBodyLength(MSG_LENGTH, msgBody.length);
        }

        uint8 version;
        bytes32 token;
        bytes32 recipient;
        uint256 amount;

        assembly {
            version := byte(0, mload(add(msgBody, 0x20))) // first byte

            token := mload(add(msgBody, 0x21)) // bytes 1..32
            recipient := mload(add(msgBody, 0x41)) // bytes 33..64
            amount := mload(add(msgBody, 0x61)) // bytes 65..96
        }

        if (version != MSG_VERSION) {
            revert BridgeV2_VersionMismatch(MSG_VERSION, version);
        }

        return (
            GMPUtils.bytes32ToAddress(token),
            GMPUtils.bytes32ToAddress(recipient),
            amount
        );
    }

    function destinationBridge(
        bytes32 chainId
    ) external view returns (bytes32) {
        return _getStorage().bridgeContract[chainId];
    }

    function mailbox() external view returns (address) {
        return address(_getStorage().mailbox);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC165Upgradeable, IERC165) returns (bool) {
        return
            type(IHandler).interfaceId == interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _calcAllowedTokenId(
        bytes32 destinationChain,
        address sourceToken
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(destinationChain, sourceToken));
    }

    function _getStorage() private pure returns (BridgeV2Storage storage $) {
        assembly {
            $.slot := BRIDGE_STORAGE_LOCATION
        }
    }
}
