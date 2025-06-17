// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBARD {
    error ZeroAddressException();

    error MintWaitPeriodNotClosed(uint256 timeToWait);

    error MaxInflationExceeded(uint256 maxAllowedAmount);

    error CantRenounceOwnership();
}
