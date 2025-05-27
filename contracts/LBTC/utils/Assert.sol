// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev collection of assertions used in ERC20 contracts
library Assert {
    error InvalidDustFeeRate();
    error InvalidInputLength(uint256 a, uint256 b);
    error InvalidAction(bytes4 expected, bytes4 actual);

    error ZeroAddress();

    function zeroAddress(address addr) internal pure {
        if (addr == address(0)) revert ZeroAddress();
    }

    function dustFeeRate(uint256 rate) internal pure {
        if (rate == 0) revert InvalidDustFeeRate();
    }

    function inputLength(uint256 lengthA, uint256 lengthB) internal pure {
        if (lengthA != lengthB) revert InvalidInputLength(lengthA, lengthB);
    }

    function selector(
        bytes calldata payload,
        bytes4 expectedAction
    ) internal pure {
        if (bytes4(payload) != expectedAction)
            revert InvalidAction(expectedAction, bytes4(payload));
    }
}
