// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IStaking {
    error StakingNotAllowed();
    error NotStakingToken();

    event StakingOperationRequested(
        address indexed from,
        bytes to,
        address indexed fromToken,
        uint256 amount,
        bytes rawPayload
    );
    event StakingOperationCompleted(
        address indexed recipient,
        address indexed toToken,
        uint256 amount
    );
}
