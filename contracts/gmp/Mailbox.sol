// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MessagePath} from "./libs/MessagePath.sol";
import {IMailbox} from "./IMailbox.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {RateLimits} from "../libs/RateLimits.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LChainId} from "../libs/LChainId.sol";
import {IHandler} from "./IHandler.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {GMPUtils} from "./libs/GMPUtils.sol";

/**
 * @title Mailbox to send/receive messages by Lombard Generalized Message Passing Protocol
 * @author Lombard.Finance
 * @notice The contract is a part of Lombard Generalized Message Passing protocol
 */
contract Mailbox is
    IMailbox,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    using MessagePath for MessagePath.Details;

    struct SenderConfig {
        uint32 maxPayloadSize;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.Mailbox
    struct MailboxStorage {
        // Increments with each cross chain operation and should be part of the payload
        // Makes each payload unique
        uint256 globalNonce;
        mapping(bytes32 => bytes32) outboundMessagePath; // Message Path id => destination chain id
        mapping(bytes32 => bytes32) inboundMessagePath; // Message Path id => Source chain id
        mapping(bytes32 => bool) deliveredPayload; // sha256(rawPayload) => bool
        mapping(bytes32 => bool) handledPayload; // sha256(rawPayload) => bool
        INotaryConsortium consortium;
        uint32 defaultMaxPayloadSize;
        mapping(address => SenderConfig) senderConfig; // address => SenderConfig
    }

    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Mailbox")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MAILBOX_STORAGE_LOCATION =
        0x0278229f5c76f980110e38383ce9a522090076c3f8b366b016a9b1421b307400;

    /// Allow max 10 KB of data to be sent
    uint32 internal constant GLOBAL_MAX_PAYLOAD_SIZE = 10000;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        INotaryConsortium consortium_
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();

        __Mailbox_init(consortium_);
    }

    function __Mailbox_init(
        INotaryConsortium consortium_
    ) internal onlyInitializing {
        if (address(consortium_) == address(0)) {
            revert Mailbox_ZeroConsortium();
        }

        MailboxStorage storage $ = _getStorage();
        $.consortium = consortium_;
    }

    function consortium() external view returns (INotaryConsortium) {
        return _getStorage().consortium;
    }

    function enableMessagePath(
        bytes32 destinationChain,
        bytes32 destinationMailbox
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert Mailbox_ZeroChainId();
        }

        if (destinationMailbox == bytes32(0)) {
            revert Mailbox_ZeroMailbox();
        }

        bytes32 outboundId = _calcOutboundMessagePath(destinationChain);
        bytes32 inboundId = _calcInboundMessagePath(
            destinationChain,
            destinationMailbox
        );

        MailboxStorage storage $ = _getStorage();

        // set outbound message path if not exist
        if ($.outboundMessagePath[outboundId] != bytes32(0)) {
            revert Mailbox_MessagePathEnabled(outboundId);
        }
        $.outboundMessagePath[outboundId] = destinationChain;

        if ($.inboundMessagePath[inboundId] != bytes32(0)) {
            revert Mailbox_MessagePathEnabled(inboundId);
        }
        // store chain id of remote chain for message path
        $.inboundMessagePath[inboundId] = destinationChain;

        emit MessagePathEnabled(
            destinationChain,
            inboundId,
            outboundId,
            destinationMailbox
        );
    }

    function disableMessagePath(
        bytes32 destinationChain,
        bytes32 destinationMailbox
    ) external onlyOwner {
        if (destinationChain == bytes32(0)) {
            revert Mailbox_ZeroChainId();
        }

        if (destinationMailbox == bytes32(0)) {
            revert Mailbox_ZeroMailbox();
        }

        MailboxStorage storage $ = _getStorage();

        bytes32 outboundId = _calcOutboundMessagePath(destinationChain);
        bytes32 inboundId = _calcInboundMessagePath(
            destinationChain,
            destinationMailbox
        );

        delete $.outboundMessagePath[outboundId];
        delete $.inboundMessagePath[inboundId];

        emit MessagePathDisabled(
            destinationChain,
            inboundId,
            outboundId,
            destinationMailbox
        );
    }

    function _calcInboundMessagePath(
        bytes32 destinationChain,
        bytes32 destinationMailbox
    ) internal view returns (bytes32) {
        MessagePath.Details memory inboundPath = MessagePath.Details(
            destinationMailbox,
            destinationChain,
            LChainId.get()
        );
        return inboundPath.id();
    }

    function _calcOutboundMessagePath(
        bytes32 destinationChain
    ) internal view returns (bytes32) {
        MessagePath.Details memory outboundPath = MessagePath.Details(
            GMPUtils.addressToBytes32(address(this)),
            LChainId.get(),
            destinationChain
        );
        return outboundPath.id();
    }

    function setDefaultMaxPayloadSize(
        uint32 maxPayloadSize
    ) external onlyOwner {
        if (maxPayloadSize > GLOBAL_MAX_PAYLOAD_SIZE) {
            revert Mailbox_PayloadOversize(
                GLOBAL_MAX_PAYLOAD_SIZE,
                maxPayloadSize
            );
        }

        _getStorage().defaultMaxPayloadSize = maxPayloadSize;
        emit DefaultPayloadSizeSet(maxPayloadSize);
    }

    function setSenderConfig(
        address sender,
        uint32 maxPayloadSize
    ) external onlyOwner {
        if (maxPayloadSize > GLOBAL_MAX_PAYLOAD_SIZE) {
            revert Mailbox_PayloadOversize(
                GLOBAL_MAX_PAYLOAD_SIZE,
                maxPayloadSize
            );
        }

        MailboxStorage storage $ = _getStorage();
        $.senderConfig[sender].maxPayloadSize;

        emit SenderConfigUpdated(sender, maxPayloadSize);
    }

    function send(
        bytes32 destinationChain,
        bytes32 recipient,
        bytes32 destinationCaller,
        bytes calldata body
    ) external payable override nonReentrant returns (uint256, bytes32) {
        if (recipient == bytes32(0)) {
            revert Mailbox_ZeroRecipient();
        }
        MessagePath.Details memory messagePath = MessagePath.Details(
            GMPUtils.addressToBytes32(address(this)),
            LChainId.get(),
            destinationChain
        );
        bytes32 outboundId = messagePath.id();

        MailboxStorage storage $ = _getStorage();

        // revert if message path disabled
        if ($.outboundMessagePath[outboundId] == bytes32(0)) {
            revert Mailbox_MessagePathDisabled(outboundId);
        }

        uint256 nonce = $.globalNonce++;

        address msgSender = _msgSender();

        // prepare payload
        bytes memory rawPayload = GMPUtils.encodePayload(
            outboundId,
            nonce,
            GMPUtils.addressToBytes32(msgSender),
            recipient,
            destinationCaller,
            body
        );

        {
            SenderConfig memory senderCfg = _getSenderConfigWithDefault(
                $,
                msgSender
            );

            uint256 payloadSize = rawPayload.length;
            // in fact, when `defaultMaxPayloadSize` equals 0, there whitelisting of allowed senders
            if (payloadSize > senderCfg.maxPayloadSize) {
                revert Mailbox_PayloadOversize(
                    senderCfg.maxPayloadSize,
                    payloadSize
                );
            }
        }

        // TODO: calculate fee based on payload size

        emit MessageSent(destinationChain, msgSender, recipient, rawPayload);
        return (nonce, GMPUtils.hash(rawPayload));
    }

    // no replay protection
    // TODO: implement deliver only method, then relayer can only deliver payload
    function deliverAndHandle(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant returns (bytes32) {
        GMPUtils.Payload memory payload = GMPUtils.decodePayload(rawPayload);
        MailboxStorage storage $ = _getStorage();
        address msgSender = _msgSender();

        // revert if message path disabled
        if ($.inboundMessagePath[payload.msgPath] == bytes32(0)) {
            revert Mailbox_MessagePathDisabled(payload.msgPath);
        }

        bytes32 payloadHash = GMPUtils.hash(rawPayload);
        _verifyPayload($, payloadHash, proof, rawPayload);

        // verify who is able to execute message
        if (
            payload.msgDestinationCaller != address(0) &&
            payload.msgDestinationCaller != msgSender
        ) {
            revert Mailbox_UnexpectedDestinationCaller(
                payload.msgDestinationCaller,
                msgSender
            );
        }

        // check recipient interface
        if (
            !ERC165Checker.supportsInterface(
                payload.msgRecipient,
                type(IHandler).interfaceId
            )
        ) {
            revert Mailbox_HandlerNotImplemented();
        }

        try IHandler(payload.msgRecipient).handlePayload(payload) returns (
            bytes memory executionResult
        ) {
            emit MessageHandled(payloadHash, msgSender, executionResult);
            $.handledPayload[payloadHash] = true;
        } catch Error(string memory reason) {
            emit MessageHandleError(payloadHash, msgSender, reason);
        } catch (bytes memory lowLevelData) {
            emit MessageHandleError(
                payloadHash,
                msgSender,
                string(lowLevelData)
            );
        }

        return payloadHash;
    }

    function _verifyPayload(
        MailboxStorage storage $,
        bytes32 payloadHash,
        bytes calldata proof,
        bytes calldata rawPayload
    ) internal virtual {
        // if not verified check the proof
        if (!$.deliveredPayload[payloadHash]) {
            $.consortium.checkProof(payloadHash, proof);
            $.deliveredPayload[payloadHash] = true;
            emit MessageDelivered(payloadHash, _msgSender(), rawPayload);
        }
    }

    function getInboundMessagePath(
        bytes32 pathId
    ) external view override returns (bytes32) {
        return _getStorage().inboundMessagePath[pathId];
    }

    function _getStorage() private pure returns (MailboxStorage storage $) {
        assembly {
            $.slot := MAILBOX_STORAGE_LOCATION
        }
    }

    function _getSenderConfigWithDefault(
        MailboxStorage storage $,
        address sender
    ) internal view returns (SenderConfig memory) {
        SenderConfig memory cfg = $.senderConfig[sender];
        if (cfg.maxPayloadSize == 0) {
            cfg.maxPayloadSize = $.defaultMaxPayloadSize;
        }
        return cfg;
    }
}
