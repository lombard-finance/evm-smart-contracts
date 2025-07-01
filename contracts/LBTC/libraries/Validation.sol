// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../../libs/BitcoinUtils.sol";

/// @dev collection of validations used in ERC20 contracts
library Validation {
    error AmountLessThanCommission(uint256 fee);
    error AmountBelowDustLimit(uint256 dustLimit);
    error ScriptPubkeyUnsupported();

    function redeemFee(
        bytes calldata scriptPubkey,
        uint256 dustFeeRate,
        uint256 amount,
        uint64 fee
    ) internal pure returns (uint256) {
        (
            uint256 amountAfterFee,
            bool isAboveFee,
            uint256 dustLimit,
            bool isAboveDust
        ) = calcFeeAndDustLimit(scriptPubkey, dustFeeRate, amount, fee);
        if (!isAboveFee) {
            revert AmountLessThanCommission(fee);
        }
        if (!isAboveDust) {
            revert AmountBelowDustLimit(dustLimit);
        }

        return amountAfterFee;
    }

    function calcFeeAndDustLimit(
        bytes calldata scriptPubkey,
        uint256 dustFeeRate,
        uint256 amount,
        uint64 fee
    ) internal pure returns (uint256, bool, uint256, bool) {
        BitcoinUtils.OutputType outType = BitcoinUtils.getOutputType(
            scriptPubkey
        );
        if (outType == BitcoinUtils.OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        if (amount <= fee) {
            return (0, false, 0, false);
        }

        uint256 amountAfterFee = amount - fee;
        uint256 dustLimit = BitcoinUtils.getDustLimitForOutput(
            outType,
            scriptPubkey,
            dustFeeRate
        );

        bool isAboveDust = amountAfterFee > dustLimit;
        return (amountAfterFee, true, dustLimit, isAboveDust);
    }
}
