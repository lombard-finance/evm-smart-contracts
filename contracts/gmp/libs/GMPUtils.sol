// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LChainId} from "../../libs/LChainId.sol";

library GMPUtils {
    // bytes4(keccak256("MessageV1(bytes32,uint256,bytes32,bytes32,bytes32,bytes)"))
    bytes4 public constant GMP_V1_SELECTOR = 0xe288fb4a;
    uint256 internal constant MIN_GMP_LENGTH = 32 * 6;

    error GMP_ZeroChainId();
    error GMP_ZeroSender();
    error GMP_ZeroRecipient();
    error GMP_WrongPayloadLength();

    struct Payload {
        bytes32 id;
        bytes32 msgPath;
        uint256 msgNonce;
        bytes32 msgSender;
        address msgRecipient; // it's okay to use address instead bytes32, because delivered to EVM
        address msgDestinationCaller;
        bytes msgBody;
    }

    function encodePayload(
        bytes32 msgPath,
        uint256 msgNonce,
        bytes32 msgSender,
        bytes32 msgRecipient,
        bytes32 msgDestinationCaller,
        bytes memory msgBody
    ) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                GMP_V1_SELECTOR,
                msgPath,
                msgNonce,
                msgSender,
                msgRecipient,
                msgDestinationCaller,
                msgBody
            );
    }

    function decodePayload(
        bytes calldata rawPayload
    ) internal pure returns (Payload memory payload) {
        validatePayload(rawPayload);

        (
            payload.msgPath,
            payload.msgNonce,
            payload.msgSender,
            payload.msgRecipient,
            payload.msgDestinationCaller,
            payload.msgBody
        ) = abi.decode(
            rawPayload[4:],
            (bytes32, uint256, bytes32, address, address, bytes)
        );

        // no need to verify msg path, because mailbox verifies it to be enabled
        if (payload.msgSender == bytes32(0)) {
            revert GMP_ZeroSender();
        }
        if (payload.msgRecipient == address(0)) {
            revert GMP_ZeroRecipient();
        }

        payload.id = hash(rawPayload);

        return payload;
    }

    // @notice Returns message's selector
    function selector(bytes memory payload) internal pure returns (bytes4) {
        return bytes4(payload);
    }

    function hash(bytes memory rawPayload) internal pure returns (bytes32) {
        return sha256(rawPayload);
    }

    /**
     * @notice converts address to bytes32 (alignment preserving cast.)
     * @param addr the address to convert to bytes32
     */
    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /**
     * @notice converts bytes32 to address (alignment preserving cast.)
     * @dev Warning: it is possible to have different input values _buf map to the same address.
     * For use cases where this is not acceptable, validate that the first 12 bytes of _buf are zero-padding.
     * @param _buf the bytes32 to convert to address
     */
    function bytes32ToAddress(bytes32 _buf) internal pure returns (address) {
        return address(uint160(uint256(_buf)));
    }

    function validatePayload(bytes calldata rawPayload) internal pure {
        if (rawPayload.length < MIN_GMP_LENGTH) {
            revert GMP_WrongPayloadLength();
        }
    }
}
