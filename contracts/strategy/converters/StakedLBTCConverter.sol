// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {IOracle} from "../../LBTC/interfaces/IOracle.sol";

/// @title StakedLBTCConverter
/// @notice IAssetConverter adapter for StakedLBTC using StakedLBTCOracle.
/// @dev Both StakedLBTC and the strategy's BTC accounting units use 8 decimals,
///      so the only transformation needed is the oracle's staking ratio.
///
///      oracle.ratio() is 1e18-scaled and expresses "stakedLBTC units per BTC unit":
///        - ratio = 1e18  → 1 stakedLBTC = 1 BTC (initial peg)
///        - ratio < 1e18  → 1 stakedLBTC > 1 BTC (yield accrued)
///
///      Conversions:
///        toBtcUnits:   btcOut   = tokenAmount * 1e18 / ratio  (Floor — fewer shares is safer)
///        toTokenAmount: tokenOut = btcUnits   * ratio / 1e18  (Ceil  — caller pays more, protects strategy)
///
///      Invariant: `IOracle.ratio()` MUST be strictly positive (enforced in `StakedLBTCOracle`; defensive check here).
contract StakedLBTCConverter is IAssetConverter {
    error StakedLBTCConverter_ZeroOracle();
    error StakedLBTCConverter_ZeroRatio();

    IOracle public immutable oracle;

    constructor(address oracle_) {
        if (oracle_ == address(0)) revert StakedLBTCConverter_ZeroOracle();
        oracle = IOracle(oracle_);
    }

    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        uint256 ratio_ = oracle.ratio();
        if (ratio_ == 0) revert StakedLBTCConverter_ZeroRatio();
        return Math.mulDiv(tokenAmount, 1e18, ratio_, rounding);
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        return Math.mulDiv(baseUnits, oracle.ratio(), 1e18, rounding);
    }
}
