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

    event Withdraw(
        address indexed caller,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );

    error ZeroAddress();

    event VaultOperationsPaused(address account);

    event VaultOperationsUnpaused(address account);

    error EnforcedVaultOperationsPause();

    error ExpectedVaultOperationsPause();

    function version() external view returns (string memory);
}
