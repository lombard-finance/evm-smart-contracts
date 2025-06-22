// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GMPUtils} from "../../gmp/libs/GMPUtils.sol";

library Assets {
    /// @dev Error thrown when payload length is too big
    error Assets_InvalidPayloadSize(uint256 expected, uint256 actual);

    error Assets_ZeroRequestHash();
    error Assets_ChainIdMismatch(bytes32 expected, bytes32 actual);
    error Assets_ZeroAmount();
    error Assets_ZeroRecipient();
    error Assets_InvalidRecipient();
    error Assets_ZeroFromToken();
    error Assets_ZeroToToken();
    error Assets_InvalidToToken();
    error Assets_InvalidSelector(bytes4 expected, bytes4 actual);

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

    // bytes4(keccak256("deposit(bytes32,bytes32,bytes32,uint256)"))
    bytes4 internal constant DEPOSIT_REQUEST_SELECTOR = 0xa129d186;

    // bytes4(keccak256("redeem(bytes32,bytes32,bytes,uint256)"))
    bytes4 internal constant UNSTAKE_REQUEST_SELECTOR = 0x3fbb67f6;

    // bytes4(keccak256("mint(bytes32,bytes32,uint256)"))
    bytes4 internal constant MINT_SELECTOR = 0x155b6b13;

    /// @dev A constant representing the number of bytes for a slot of information in a payload.
    uint256 internal constant ABI_SLOT_SIZE = 32;

    bytes32 public constant BTC_STAKING_MODULE_ADDRESS =
        bytes32(uint256(0x0089e3e4e7a699d6f131d893aeef7ee143706ac23a));
    bytes32 public constant ASSETS_MODULE_ADDRESS =
        bytes32(uint256(0x008bf729ffe074caee622c02928173467e658e19e2));
    bytes32 public constant LEDGER_CALLER = bytes32(uint256(0x0));
    bytes32 public constant BITCOIN_NATIVE_COIN =
        bytes32(uint256(0x00000000000000000000000000000000000001));

    function encodeRequest(
        uint256 nonce,
        bytes memory recipient,
        uint256 amount,
        address fromToken,
        bytes32 toToken,
        bytes32 toChain
    ) internal view returns (bytes memory) {
        if (amount == 0) {
            revert Assets_ZeroAmount();
        }
        if (recipient.length == 0) {
            revert Assets_ZeroRecipient();
        }
        bool recepientValid = false;
        for (uint256 i = 0; i < recipient.length; ++i) {
            if (recipient[i] != 0x0) {
                recepientValid = true;
                break;
            }
        }
        if (!recepientValid) {
            revert Assets_ZeroRecipient();
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
            revert Assets_ZeroAmount();
        }
        if (recipient == bytes32(0)) {
            revert Assets_ZeroRecipient();
        }
        return
            abi.encodeWithSelector(
                DEPOSIT_REQUEST_SELECTOR,
                toChain,
                toToken,
                recipient,
                amount
            );
    }

    function encodeUnstakeRequest(
        bytes32 toChain,
        bytes32 fromToken,
        bytes memory recipient,
        uint256 amount
    ) internal pure returns (bytes memory) {
        if (amount == 0) {
            revert Assets_ZeroAmount();
        }
        if (recipient.length == 0) {
            revert Assets_ZeroRecipient();
        }
        bool recepientValid = false;
        for (uint256 i = 0; i < recipient.length; ++i) {
            if (recipient[i] != 0x0) {
                recepientValid = true;
                break;
            }
        }
        if (!recepientValid) {
            revert Assets_ZeroRecipient();
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
            revert Assets_InvalidPayloadSize(
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
            revert Assets_ZeroRequestHash();
        }
        // TODO: use lChainId lib
        if (chainId != bytes32(block.chainid)) {
            revert Assets_ChainIdMismatch(bytes32(block.chainid), chainId);
        }
        if (amount == 0) {
            revert Assets_ZeroAmount();
        }
        if (fromToken == bytes32(0)) {
            revert Assets_ZeroFromToken();
        }

        address recipient = GMPUtils.bytes32ToAddress(rawRecipient);
        if (recipient == address(0)) {
            revert Assets_ZeroRecipient();
        }

        address toToken = GMPUtils.bytes32ToAddress(rawToToken);
        if (toToken == address(0)) {
            revert Assets_ZeroToToken();
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
            revert Assets_InvalidPayloadSize(
                ABI_SLOT_SIZE * 3 + 4,
                rawPayload.length
            );
        }
        bytes4 selector;
        bytes32 rawToToken;
        bytes32 rawRecipient;
        uint256 amount;
        assembly {
            selector := mload(add(rawPayload, 0x20)) // first 4 bytes
            rawToToken := mload(add(rawPayload, 0x24)) // bytes 4..36
            rawRecipient := mload(add(rawPayload, 0x44)) // bytes 37..68
            amount := mload(add(rawPayload, 0x64)) // bytes 69..100
        }

        if (selector != MINT_SELECTOR) {
            revert Assets_InvalidSelector(MINT_SELECTOR, selector);
        }

        if (amount == 0) {
            revert Assets_ZeroAmount();
        }

        address recipient = GMPUtils.bytes32ToAddress(rawRecipient);
        if (recipient == address(0)) {
            revert Assets_ZeroRecipient();
        }

        address toToken = GMPUtils.bytes32ToAddress(rawToToken);
        if (toToken == address(0)) {
            revert Assets_ZeroToToken();
        }

        return (Release(toToken, recipient, amount), sha256(rawPayload));
    }
}
