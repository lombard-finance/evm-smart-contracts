// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @custom:security-contact security@lombard.finance
interface IAssetOperation {
    error AssetOperation_DepositNotAllowed();
    error NotStakingToken();
    error AssetOperation_RedeemNotAllowed();
}
