// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title IAssetConverter
/// @notice Per-token adapter: converts between that ERC-20’s native amounts and the strategy’s **base accounting units** (same scale as `pricePerShare` / `_convertToShares` / `_convertToAssets`).
/// @dev Rounding direction is caller-controlled and affects whether the strategy favors itself or the user on boundary wei.
interface IAssetConverter {
    /// @notice Convert `tokenAmount` of the deposit asset into base accounting units (e.g. oracle-priced BTC wei).
    /// @param tokenAmount Amount in the deposit token’s decimals.
    /// @param rounding Applied to the division in the pricing formula.
    /// @return baseOut Amount in strategy base units used before share conversion.
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view returns (uint256 baseOut);

    /// @notice Convert base accounting units into `tokenAmount` of the deposit asset (inverse of `toBaseUnits`).
    /// @param baseUnits Amount in strategy base units.
    /// @param rounding Applied to the division in the pricing formula.
    /// @return tokenOut Amount in the deposit token’s decimals.
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view returns (uint256 tokenOut);
}
