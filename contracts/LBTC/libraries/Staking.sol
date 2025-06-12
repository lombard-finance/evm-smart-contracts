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

    struct Release {
        address toToken;
        address recipient;
        uint256 amount;
    }

    // bytes4(keccak256("payload(uint256,uint256,bytes32,bytes32,bytes32,bytes32,bytes)")
    bytes4 internal constant REQUEST_SELECTOR = 0xedff11ea;

    // bytes4(keccak256("payload(bytes32,bytes32,uint256,bytes32,bytes32,bytes32)")
    bytes4 internal constant RECEIPT_SELECTOR = 0x965597b5;

    // bytes4(keccak256("Stake(bytes32,bytes32,bytes32,uint256)"))
    bytes4 internal constant STAKE_REQUEST_SELECTOR = 0x54d4a896;

    // bytes4(keccak256("Unstake(bytes32,bytes32,bytes,uint256)"))
    bytes4 internal constant UNSTAKE_REQUEST_SELECTOR = 0x02220bca;

    // bytes4(keccak256("Release(bytes32,bytes32,uint256)"))
    bytes4 internal constant RELEASE_SELECTOR = 0x6d673bfe;

    /// @dev A constant representing the number of bytes for a slot of information in a payload.
    uint256 internal constant ABI_SLOT_SIZE = 32;

    bytes32 public constant LEDGER_LCHAIN_ID = "ToDO";
    bytes32 public constant LEDGER_RECIPIENT = "ToDO";
    bytes32 public constant LEDGER_CALLER = "ToDO";
    bytes32 public constant BITCOIN_LCHAIN_ID = "ToDO";

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

    function encodeStakeRequest(
        bytes32 toChain,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) internal pure returns (bytes memory) {
        if (amount == 0) {
            revert Staking_ZeroAmount();
        }
        if (recipient == bytes32(0)) {
            revert Staking_ZeroRecipient();
        }
        return
            abi.encodeWithSelector(
                STAKE_REQUEST_SELECTOR,
                toChain,
                toToken,
                recipient,
                amount
            );
    }

    function encodeUnstakeRequest(
        bytes32 toChain,
        bytes32 fromToken,
        bytes calldata recipient,
        uint256 amount
    ) internal pure returns (bytes memory) {
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
                UNSTAKE_REQUEST_SELECTOR,
                toChain,
                fromToken,
                recipient,
                amount
            );
    }

    function decodeReceipt(
        bytes memory rawPayload
    ) internal view returns (Receipt memory, bytes32) {
        if (rawPayload.length != ABI_SLOT_SIZE * 6 + 4)
            revert Staking_InvalidPayloadSize(
                ABI_SLOT_SIZE * 6 + 4,
                rawPayload.length
            );
        (
            bytes32 requestHash,
            bytes32 rawRecipient,
            uint256 amount,
            bytes32 fromToken,
            bytes32 rawToToken,
            bytes32 chainId
        ) = abi.decode(
                rawPayload,
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

    function decodeRelease(
        bytes memory rawPayload
    ) internal view returns (Release memory, bytes32) {
        if (rawPayload.length != ABI_SLOT_SIZE * 3 + 4) {
            revert Staking_InvalidPayloadSize(
                ABI_SLOT_SIZE * 3 + 4,
                rawPayload.length
            );
        }
        bytes4 selector;
        bytes32 rawToToken;
        bytes32 rawRecipient;
        uint256 amount;
        assembly {
            selector := mload(add(rawPayload, 0x20)) // first byte
            rawToToken := mload(add(rawPayload, 0x24)) // bytes 1..32
            rawRecipient := mload(add(rawPayload, 0x44)) // bytes 33..64
            amount := mload(add(rawPayload, 0x64)) // bytes 65..96
        }

        if (selector != RELEASE_SELECTOR) {
            revert Staking_InvalidSelector(
                RELEASE_SELECTOR,
                selector
            );
        }

        if (rawToToken == bytes32(0)) {
            revert Staking_ZeroToToken();
        }
        if (amount == 0) {
            revert Staking_ZeroAmount();
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
            Release(toToken, recipient, amount),
            sha256(rawPayload)
        );
    }
}
