// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAssetConverter} from "../vault/interfaces/IAssetConverter.sol";

/// @dev 1:1 token amounts ↔ vault BTC accounting units (testing only).
contract MockIdentityAssetConverter is IAssetConverter {
    function toBtcUnits(uint256 tokenAmount) external pure returns (uint256) {
        return tokenAmount;
    }

    function toTokenAmount(uint256 btcUnits) external pure returns (uint256) {
        return btcUnits;
    }
}
