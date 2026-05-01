// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";

/// @title DirectConverter
/// @notice IAssetConverter for assets whose units are identical to the vault's base accounting units (e.g. LBTC).
contract DirectConverter is IAssetConverter {
    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding
    ) external pure override returns (uint256) {
        return tokenAmount;
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding
    ) external pure override returns (uint256) {
        return baseUnits;
    }
}
