// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

enum OutputType {
    UNSUPPORTED,
    P2TR,
    P2WPKH,
    P2WSH
}

bytes1 constant OP_0 = 0x00;
bytes1 constant OP_1 = 0x51;
bytes1 constant OP_DATA_32 = 0x20;
bytes1 constant OP_DATA_20 = 0x14;

uint256 constant BASE_SPEND_COST = 49; // 32 (txid) + 4 (vout) + 1 (scriptSig size) + 4 (nSequence) + 8 (amount)

// Size of inputs spending different output types
uint256 constant NON_WITNESS_INPUT_SIZE = 107; // Used for non-witness outputs (P2PKH, P2SH)
uint256 constant WITNESS_INPUT_SIZE = 26; // floor(107 / 4), used for witness outputs (P2WPKH, P2WSH, P2TR)

library BitcoinUtils {
    uint256 public constant DEFAULT_DUST_FEE_RATE = 3000; // Default value - 3 satoshis per byte

    function getOutputType(
        bytes calldata scriptPubkey
    ) internal pure returns (OutputType) {
        if (
            scriptPubkey.length == 22 &&
            scriptPubkey[0] == OP_0 &&
            scriptPubkey[1] == OP_DATA_20
        ) {
            return OutputType.P2WPKH;
        }

        if (
            scriptPubkey.length == 34 &&
            scriptPubkey[0] == OP_1 &&
            scriptPubkey[1] == OP_DATA_32
        ) {
            return OutputType.P2TR;
        }

        if (
            scriptPubkey.length == 34 &&
            scriptPubkey[0] == OP_0 &&
            scriptPubkey[1] == OP_DATA_32
        ) {
            return OutputType.P2WSH;
        }

        return OutputType.UNSUPPORTED;
    }

    /// @notice Compute the dust limit for a given Bitcoin script public key
    /// @dev The dust limit is the minimum payment to an address that is considered
    ///      spendable under consensus rules. This function is based on Bitcoin Core's
    ///      implementation.
    /// @param scriptPubkey The Bitcoin script public key as a byte array
    /// @param dustFeeRate The current dust fee rate (in satoshis per 1000 bytes)
    /// @return dustLimit The calculated dust limit in satoshis
    /// @custom:reference https://github.com/bitcoin/bitcoin/blob/43740f4971f45cd5499470b6a085b3ecd8b96d28/src/policy/policy.cpp#L54
    function getDustLimitForOutput(
        OutputType outType,
        bytes calldata scriptPubkey,
        uint256 dustFeeRate
    ) internal pure returns (uint256 dustLimit) {
        uint256 spendCost = BASE_SPEND_COST;

        if (
            outType == OutputType.P2TR ||
            outType == OutputType.P2WPKH ||
            outType == OutputType.P2WSH
        ) {
            // witness v0 and v1 has a cheaper payment formula
            spendCost += WITNESS_INPUT_SIZE;
            // The current addition creates a discrepancy of 1, and our final value should be 98 bytes.
            // Thus, we add 1 here.
            spendCost += 1;
        } else {
            spendCost += NON_WITNESS_INPUT_SIZE;
        }

        spendCost += scriptPubkey.length;

        // Calculate dust limit
        dustLimit = Math.ceilDiv(spendCost * dustFeeRate, 1000);
    }
}
