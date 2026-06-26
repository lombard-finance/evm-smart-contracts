// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Library of utilities for making EIP1271-compliant signature checks.
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
library EIP1271SignatureUtils {
    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant EIP1271_MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant EIP1271_WRONGVALUE = 0xffffffff;

    /**
     * @notice Checks @param signature is a valid signature of @param digest from @param signer.
     * If the `signer` contains no code -- i.e. it is not (yet, at least) a contract address, then checks using standard ECDSA logic.
     * If the `signer` contains the code and it is EIP-7702 delegation (23 bytes starting with `0xef0100`), then ECDSA logic is used.
     * Otherwise, passes on the signature to the signer to verify the signature and checks that it returns the `EIP1271_MAGICVALUE`.
     */
    function checkSignature(
        address signer,
        bytes32 digest,
        bytes memory signature
    ) internal view returns (bool) {
        if (!isEoaAccount(signer)) {
            if (
                IERC1271(signer).isValidSignature(digest, signature) !=
                EIP1271_MAGICVALUE
            ) {
                return false;
            }
        } else {
            if (ECDSA.recover(digest, signature) != signer) {
                return false;
            }
        }
        return true;
    }

    function isEoaAccount(address account) internal view returns (bool) {
        if (account.code.length == 0) {
            return true;
        }
        if (
            account.code.length == 23 &&
            account.code[0] == 0xef &&
            account.code[1] == 0x01 &&
            account.code[2] == 0x00
        ) {
            return true;
        }
        return false;
    }
}
