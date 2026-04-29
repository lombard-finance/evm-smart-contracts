// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IAssetConverter} from "../interfaces/IAssetConverter.sol";

/// @title DirectConverter
/// @notice IAssetConverter for assets whose units are identical to the vault's BTC accounting units (e.g. LBTC).
contract DirectConverter is IAssetConverter {
    /// @inheritdoc IAssetConverter
    function toBtcUnits(
        uint256 tokenAmount
    ) external pure override returns (uint256) {
        return tokenAmount;
    }

    /// @inheritdoc IAssetConverter
    function toTokenAmount(
        uint256 btcUnits
    ) external pure override returns (uint256) {
        return btcUnits;
    }
}
