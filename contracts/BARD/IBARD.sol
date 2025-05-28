// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBARD {
    event Mint(address indexed to, uint256 amount);

    error ZeroAddressException();

    error MintWaitPeriodNotClosed();

    error MaxInflationExceeded();

    error CantRenounceOwnership();
}