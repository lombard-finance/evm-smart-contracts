// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Swap {
    /// @dev Error thrown when payload length is too big
    error Swap_InvalidPayloadSize(uint256 expected, uint256 actual);

    error Swap_ZeroRequestHash();
    error Swap_ChainIdMismatch(bytes32 expected, bytes32 actual);
    error Swap_ZeroAmount();
    error Swap_ZeroRecipient();
    error Swap_InvalidRecipient();
    error Swap_ZeroFromToken();
    error Swap_ZeroToToken();
    error Swap_InvalidToToken();
    error Swap_InvalidSelector(bytes4 expected, bytes4 actual);

    struct Receipt {
        address recipient;
        uint256 amount;
        bytes32 fromToken;
        address toToken;
        bytes32 lChainId;
    }

    // bytes4(keccak256("payload(uint256,bytes32,uint256,bytes32,bytes32,bytes32,bytes32)")
    bytes4 internal constant REQUEST_SELECTOR = 0x45f952fa;

    // bytes4(keccak256("payload(bytes32,bytes32,uint256,bytes32,bytes32,bytes32)")
    bytes4 internal constant RECEIPT_SELECTOR = 0x965597b5;

    /// @dev A constant representing the number of bytes for a slot of information in a payload.
    uint256 internal constant ABI_SLOT_SIZE = 32;

    function encodeRequest(
        uint256 nonce,
        bytes32 recipient,
        uint256 amount,
        address fromToken,
        bytes32 toToken,
        bytes32 toChain
    ) internal view returns (bytes memory) {
        return
            abi.encodeWithSelector(
                REQUEST_SELECTOR,
                nonce,
                recipient,
                amount,
                fromToken,
                toToken,
                bytes32(block.chainid), // TODO: use Lombard Chain Id library later
                toChain
            );
    }

    function decodeReceipt(
        bytes calldata rawPayload
    ) internal view returns (Receipt memory, bytes32) {
        if (rawPayload.length != ABI_SLOT_SIZE * 6 + 4)
            revert Swap_InvalidPayloadSize(
                ABI_SLOT_SIZE * 6,
                rawPayload.length
            );

        if (bytes4(rawPayload[:4]) != RECEIPT_SELECTOR) {
            revert Swap_InvalidSelector(
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
            revert Swap_ZeroRequestHash();
        }
        // TODO: use lChainId lib
        if (chainId != bytes32(block.chainid)) {
            revert Swap_ChainIdMismatch(bytes32(block.chainid), chainId);
        }
        if (amount == 0) {
            revert Swap_ZeroAmount();
        }
        if (fromToken == bytes32(0)) {
            revert Swap_ZeroFromToken();
        }

        // Extra check if the top 12 bytes are non-zero
        if (uint256(rawRecipient) >> 160 != 0) {
            revert Swap_InvalidRecipient();
        }
        address recipient = address(uint160(uint256(rawRecipient)));
        if (recipient == address(0)) {
            revert Swap_ZeroRecipient();
        }

        // Extra check if the top 12 bytes are non-zero
        if (uint256(rawToToken) >> 160 != 0) {
            revert Swap_InvalidToToken();
        }
        address toToken = address(uint160(uint256(rawToToken)));
        if (toToken == address(0)) {
            revert Swap_ZeroToToken();
        }

        return (
            Receipt(recipient, amount, fromToken, toToken, chainId),
            sha256(rawPayload)
        );
    }
}
