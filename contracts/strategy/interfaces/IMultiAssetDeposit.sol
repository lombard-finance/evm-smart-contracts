// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IMultiAssetDeposit
/// @notice ERC-165 extension: deposit or mint strategy shares against **multiple** listed ERC-20 assets via per-token `IAssetConverter` pricing.
/// @dev Adds `depositAsset` and optional slippage guards (`minSharesOut`, `maxAssetsIn`). Deposit fees transfer immediately to the strategy fee treasury (`feeTreasury` / `setFeeTreasury` on the concrete strategy).
interface IMultiAssetDeposit is IERC165 {
    /// @notice An admin listed `token` as an accepted deposit asset.
    event DepositAssetAdded(address indexed sender, address indexed token);

    /// @notice Shares minted after depositing `depositAsset`.
    /// @dev Same roles as EIP-4626 `Deposit`: `sender` initiated the tx; `owner` receives minted shares.
    /// @param assets Net `depositAsset` amount that backed the share mint (gross transferred from `sender` minus `feeAssets`).
    /// @param shares Strategy shares minted to `owner`.
    /// @param feeAssets Deposit fee in `depositAsset` units routed to {feeTreasury}; gross transferred = `assets + feeAssets`.
    event Deposit(
        address indexed sender,
        address indexed owner,
        address indexed depositAsset,
        uint256 assets,
        uint256 shares,
        uint256 feeAssets
    );

    /// @notice `token` was removed from the deposit allowlist.
    event DepositAssetRemoved(address indexed token);

    /// @notice Deposit fee rate for `token` was updated (basis points on gross deposit).
    event DepositFeeBpsSet(address indexed token, uint16 depositFeeBps);

    /// @notice Pricing adapter for `token` was updated.
    event DepositAssetConverterSet(
        address indexed token,
        address indexed assetConverter
    );

    /// @notice Deposit fee tokens sent to treasury from a deposit.
    event DepositFeeTransferred(
        address indexed token,
        address indexed treasury,
        uint256 amount
    );

    /// @notice Net deposit liquidity routed to the default shard after `Deposit`.
    event DepositRoutedToDefaultShard(
        address indexed shard,
        address indexed depositAsset,
        uint256 amount
    );

    error StrategyDeposit_AssetNotListed(address token);

    /// @param bps The fee basis points that failed validation (must be < 10_000).
    error StrategyDeposit_FeeBpsTooHigh(uint16 bps);

    /// @param depositAsset Deposit token for which a fee was charged while `feeTreasury` was unset.
    error StrategyDeposit_FeeTreasuryNotSet(address depositAsset);

    error StrategyDeposit_ExceededMaxDeposit(
        address receiver,
        address depositAsset,
        uint256 assets,
        uint256 maxAssets
    );

    error StrategyDeposit_ExceededMaxMint(
        address receiver,
        address depositAsset,
        uint256 shares,
        uint256 maxShares
    );

    error StrategyDeposit_AssetAlreadyAdded(address depositAsset);

    error StrategyDeposit_InsufficientSharesOut(
        uint256 sharesOut,
        uint256 minSharesOut
    );

    error StrategyDeposit_ExcessiveAssetsIn(
        uint256 assetsIn,
        uint256 maxAssetsIn
    );

    /// @notice Deposit `assets` of `depositAsset` and mint shares to `receiver`.
    /// @return shares Strategy shares minted.
    function deposit(
        address depositAsset,
        uint256 assets,
        address receiver
    ) external returns (uint256);

    /// @notice Deposit with slippage guard: revert if minted shares fall below `minSharesOut`.
    /// @return shares Strategy shares minted.
    function deposit(
        address depositAsset,
        uint256 assets,
        address receiver,
        uint256 minSharesOut
    ) external returns (uint256);

    /// @notice Mint exactly `shares` to `receiver` by pulling the computed asset amount of `depositAsset`.
    /// @return assets Gross deposit asset amount transferred in (before fee split internally).
    function mint(
        address depositAsset,
        uint256 shares,
        address receiver
    ) external returns (uint256);

    /// @notice Mint with cap: revert if required gross assets exceed `maxAssetsIn`.
    /// @return assets Gross deposit asset amount transferred in.
    function mint(
        address depositAsset,
        uint256 shares,
        address receiver,
        uint256 maxAssetsIn
    ) external returns (uint256);

    /// @notice Converts `depositAsset` units (after fee logic in implementation) to shares at current NAV.
    /// @return shares Expected shares for `assets` deposit amount.
    function previewDeposit(
        address depositAsset,
        uint256 assets
    ) external view returns (uint256);

    /// @notice Assets of `depositAsset` required to mint `shares` at current NAV (implementation-defined fee handling).
    /// @return assets Gross assets required from user.
    function previewMint(
        address depositAsset,
        uint256 shares
    ) external view returns (uint256);

    /// @notice Upper bound on deposit amount for `(depositAsset, receiver)` given pause/listing state.
    /// @return maxAssets `0` when paused or unlisted; otherwise unbounded in the default implementation.
    function maxDeposit(
        address depositAsset,
        address receiver
    ) external view returns (uint256);

    /// @notice Upper bound on mintable shares for `(depositAsset, receiver)` given pause/listing state.
    /// @return maxShares `0` when paused or unlisted; otherwise unbounded in the default implementation.
    function maxMint(
        address depositAsset,
        address receiver
    ) external view returns (uint256);

    /// @notice Converts strategy shares to `depositAsset` units using the token converter (preview path; may exclude deposit fees depending on implementation).
    /// @return assets Amount of `depositAsset` equivalent to `shares`.
    function convertToAssets(
        address depositAsset,
        uint256 shares
    ) external view returns (uint256);

    /// @notice Converts `depositAsset` amount to equivalent shares using the token converter.
    /// @return shares Strategy shares equivalent to `assets`.
    function convertToShares(
        address depositAsset,
        uint256 assets
    ) external view returns (uint256);

    /// @notice Returns the list of all assets that can be accepted by the strategy.
    /// @return addresses The list of assets.
    function getAssets() external view returns (address[] memory);
}
