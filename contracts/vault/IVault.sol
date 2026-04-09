// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IVault
/// @notice Vault interface for §B Strategy pipe (`docs/spec/002-strategy.md` §B).
interface IVault {
    /// @notice §B pipe asset; MUST be standard ERC-20 (no fee-on-transfer, no rebasing).
    function token() external view returns (IERC20);

    /// @notice Register `strategy`, track membership, token().approve(strategy, type(uint256).max). Caller auth: implementation-defined.
    function registerStrategy(address strategy) external;

    /// @notice Whether `strategy` is registered with this Vault.
    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool);
}
