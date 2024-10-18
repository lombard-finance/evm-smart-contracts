// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library FeeUtils {
    uint256 constant MAX_COMMISSION = 10000; // 100%

    error AmountTooSmallToPayRelativeFee();
    error BadCommission();

    function calcRelativeFee(
        uint256 amount,
        uint16 relativeComs
    ) internal pure returns (uint256) {
        return
            Math.mulDiv(
                amount,
                relativeComs,
                MAX_COMMISSION,
                Math.Rounding.Ceil
            );
    }

    function getRelativeFee(
        uint256 amount,
        uint16 relativeComs
    ) internal pure returns (uint256) {
        if (amount < relativeComs) revert AmountTooSmallToPayRelativeFee();
        return calcRelativeFee(amount, relativeComs);
    }

    function validateCommission(uint16 commission) internal pure {
        if (commission >= MAX_COMMISSION) revert BadCommission();
    }
}
