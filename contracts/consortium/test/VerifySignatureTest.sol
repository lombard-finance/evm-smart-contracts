// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract VerifySignatureTest {
    using ECDSA for bytes32;

    function verifySignature(address signer, bytes32 messageHash, bytes memory signature) public pure returns (bool) {
        return messageHash.recover(signature) == signer;
    }

    function recoverSigner(bytes32 messageHash, bytes memory signature) public pure returns (address) {
        return messageHash.recover(signature);
    }

    function verifySignatureWithGas(address signer, bytes32 messageHash, bytes memory signature) public view returns (bool, uint256) {
        uint256 gasBefore = gasleft();
        bool isValid = messageHash.recover(signature) == signer;
        uint256 gasAfter = gasleft();
        uint256 gasUsed = gasBefore - gasAfter;
        return (isValid, gasUsed);
    }
}