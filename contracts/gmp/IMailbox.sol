// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMailbox {
    error Mailbox_ZeroChainId();
    error Mailbox_ZeroConsortium();
    error Mailbox_ZeroMailbox();
    error Mailbox_ZeroRecipient();
    error Mailbox_MessagePathEnabled(bytes32 id);
    error Mailbox_MessagePathDisabled(bytes32 id);
    error Mailbox_UnexpectedDestinationCaller(address expected, address actual);
    error Mailbox_HandlerNotImplemented();
    error Mailbox_PayloadOversize(uint64 max, uint64 actual);

    event MessagePathEnabled(
        bytes32 indexed destinationChain,
        bytes32 indexed inboundMessagePath,
        bytes32 indexed outboundMessagePath,
        bytes32 destinationMailbox
    );

    event MessagePathDisabled(
        bytes32 indexed destinationChain,
        bytes32 indexed inboundMessagePath,
        bytes32 indexed outboundMessagePath,
        bytes32 destinationMailbox
    );

    event MessageSent(
        bytes32 indexed destinationLChainId,
        address indexed sender,
        bytes32 indexed recipient,
        bytes payload
    );

    event MessageDelivered(
        bytes32 indexed payloadHash,
        address indexed destinationCaller,
        // TODO: add more indexed events
        bytes payload
    );

    event MessageHandled(
        bytes32 indexed payloadHash,
        address indexed destinationCaller,
        bytes executionResult
    );

    event MessageHandleError(
        bytes32 indexed payloadHash,
        address indexed destinationCaller,
        string reason
    );

    event SenderConfigUpdated(
        address indexed sender,
        uint64 maxPayloadSize
    );

    event DefaultPayloadSizeSet(
        uint64 maxPayloadSize
    );

    function send(
        bytes32 destinationChain,
        bytes32 recipient,
        bytes32 destinationCaller,
        bytes calldata body
    ) external payable returns (uint256, bytes32);

    function getInboundMessagePath(
        bytes32 pathId
    ) external view returns (bytes32);
}
