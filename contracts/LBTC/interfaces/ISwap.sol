// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISwap {
    error SwapNotAllowed();

    event SwapRequest(
        address indexed from,
        bytes32 indexed to,
        address indexed fromToken,
        uint256 amount,
        bytes rawPayload
    );
    event SwapFinished(
        address indexed recipient,
        address indexed toToken,
        uint256 amount
    );
}
