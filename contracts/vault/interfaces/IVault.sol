// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IVault
/// @notice Vault interface for §B Strategy pipe (`docs/spec/002-strategy.md` §B).
/// @dev Underlying token is the same as ERC-4626 `asset()`; implementations MUST keep `asset()` consistent with the pipe.
interface IVault {
    /// @notice Emitted when the poster updates `pricePerShare`
    event PricePerShareUpdated(
        uint256 pricePerShare,
        uint256 nav,
        uint64 postedAt
    );

    error ZeroAddress();

    /// @notice §B pipe asset; MUST be standard ERC-20 (no fee-on-transfer, no rebasing). Same identifier as ERC-4626 `asset()`.
    function asset() external view returns (address);

    function version() external view returns (string memory);
}
