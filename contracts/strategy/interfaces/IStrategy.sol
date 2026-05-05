// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IStrategy
/// @notice Core strategy surface: NAV (`pricePerShare`), shard registry, funding, and strategy-wide pause semantics.
/// @dev Underlying ERC-20 matches ERC-4626-style `asset()`. Price-per-share rate-limit **errors and events** live on `PriceRateLimiter` only (not re-declared here).
interface IStrategy {
    /// @notice Posted strategy exchange rate and NAV snapshot after an operator update.
    /// @param pricePerShare Asset wei per `10 ** decimals()` share unit.
    /// @param nav Posted `totalAssets()` (may differ from on-chain token balances).
    /// @param postedAt Block timestamp of the update.
    event PricePerShareUpdated(
        uint256 pricePerShare,
        uint256 nav,
        uint64 postedAt
    );

    /// @notice Assets delivered out of the strategy on redemption settlement (async flow uses this instead of ERC-4626 `withdraw`).
    /// @dev Mirrors EIP-4626 `Withdraw` roles where applicable: `sender` fulfills/initiates settlement; `receiver` receives underlying assets. No separate share `owner` field.
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );

    /// @notice A registered shard requested strategy liquidity.
    event FundingRequested(
        address indexed shard,
        address indexed token,
        uint256 amount
    );

    /// @dev Address argument was `address(0)` where forbidden.
    error Strategy_ZeroAddress();

    /// @dev `postPricePerShare` was called with `newPricePerShare == 0`.
    error Strategy_ZeroPricePerShare();

    /// @notice Strategy operations entrypoints are paused (`whenStrategyNotPaused` reverts).
    event StrategyOperationsPaused(address indexed account);

    /// @notice Strategy operations entrypoints are active again.
    event StrategyOperationsUnpaused(address indexed account);

    /// @notice Protocol fee treasury updated (`setFeeTreasury`).
    event FeeTreasurySet(address indexed treasury);

    /// @dev Caller expected strategy to be paused for this action (e.g. internal unpause guard).
    error Strategy_EnforcedStrategyOperationsPause();

    /// @dev Caller expected strategy to be unpaused for this action.
    error Strategy_ExpectedStrategyOperationsPause();

    /// @dev `shard` is not in the registered shard set.
    error Strategy_ShardNotRegistered();

    /// @dev `shard` was already registered.
    error Strategy_ShardAlreadyRegistered();

    /// @dev Share token transfers to/from the strategy share contract itself are forbidden.
    error Strategy_ShareTransferNotAllowed();

    /// @dev Funding or similar operation used `amount == 0`.
    error Strategy_ZeroAmount();

    /// @notice A shard contract was registered for funding and reporting.
    event ShardRegistered(address indexed shard, address indexed caller);

    /// @notice A shard contract was removed from the registry.
    event ShardDeregistered(address indexed shard, address indexed caller);

    /// @notice Implementation-defined semantic version string for tooling and upgrades.
    /// @return Semver or build identifier (contract-specific).
    function version() external view returns (string memory);

    /// @notice Transfer `amount` of `token` from the strategy to the calling shard.
    /// @dev Callable only by registered shards; typically wrapped by shard `pullFromStrategy`.
    /// @param token ERC-20 to transfer (must not be the strategy share token itself).
    /// @param amount Amount in token native decimals.
    function requestFunding(IERC20 token, uint256 amount) external;
}
