// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Library of utilities for making EIP1271-compliant signature checks.
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
library EIP1271SignatureUtils {

    error SignatureVerificationFailed();
    error BadSignature();

    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant EIP1271_MAGICVALUE = 0x1626ba7e;

    /**
     * @notice Checks @param signature is a valid signature of @param digestHash from @param signer.
     * If the `signer` contains no code -- i.e. it is not (yet, at least) a contract address, then checks using standard ECDSA logic
     * Otherwise, passes on the signature to the signer to verify the signature and checks that it returns the `EIP1271_MAGICVALUE`.
     */
    function checkSignature(address signer, bytes32 digestHash, bytes memory signature) internal view {

        if (isContract(signer)) {
            if (IERC1271(signer).isValidSignature(digestHash, signature) != EIP1271_MAGICVALUE) {
                revert SignatureVerificationFailed();
            }
        } else {
            if (ECDSA.recover(digestHash, signature) != signer) {
                revert BadSignature();
            }
        }
    }

    function isContract(address addr) internal view returns (bool) {
        return addr.code.length != 0;
    }
}