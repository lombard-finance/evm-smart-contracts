// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IVault
/// @notice Vault interface for §B Strategy pipe (`docs/spec/002-strategy.md` §B).
/// @dev Underlying token is the same as ERC-4626 `asset()`; implementations MUST keep `asset()` consistent with the pipe.
interface IVault {
    /// @notice §B pipe asset; MUST be standard ERC-20 (no fee-on-transfer, no rebasing). Same identifier as ERC-4626 `asset()`.
    function asset() external view returns (address);

    /// @notice Register `strategy`, track membership, `IERC20(asset()).approve(strategy, type(uint256).max)`. Caller auth: implementation-defined.
    function registerStrategy(address strategy) external;

    /// @notice Whether `strategy` is registered with this Vault.
    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool);
}
