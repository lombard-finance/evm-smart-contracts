// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {AggregatorV3Interface} from "../../LBTC/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkConverter
/// @notice IAssetConverter adapter for any asset priced via a Chainlink AggregatorV3Interface feed.
///
/// @dev Feed semantics: `answer / 10^feed.decimals()` = price of 1 token in whole BTC units.
///      Decimal normalisation is pre-computed once as an immutable scalingFactor:
///        scalingFactor = 10^(feedDecimals + tokenDecimals - 8)
///
///      Conversions:
///        toBtcUnits:   btcOut    = mulDiv(tokenAmount, answer, scalingFactor, Floor)
///        toTokenAmount: tokenOut = mulDiv(btcUnits, scalingFactor, answer, Ceil)
contract ChainlinkConverter is IAssetConverter {
    error ChainlinkConverter_StaleAnswer();
    error ChainlinkConverter_InvalidAnswer();

    AggregatorV3Interface public immutable feed;
    /// @dev 10^(feedDecimals + tokenDecimals - 8); normalises token/feed decimals to 8-decimal BTC units.
    uint256 public immutable scalingFactor;
    uint256 public immutable heartbeat;

    constructor(address feed_, uint8 tokenDecimals_, uint256 heartbeat_) {
        require(feed_ != address(0), "zero feed");
        require(heartbeat_ != 0, "zero heartbeat");
        feed = AggregatorV3Interface(feed_);
        uint8 feedDec = feed.decimals();
        require(uint256(feedDec) + tokenDecimals_ >= 8, "decimals underflow");
        scalingFactor = 10 ** (uint256(feedDec) + tokenDecimals_ - 8);
        heartbeat = heartbeat_;
    }

    /// @inheritdoc IAssetConverter
    function toBtcUnits(
        uint256 tokenAmount
    ) external view override returns (uint256) {
        return
            Math.mulDiv(
                tokenAmount,
                _getAnswer(),
                scalingFactor,
                Math.Rounding.Floor
            );
    }

    /// @inheritdoc IAssetConverter
    function toTokenAmount(
        uint256 btcUnits
    ) external view override returns (uint256) {
        return
            Math.mulDiv(
                btcUnits,
                scalingFactor,
                _getAnswer(),
                Math.Rounding.Ceil
            );
    }

    function _getAnswer() private view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert ChainlinkConverter_InvalidAnswer();
        if (block.timestamp - updatedAt > heartbeat) revert ChainlinkConverter_StaleAnswer();
        return uint256(answer);
    }
}
