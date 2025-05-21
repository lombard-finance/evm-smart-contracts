// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RateLimits} from "../libs/RateLimits.sol";

interface IBridgeV2 {
    error BridgeV2_ZeroAmount();
    error BridgeV2_ZeroRecipient();
    error BridgeV2_ZeroPath();
    error BridgeV2_ZeroBridge();
    error BridgeV2_ZeroChainId();
    error BridgeV2_ZeroSender();
    error BridgeV2_ZeroToken();
    error BridgeV2_ZeroMailbox();
    error BridgeV2_AlreadyAllowed();
    error BridgeV2_TokenNotAllowed();
    error BridgeV2_PathNotAllowed();
    error BridgeV2_MailboxExpected();
    error BridgeV2_BadMsgSender();
    error BridgeV2_SenderNotWhitelisted(address);
    error BridgeV2_VersionMismatch(uint8 expected, uint8 actual);
    error BridgeV2_InvalidMsgBodyLength(uint256 expected, uint256 actual);
    error BridgeV2_PayloadSpent();
    error BridgeV2_NotEnoughFee(uint256 expected, uint256 actual);
    error BridgeV2_TooBigDiscount();

    event DestinationBridgeSet(
        bytes32 indexed destinationChain,
        bytes32 indexed destinationBridge
    );
    event DestinationTokenSet(
        bytes32 indexed destinationChain,
        bytes32 indexed destinationToken,
        address indexed sourceToken
    );
    event RateLimitsSet(
        address indexed token,
        bytes32 indexed sourceChainId,
        uint256 limit,
        uint256 window
    );

    event SenderConfigChanged(
        address indexed sender,
        uint32 feeDiscount,
        bool whitelisted
    );

    /// @notice Emitted when the is a deposit in the bridge
    event DepositToBridge(
        address indexed fromAddress,
        bytes32 indexed toAddress,
        bytes32 indexed payloadHash
    );

    /// @notice Emitted when a withdraw is made from the bridge
    event WithdrawFromBridge(
        address indexed recipient,
        bytes32 indexed chainId,
        address indexed token,
        uint256 amount
    );
}
