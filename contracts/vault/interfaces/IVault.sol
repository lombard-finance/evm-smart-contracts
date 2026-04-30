// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    event FundingRequested(
        address indexed strategy,
        address indexed token,
        uint256 amount
    );

    error ZeroAddress();

    /// @dev `postPricePerShare` / `forcePostPricePerShare` with `newPricePerShare == 0`
    error ZeroPricePerShare();

    /// @dev `postPricePerShare` would exceed the rate limit bucket
    error PricePerShareRateLimitExceeded();

    /// @dev `setPricePerShareRateLimit` arguments out of range
    error InvalidPricePerShareRateLimit();

    /// @dev Emitted when the default admin updates the PPS rate limit bucket config
    event PricePerShareRateLimitUpdated(uint32 maxBucketBps, uint64 refillRate);

    event VaultOperationsPaused(address account);

    event VaultOperationsUnpaused(address account);

    error EnforcedVaultOperationsPause();

    error ExpectedVaultOperationsPause();

    error NotRegisteredStrategy();

    error ShareTransferNotAllowed();

    event BeaconHubChanged(address indexed oldHub, address indexed newHub, address indexed caller);

    event StrategyDeployed(address indexed proxy, bytes32 indexed beaconId, address indexed hub, address caller);

    function version() external view returns (string memory);

    /// @notice Transfer `amount` of `token` to the calling strategy. Only callable by a registered strategy.
    function requestFunding(IERC20 token, uint256 amount) external;
}
