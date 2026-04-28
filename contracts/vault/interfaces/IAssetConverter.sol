// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IAssetConverter
/// @notice Per-token adapter: converts between that token’s amounts and the vault’s BTC accounting units
/// (same scale as {VaultBaseUpgradeable-pricePerShare} / `_convertToShares` / `_convertToAssets`).
interface IAssetConverter {
    /// @dev Token amount → BTC accounting units for share conversion.
    function toBtcUnits(
        uint256 tokenAmount
    ) external view returns (uint256 btcOut);

    /// @dev BTC accounting units → token amount (e.g. for `previewMint`).
    function toTokenAmount(
        uint256 btcUnits
    ) external view returns (uint256 tokenOut);
}
