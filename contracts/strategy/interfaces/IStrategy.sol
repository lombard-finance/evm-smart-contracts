// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IStrategy
/// @notice Core strategy surface: NAV (`pricePerShare`), shard registry, funding, and independent deposit/redeem pause semantics.
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

    /// @notice Assets delivered out of the strategy on redemption settlement (async fulfillment).
    /// @param sender Account that fulfilled the redemption (e.g. operator with `PAY_REDEMPTIONS_ROLE`).
    /// @param receiver Recipient of underlying assets (request owner).
    event Redeem(
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

    /// @notice Deposit entrypoints (`deposit` / `mint` / previews gated by pause) are paused.
    event DepositPaused(address indexed account);

    /// @notice Deposit paths are active again.
    event DepositUnpaused(address indexed account);

    /// @notice Redeem request entrypoints are paused.
    event RedeemPaused(address indexed account);

    /// @notice Redeem paths are active again.
    event RedeemUnpaused(address indexed account);

    /// @notice Protocol fee treasury updated (`setFeeTreasury`).
    event FeeTreasurySet(address indexed treasury);

    /// @notice Blocklist / sanctions oracle used by deposit and redeem checks (`initialize` / `setBlocklistOracle`).
    event BlocklistOracleSet(address indexed oracle);

    /// @dev Deposit operation invoked while deposit pause is active.
    error Strategy_EnforcedDepositPause();

    /// @dev Redeem operation invoked while redeem pause is active.
    error Strategy_EnforcedRedeemPause();

    /// @dev Unpause deposit called while deposits were not paused.
    error Strategy_ExpectedDepositPause();

    /// @dev Unpause redeem called while redeems were not paused.
    error Strategy_ExpectedRedeemPause();

    /// @dev Unpause-all called while neither deposit nor redeem pause was active.
    error Strategy_ExpectedStrategyPause();

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

    /// @notice Optional shard that receives deposited tokens.
    event DefaultShardSet(address indexed shard, address indexed caller);

    /// @notice Implementation-defined semantic version string for tooling and upgrades.
    /// @return Semver or build identifier (contract-specific).
    function version() external view returns (string memory);

    /// @notice Transfer `amount` of `token` from the strategy to the calling shard.
    /// @dev Callable only by registered shards; typically wrapped by shard `pullFromStrategy`.
    /// @param token ERC-20 to transfer (must not be the strategy share token itself).
    /// @param amount Amount in token native decimals.
    function requestFunding(IERC20 token, uint256 amount) external;
}
