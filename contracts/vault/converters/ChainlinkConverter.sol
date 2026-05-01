// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkConverter
/// @notice IAssetConverter adapter for any asset priced via a Chainlink AggregatorV3Interface feed.
///
/// @dev Feed semantics: `answer / 10^feed.decimals()` = price of 1 token in base-asset units.
///      Decimal normalisation is pre-computed once as an immutable scalingFactor:
///        scalingFactor = 10^(feedDecimals + tokenDecimals - baseDecimals)
///
///      Conversions:
///        toBaseUnits:   baseOut   = mulDiv(tokenAmount, answer, scalingFactor, rounding)
///        fromBaseUnits: tokenOut  = mulDiv(baseUnits, scalingFactor, answer, rounding)
///
///      `baseDecimals` must equal the vault underlying asset's decimal count
///      (e.g. 8 for BTC/LBTC, 18 for WETH).
contract ChainlinkConverter is IAssetConverter {
    error ChainlinkConverter_StaleAnswer();
    error ChainlinkConverter_FutureAnswer();
    error ChainlinkConverter_InvalidAnswer();
    error ChainlinkConverter_SequencerDown();
    error ChainlinkConverter_GracePeriodNotOver();
    error ChainlinkConverter_ZeroFeed();
    error ChainlinkConverter_ZeroHeartbeat();
    error ChainlinkConverter_DecimalsUnderflow();

    AggregatorV3Interface public immutable feed;
    /// @dev 10^(feedDecimals + tokenDecimals - baseDecimals); normalises token/feed decimals to base-asset units.
    uint256 public immutable scalingFactor;
    uint256 public immutable heartbeat;
    /// @dev address(0) disables the sequencer check (mainnet deployments).
    AggregatorV3Interface public immutable sequencerUptimeFeed;
    uint256 public immutable gracePeriod;
    /// @dev Decimal count of the vault's underlying base asset (e.g. 8 for BTC, 18 for ETH).
    uint8 public immutable baseDecimals;

    /// @param feed_ Chainlink AggregatorV3Interface for the deposit asset price.
    /// @param tokenDecimals_ Deposit token decimals (metadata scale).
    /// @param baseDecimals_ Vault underlying decimals (must match vault asset decimals).
    /// @param heartbeat_ Maximum allowed staleness of `latestRoundData.updatedAt` (seconds).
    /// @param sequencerUptimeFeed_ L2 sequencer feed; zero disables sequencer checks.
    /// @param gracePeriod_ Seconds after sequencer recovery during which `_checkSequencer` still reverts.
    constructor(
        address feed_,
        uint8 tokenDecimals_,
        uint8 baseDecimals_,
        uint256 heartbeat_,
        address sequencerUptimeFeed_,
        uint256 gracePeriod_
    ) {
        if (feed_ == address(0)) revert ChainlinkConverter_ZeroFeed();
        if (heartbeat_ == 0) revert ChainlinkConverter_ZeroHeartbeat();
        feed = AggregatorV3Interface(feed_);
        uint8 feedDec = feed.decimals();
        if (uint256(feedDec) + tokenDecimals_ < baseDecimals_)
            revert ChainlinkConverter_DecimalsUnderflow();
        baseDecimals = baseDecimals_;
        scalingFactor =
            10 ** (uint256(feedDec) + tokenDecimals_ - baseDecimals_);
        heartbeat = heartbeat_;
        sequencerUptimeFeed = AggregatorV3Interface(sequencerUptimeFeed_);
        gracePeriod = gracePeriod_;
    }

    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        return Math.mulDiv(tokenAmount, _getAnswer(), scalingFactor, rounding);
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        return Math.mulDiv(baseUnits, scalingFactor, _getAnswer(), rounding);
    }

    function _getAnswer() private view returns (uint256) {
        _checkSequencer();
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert ChainlinkConverter_InvalidAnswer();
        if (updatedAt > block.timestamp)
            revert ChainlinkConverter_FutureAnswer();
        if (block.timestamp - updatedAt > heartbeat)
            revert ChainlinkConverter_StaleAnswer();
        return uint256(answer);
    }

    /// @dev Reverts if the L2 sequencer is down or within the grace period after recovery.
    ///      Skipped when sequencerUptimeFeed is address(0) (mainnet / sequencer-less chains).
    function _checkSequencer() private view {
        if (address(sequencerUptimeFeed) == address(0)) return;
        // answer == 0: sequencer up; answer == 1: sequencer down
        (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed
            .latestRoundData();
        if (answer == 1) revert ChainlinkConverter_SequencerDown();
        // startedAt == 0 would make block.timestamp - 0 silently pass any grace period.
        if (startedAt == 0) revert ChainlinkConverter_SequencerDown();
        if (block.timestamp - startedAt < gracePeriod)
            revert ChainlinkConverter_GracePeriodNotOver();
    }
}
