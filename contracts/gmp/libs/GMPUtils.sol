// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LChainId} from "../../libs/LChainId.sol";

library GMPUtils {
    // bytes4(keccak256("MessageV1(bytes32,uint256,bytes32,bytes32,bytes32,bytes)"))
    bytes4 public constant GMP_V1_SELECTOR = 0xe288fb4a;
    uint256 internal constant MIN_GMP_LENGTH = 32 * 6 + 4; // This length includes selector

    error GMP_ZeroChainId();
    error GMP_ZeroSender();
    error GMP_ZeroRecipient();
    error GMP_WrongPayloadLength();
    error GMP_InvalidAddess();
    error GMP_InvalidAction(bytes4 expectedVal, bytes4 actualVal);

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

    function decodeAndValidatePayload(
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
     * @dev This function explicitly checks if the first 12 bytes are zeros to ensure 1 to 1 mapping
     * @param _buf the bytes32 to convert to address
     */
    function bytes32ToAddress(bytes32 _buf) internal pure returns (address) {
        if (uint256(_buf) >> 160 != 0) {
            revert GMP_InvalidAddess();
        }
        return address(uint160(uint256(_buf)));
    }

    function validatePayload(bytes calldata rawPayload) internal pure {
        if (bytes4(rawPayload) != GMP_V1_SELECTOR) {
            revert GMP_InvalidAction(GMP_V1_SELECTOR, bytes4(rawPayload));
        }
        if (rawPayload.length < MIN_GMP_LENGTH) {
            revert GMP_WrongPayloadLength();
        }
    }

    /// @dev Validate if address length match chain ecosystem:
    /// * EVM      | 00 | 20 bytes
    /// * SUI      | 01 | 32 bytes
    /// * SOLANA   | 02 | 32 bytes
    /// * COSMOS   | 03 | 20 bytes (32 is CW contract which we don't want to support rn)
    /// * STARKNET | 04 | 32 bytes
    /// @param lChainId Lombard Multi Chain Id
    /// @param addr The address to validate
    /// @return valid True if valid
    function validateAddressLength(
        bytes32 lChainId,
        bytes32 addr
    ) internal pure returns (bool) {
        uint8 ecosystem = uint8(uint256(lChainId) >> 248);
        return
            (ecosystem == 0 && uint256(addr) >> 160 == 0) ||
            (ecosystem == 3 && uint256(addr) >> 160 == 0) ||
            (ecosystem == 1 || ecosystem == 2 || ecosystem == 4);
    }
}
