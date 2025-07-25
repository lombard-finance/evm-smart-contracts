// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../../libs/BitcoinUtils.sol";

/// @dev collection of validations used in ERC20 contracts
library Validation {
    error AmountLessThanCommission(uint256 fee);
    error AmountBelowMinLimit(uint256 dustLimit);
    error ScriptPubkeyUnsupported();

    function redeemFee(
        bytes calldata scriptPubkey,
        uint256 amount,
        uint64 fee,
        uint256 minAmount
    ) internal pure returns (uint256) {
        (
            uint256 amountAfterFee,
            bool isAboveFee,
            bool isAboveMinLimit
        ) = calcFeeAndDustLimit(scriptPubkey, amount, fee, minAmount);
        if (!isAboveFee) {
            revert AmountLessThanCommission(fee);
        }
        if (!isAboveMinLimit) {
            revert AmountBelowMinLimit(minAmount);
        }

        return amountAfterFee;
    }

    function calcFeeAndDustLimit(
        bytes calldata scriptPubkey,
        uint256 amount,
        uint64 fee,
        uint256 minAmount
    ) internal pure returns (uint256, bool, bool) {
        BitcoinUtils.OutputType outType = BitcoinUtils.getOutputType(
            scriptPubkey
        );
        if (outType == BitcoinUtils.OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        if (amount <= fee) {
            return (0, false, false);
        }

        uint256 amountAfterFee = amount - fee;

        bool isAboveMinLimit = amountAfterFee >= minAmount;
        return (amountAfterFee, true, isAboveMinLimit);
    }
}
