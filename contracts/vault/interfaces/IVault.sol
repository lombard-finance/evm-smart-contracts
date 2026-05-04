// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IVault
/// @notice Core vault surface: NAV (`pricePerShare`), strategy registry, funding, and vault-wide pause semantics.
/// @dev Underlying ERC-20 matches ERC-4626-style `asset()`. Price-per-share rate-limit **errors and events** live on `PriceRateLimiter` only (not re-declared here).
interface IVault {
    /// @notice Posted vault exchange rate and NAV snapshot after an operator update.
    /// @param pricePerShare Asset wei per `10 ** decimals()` share unit.
    /// @param nav Posted `totalAssets()` (may differ from on-chain token balances).
    /// @param postedAt Block timestamp of the update.
    event PricePerShareUpdated(
        uint256 pricePerShare,
        uint256 nav,
        uint64 postedAt
    );

    /// @notice Assets delivered out of the vault on redemption settlement (async flow uses this instead of ERC-4626 `withdraw`).
    /// @dev Mirrors EIP-4626 `Withdraw` roles where applicable: `sender` fulfills/initiates settlement; `receiver` receives underlying assets. No separate share `owner` field.
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );

    /// @notice A registered strategy requested vault liquidity.
    event FundingRequested(
        address indexed strategy,
        address indexed token,
        uint256 amount
    );

    /// @dev Address argument was `address(0)` where forbidden.
    error Vault_ZeroAddress();

    /// @dev `postPricePerShare` was called with `newPricePerShare == 0`.
    error Vault_ZeroPricePerShare();

    /// @notice Vault operations entrypoints are paused (`whenVaultNotPaused` reverts).
    event VaultOperationsPaused(address indexed account);

    /// @notice Vault operations entrypoints are active again.
    event VaultOperationsUnpaused(address indexed account);

    /// @notice Protocol fee treasury updated (`setFeeTreasury`).
    event FeeTreasurySet(address indexed treasury);

    /// @dev Caller expected vault to be paused for this action (e.g. internal unpause guard).
    error Vault_EnforcedVaultOperationsPause();

    /// @dev Caller expected vault to be unpaused for this action.
    error Vault_ExpectedVaultOperationsPause();

    /// @dev `strategy` is not in the registered strategy set.
    error Vault_StrategyNotRegistered();

    /// @dev `strategy` was already registered.
    error Vault_StrategyAlreadyRegistered();

    /// @dev Share token transfers to/from the vault share contract itself are forbidden.
    error Vault_ShareTransferNotAllowed();

    /// @dev Funding or similar operation used `amount == 0`.
    error Vault_ZeroAmount();

    /// @notice A strategy contract was registered for funding and reporting.
    event StrategyRegistered(address indexed strategy, address indexed caller);

    /// @notice A strategy contract was removed from the registry.
    event StrategyDeregistered(
        address indexed strategy,
        address indexed caller
    );

    /// @notice Implementation-defined semantic version string for tooling and upgrades.
    /// @return Semver or build identifier (contract-specific).
    function version() external view returns (string memory);

    /// @notice Transfer `amount` of `token` from the vault to the calling strategy.
    /// @dev Callable only by registered strategies; typically wrapped by strategy `pullFromVault`.
    /// @param token ERC-20 to transfer (must not be the vault share token itself).
    /// @param amount Amount in token native decimals.
    function requestFunding(IERC20 token, uint256 amount) external;
}
