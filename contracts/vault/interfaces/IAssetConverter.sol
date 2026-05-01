// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title IAssetConverter
/// @notice Per-token adapter: converts between that token’s amounts and the vault’s base accounting units
/// (same scale as {VaultBaseUpgradeable-pricePerShare} / `_convertToShares` / `_convertToAssets`).
interface IAssetConverter {
    /// @dev Token amount → base accounting units for share conversion.
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view returns (uint256 baseOut);

    /// @dev Base accounting units → token amount (e.g. for `previewMint`).
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view returns (uint256 tokenOut);
}
