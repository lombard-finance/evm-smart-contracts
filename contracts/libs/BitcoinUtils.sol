// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

enum OutputType {
    UNSUPPORTED,
    P2TR,
    P2WPKH
}

bytes1 constant OP_0 = 0x00;
bytes1 constant OP_1 = 0x51;
bytes1 constant OP_DATA_32 = 0x20;
bytes1 constant OP_DATA_20 = 0x14;

library BitcoinUtils {
    
    function getOutputType(bytes calldata scriptPubkey) internal pure returns (OutputType) {
        if (scriptPubkey.length == 22 && scriptPubkey[0] == OP_0 && scriptPubkey[1] == OP_DATA_20) {
            return OutputType.P2WPKH;
        }

        if (scriptPubkey.length == 34 && scriptPubkey[0] == OP_1 && scriptPubkey[1] == OP_DATA_32) {
            return OutputType.P2TR;
        }

        return OutputType.UNSUPPORTED;
    }
}



