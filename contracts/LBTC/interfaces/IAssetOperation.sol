// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAssetOperation {
    error AssetOperation_DepositNotAllowed();
    error NotStakingToken();
    error AssetOperation_RedeemNotAllowed();
}
