// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Staking {
    /// @dev Error thrown when payload length is too big
    error Staking_InvalidPayloadSize(uint256 expected, uint256 actual);

    error Staking_ZeroRequestHash();
    error Staking_ChainIdMismatch(bytes32 expected, bytes32 actual);
    error Staking_ZeroAmount();
    error Staking_ZeroRecipient();
    error Staking_InvalidRecipient();
    error Staking_ZeroFromToken();
    error Staking_ZeroToToken();
    error Staking_InvalidToToken();
    error Staking_InvalidSelector(bytes4 expected, bytes4 actual);

    struct Receipt {
        address recipient;
        uint256 amount;
        bytes32 fromToken;
        address toToken;
        bytes32 lChainId;
    }

    // bytes4(keccak256("payload(uint256,uint256,bytes32,bytes32,bytes32,bytes32,bytes)")
    bytes4 internal constant REQUEST_SELECTOR = 0xedff11ea;

    // bytes4(keccak256("payload(bytes32,bytes32,uint256,bytes32,bytes32,bytes32)")
    bytes4 internal constant RECEIPT_SELECTOR = 0x965597b5;

    /// @dev A constant representing the number of bytes for a slot of information in a payload.
    uint256 internal constant ABI_SLOT_SIZE = 32;

    function encodeRequest(
        uint256 nonce,
        bytes memory recipient,
        uint256 amount,
        address fromToken,
        bytes32 toToken,
        bytes32 toChain
    ) internal view returns (bytes memory) {
        if (amount == 0) {
            revert Staking_ZeroAmount();
        }
        if (recipient.length == 0) {
            revert Staking_ZeroRecipient();
        }
        bool recepientValid = false;
        for (uint256 i=0; i < recipient.length; ++i) {
            if (recipient[i] != 0x0) {
                recepientValid = true;
                break;
            }
        }
        if (!recepientValid) {
            revert Staking_ZeroRecipient();
        }
        return
            abi.encodeWithSelector(
                REQUEST_SELECTOR,
                nonce,
                amount,
                bytes32(uint256(uint160(fromToken))),
                toToken,
                bytes32(block.chainid), // TODO: use Lombard Chain Id library later
                toChain,
                recipient
            );
    }

    function decodeReceipt(
        bytes calldata rawPayload
    ) internal view returns (Receipt memory, bytes32) {
        if (rawPayload.length != ABI_SLOT_SIZE * 6 + 4)
            revert Staking_InvalidPayloadSize(
                ABI_SLOT_SIZE * 6 + 4,
                rawPayload.length
            );

        if (bytes4(rawPayload[:4]) != RECEIPT_SELECTOR) {
            revert Staking_InvalidSelector(
                RECEIPT_SELECTOR,
                bytes4(rawPayload[:4])
            );
        }

        (
            bytes32 requestHash,
            bytes32 rawRecipient,
            uint256 amount,
            bytes32 fromToken,
            bytes32 rawToToken,
            bytes32 chainId
        ) = abi.decode(
                rawPayload[4:],
                (bytes32, bytes32, uint256, bytes32, bytes32, bytes32)
            );

        if (requestHash == bytes32(0)) {
            revert Staking_ZeroRequestHash();
        }
        // TODO: use lChainId lib
        if (chainId != bytes32(block.chainid)) {
            revert Staking_ChainIdMismatch(bytes32(block.chainid), chainId);
        }
        if (amount == 0) {
            revert Staking_ZeroAmount();
        }
        if (fromToken == bytes32(0)) {
            revert Staking_ZeroFromToken();
        }

        // Extra check if the top 12 bytes are non-zero
        if (uint256(rawRecipient) >> 160 != 0) {
            revert Staking_InvalidRecipient();
        }
        address recipient = address(uint160(uint256(rawRecipient)));
        if (recipient == address(0)) {
            revert Staking_ZeroRecipient();
        }

        // Extra check if the top 12 bytes are non-zero
        if (uint256(rawToToken) >> 160 != 0) {
            revert Staking_InvalidToToken();
        }
        address toToken = address(uint160(uint256(rawToToken)));
        if (toToken == address(0)) {
            revert Staking_ZeroToToken();
        }

        return (
            Receipt(recipient, amount, fromToken, toToken, chainId),
            sha256(rawPayload)
        );
    }
}
