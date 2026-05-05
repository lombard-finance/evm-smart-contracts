// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";

/// @title DirectConverter
/// @notice `IAssetConverter` identity mapping: deposit token units equal strategy base accounting units (no oracle).
/// @dev Use when the deposit asset **is** the underlying NAV denomination (e.g. native LBTC into an LBTC-accounted strategy).
contract DirectConverter is IAssetConverter {
    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding /* rounding */
    ) external pure override returns (uint256) {
        return tokenAmount;
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding /* rounding */
    ) external pure override returns (uint256) {
        return baseUnits;
    }
}
