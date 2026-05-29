// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkConverter
/// @notice IAssetConverter adapter for any asset priced via a Chainlink AggregatorV3Interface feed.
///
/// @dev Two modes, selected at construction by `inverted_`:
///
///      **Forward (`inverted = false`)** — feed reports **strategy-base per 1 deposit-token** (“how much
///      base do I get per one token”). Example: ETH/BTC-style feed for an ETH deposit into a BTC-base
///      strategy — `answer / 10^feed.decimals()` ≈ BTC per 1 ETH (in natural units).
///        scalingFactor = 10^(feedDecimals + tokenDecimals - baseDecimals)
///        Requires: feedDecimals + tokenDecimals >= baseDecimals
///        toBaseUnits:   baseOut  = mulDiv(tokenAmount, answer, scalingFactor, rounding)
///        fromBaseUnits: tokenOut = mulDiv(baseUnits, scalingFactor, answer, rounding)
///
///      **Inverted (`inverted = true`)** — feed reports **deposit-token per 1 strategy-base** (“how much
///      token do I pay per one base unit”). Example: BTC/USD-style feed with USDC deposit and BTC-base
///      strategy — `answer / 10^feed.decimals()` ≈ USD (stable) per 1 BTC.
///        scalingFactor = 10^(feedDecimals + baseDecimals - tokenDecimals)
///        Requires: feedDecimals + baseDecimals >= tokenDecimals
///        toBaseUnits:   baseOut  = mulDiv(tokenAmount, scalingFactor, answer, rounding)
///        fromBaseUnits: tokenOut = mulDiv(baseUnits, answer, scalingFactor, rounding)
///
///      **BTC-denominated strategy** (`baseDecimals = 8`, `asset()` is BTC/BTC-pegged accounting):
///
///      - **BTC/USD** (typical Chainlink “BTC / USD”): `answer` is **USD per 1 BTC** → stablecoin units per
///        1 BTC → **deposit-token per base** → **`inverted = true`**.
///      - **USD/BTC** (inverse-style feed): `answer` is **BTC per 1 USD** (base per unit of stablecoin) →
///        **base per deposit-token** → **`inverted = false`**.
///      - **WBTC/BTC**, **TBTC/BTC**, etc.: `answer` is **BTC per 1 wrapped token** → **`inverted = false`**.
///      - **ETH/BTC** with ETH deposit: `answer` is **BTC per 1 ETH** → **`inverted = false`**.
///
///      Rule of thumb: interpret the feed as “price of **X** in **Y**”. If **Y** is your deposit token and **X**
///      is BTC (strategy base), use **`inverted = true`**. If **Y** is BTC and **X** is your deposit token,
///      use **`inverted = false`**.
///
///      `baseDecimals` must equal the strategy underlying asset's decimal count
///      (e.g. 8 for BTC/LBTC, 18 for WETH).
/// @custom:security-contact legal@lombard.finance
contract ChainlinkConverter is IAssetConverter {
    error ChainlinkConverterStaleAnswer();
    error ChainlinkConverterFutureAnswer();
    error ChainlinkConverterInvalidAnswer();
    error ChainlinkConverterSequencerDown();
    error ChainlinkConverterGracePeriodNotOver();
    error ChainlinkConverterZeroFeed();
    error ChainlinkConverterZeroHeartbeat();
    error ChainlinkConverterDecimalsUnderflow();

    AggregatorV3Interface public immutable feed;
    /// @dev Normalisation factor; exponent depends on `inverted` (see contract-level @dev).
    uint256 public immutable scalingFactor;
    uint256 public immutable heartbeat;
    /// @dev address(0) disables the sequencer check (mainnet deployments).
    AggregatorV3Interface public immutable sequencerUptimeFeed;
    uint256 public immutable gracePeriod;
    /// @dev Decimal count of the strategy's underlying base asset (e.g. 8 for BTC, 18 for ETH).
    uint8 public immutable baseDecimals;
    /// @dev If false: feed is base-per-token. If true: feed is token-per-base.
    bool public immutable inverted;

    /// @param feed_ Chainlink AggregatorV3Interface for the deposit asset price.
    /// @param tokenDecimals_ Deposit token decimals (metadata scale).
    /// @param baseDecimals_ Strategy underlying decimals (must match `asset()` decimals).
    /// @param heartbeat_ Maximum allowed staleness of `latestRoundData.updatedAt` (seconds).
    /// @param sequencerUptimeFeed_ L2 sequencer feed; zero disables sequencer checks.
    /// @param gracePeriod_ Seconds after sequencer recovery during which `_checkSequencer` still reverts.
    /// @param inverted_ See contract @dev: **`false`** = feed is **base per deposit-token**; **`true`** =
    ///                  feed is **deposit-token per base**. For a BTC-base vault + Chainlink **BTC/USD** +
    ///                  USDC deposits, use **`true`**. For a feed that reports **BTC per 1 token**, use **`false`**.
    constructor(
        address feed_,
        uint8 tokenDecimals_,
        uint8 baseDecimals_,
        uint256 heartbeat_,
        address sequencerUptimeFeed_,
        uint256 gracePeriod_,
        bool inverted_
    ) {
        if (feed_ == address(0)) revert ChainlinkConverterZeroFeed();
        if (heartbeat_ == 0) revert ChainlinkConverterZeroHeartbeat();
        feed = AggregatorV3Interface(feed_);
        uint8 feedDec = feed.decimals();
        baseDecimals = baseDecimals_;
        inverted = inverted_;
        if (inverted_) {
            if (uint256(feedDec) + baseDecimals_ < tokenDecimals_)
                revert ChainlinkConverterDecimalsUnderflow();
            scalingFactor =
                10 ** (uint256(feedDec) + baseDecimals_ - tokenDecimals_);
        } else {
            if (uint256(feedDec) + tokenDecimals_ < baseDecimals_)
                revert ChainlinkConverterDecimalsUnderflow();
            scalingFactor =
                10 ** (uint256(feedDec) + tokenDecimals_ - baseDecimals_);
        }
        heartbeat = heartbeat_;
        sequencerUptimeFeed = AggregatorV3Interface(sequencerUptimeFeed_);
        gracePeriod = gracePeriod_;
    }

    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        uint256 ans = _getAnswer();
        return
            inverted
                ? Math.mulDiv(tokenAmount, scalingFactor, ans, rounding)
                : Math.mulDiv(tokenAmount, ans, scalingFactor, rounding);
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        uint256 ans = _getAnswer();
        return
            inverted
                ? Math.mulDiv(baseUnits, ans, scalingFactor, rounding)
                : Math.mulDiv(baseUnits, scalingFactor, ans, rounding);
    }

    function _getAnswer() private view returns (uint256) {
        _checkSequencer();
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = feed
            .latestRoundData();
        if (roundId == 0) revert ChainlinkConverterInvalidAnswer();
        if (answer <= 0) revert ChainlinkConverterInvalidAnswer();
        if (updatedAt > block.timestamp)
            revert ChainlinkConverterFutureAnswer();
        if (block.timestamp - updatedAt > heartbeat)
            revert ChainlinkConverterStaleAnswer();
        return uint256(answer);
    }

    /// @dev Reverts if the L2 sequencer is down or within the grace period after recovery.
    ///      Skipped when sequencerUptimeFeed is address(0) (mainnet / sequencer-less chains).
    function _checkSequencer() private view {
        if (address(sequencerUptimeFeed) == address(0)) return;
        // answer == 0: sequencer up; answer == 1: sequencer down
        (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed
            .latestRoundData();
        if (answer == 1) revert ChainlinkConverterSequencerDown();
        // startedAt == 0 would make block.timestamp - 0 silently pass any grace period.
        if (startedAt == 0) revert ChainlinkConverterSequencerDown();
        if (block.timestamp - startedAt < gracePeriod)
            revert ChainlinkConverterGracePeriodNotOver();
    }
}
