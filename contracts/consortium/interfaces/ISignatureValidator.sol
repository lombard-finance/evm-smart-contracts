// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Safe interface
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/interfaces/ISignatureValidator.sol
interface ISignatureValidator {
    /**
     * @dev Should return whether the signature provided is valid for the provided data
     * @param data Arbitrary length data signed on the behalf of address(this)
     * @param signature Signature byte array associated with data
     *
     * MUST return the bytes4 magic value 0x1626ba7e when function passes.
     * MUST NOT modify state (using STATICCALL for solc < 0.5, view modifier for solc > 0.5)
     * MUST allow external calls
     */
    function isValidSignature(
        bytes memory data,
        bytes memory signature
    ) external view returns (bytes4 magicValue);
}