// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {IOracle} from "../../LBTC/interfaces/IOracle.sol";

/// @title StakedLBTCConverter
/// @notice IAssetConverter adapter for StakedLBTC using StakedLBTCOracle.
/// @dev Both StakedLBTC and the vault's BTC accounting units use 8 decimals,
///      so the only transformation needed is the oracle's staking ratio.
///
///      oracle.ratio() is 1e18-scaled and expresses "stakedLBTC units per BTC unit":
///        - ratio = 1e18  → 1 stakedLBTC = 1 BTC (initial peg)
///        - ratio < 1e18  → 1 stakedLBTC > 1 BTC (yield accrued)
///
///      Conversions:
///        toBtcUnits:   btcOut   = tokenAmount * 1e18 / ratio  (Floor — fewer shares is safer)
///        toTokenAmount: tokenOut = btcUnits   * ratio / 1e18  (Ceil  — caller pays more, protects vault)
contract StakedLBTCConverter is IAssetConverter {
    IOracle public immutable oracle;

    constructor(address oracle_) {
        require(oracle_ != address(0), "zero oracle");
        oracle = IOracle(oracle_);
    }

    /// @inheritdoc IAssetConverter
    function toBtcUnits(
        uint256 tokenAmount
    ) external view override returns (uint256 btcOut) {
        return Math.mulDiv(tokenAmount, 1e18, oracle.ratio(), Math.Rounding.Floor);
    }

    /// @inheritdoc IAssetConverter
    function toTokenAmount(
        uint256 btcUnits
    ) external view override returns (uint256 tokenOut) {
        return Math.mulDiv(btcUnits, oracle.ratio(), 1e18, Math.Rounding.Ceil);
    }
}
