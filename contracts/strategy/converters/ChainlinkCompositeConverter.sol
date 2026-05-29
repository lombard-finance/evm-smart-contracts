// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAssetConverter} from "../interfaces/IAssetConverter.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkCompositeConverter
/// @notice `IAssetConverter` using **two** Chainlink v3 feeds whose answers form a **ratio** with decimal-aware scaling.
///
/// @dev **Combined price** (before token/base decimal normalization) is:
///
///      `ratio ≈ (numeratorAnswer / 10^feedNumDecimals) / (denominatorAnswer / 10^feedDenDecimals)`.
///
///      Treat `feedNumerator` / `feedDenominator` as **two FX legs** that share a common quote so that the ratio gives
///      **strategy-base per 1 deposit-token** when `inverted == false`.
///
///      **BTC-denominated vault, ETH (or other) deposit** — cross via USD:
///      - Numerator = **X / USD** (e.g. Chainlink **ETH / USD**): answer ≈ USD per 1 ETH.
///      - Denominator = **BTC / USD** (e.g. Chainlink **BTC / USD**): answer ≈ USD per 1 BTC.
///      - Then `ratio` ≈ (USD per ETH) / (USD per BTC) ≈ **BTC per 1 ETH** → use **`inverted = false`**.
///
///      **Inverted (`inverted = true`)** swaps numerator and denominator in the ratio (equivalent to deploying with feeds
///      swapped). Use when your economic ratio is **deposit-token per base** across the two legs instead of base per token.
///
///      Rule of thumb: build the ratio so it equals **base per 1 token** in natural units; if you get the reciprocal,
///      either swap the two feed addresses or set **`inverted = true`**.
///
///      Both feeds are checked for positive answer, future `updatedAt`, and staleness (`heartbeat`). `baseDecimals` must
///      match the strategy underlying’s decimals (e.g. 8 for BTC/LBTC).
/// @custom:security-contact legal@lombard.finance
contract ChainlinkCompositeConverter is IAssetConverter {
    error ChainlinkCompositeConverter_StaleAnswer();
    error ChainlinkCompositeConverter_FutureAnswer();
    error ChainlinkCompositeConverter_InvalidAnswer();
    error ChainlinkCompositeConverter_SequencerDown();
    error ChainlinkCompositeConverter_GracePeriodNotOver();
    error ChainlinkCompositeConverter_ZeroFeed();
    error ChainlinkCompositeConverter_ZeroHeartbeat();

    AggregatorV3Interface public immutable feedNumerator;
    AggregatorV3Interface public immutable feedDenominator;
    /// @dev `10^(feedDenDecimals + baseDecimals)` for forward (`!inverted`) outer scale.
    uint256 public immutable scaleFwdNum;
    /// @dev `10^(feedNumDecimals + tokenDecimals)` for forward outer scale.
    uint256 public immutable scaleFwdDen;
    /// @dev `10^(feedNumDecimals + baseDecimals)` for inverted outer scale.
    uint256 public immutable scaleInvNum;
    /// @dev `10^(feedDenDecimals + tokenDecimals)` for inverted outer scale.
    uint256 public immutable scaleInvDen;
    uint256 public immutable heartbeat;
    AggregatorV3Interface public immutable sequencerUptimeFeed;
    uint256 public immutable gracePeriod;
    uint8 public immutable baseDecimals;
    /// @dev If false: `base per token ∝ feedNumerator / feedDenominator`. If true: uses the reciprocal ratio.
    bool public immutable inverted;

    /// @param feedNumerator_ First leg of the ratio (e.g. ETH/USD for ETH deposits).
    /// @param feedDenominator_ Second leg (e.g. BTC/USD for a BTC-base vault).
    /// @param tokenDecimals_ Deposit token decimals.
    /// @param baseDecimals_ Strategy underlying decimals (must match `asset()`).
    /// @param heartbeat_ Max staleness (seconds) for **each** feed’s `updatedAt`.
    /// @param sequencerUptimeFeed_ L2 sequencer feed; zero disables sequencer checks.
    /// @param gracePeriod_ Grace period after sequencer recovery (seconds).
    /// @param inverted_ If true, use reciprocal of the `feedNumerator` / `feedDenominator` ratio (see contract @dev).
    constructor(
        address feedNumerator_,
        address feedDenominator_,
        uint8 tokenDecimals_,
        uint8 baseDecimals_,
        uint256 heartbeat_,
        address sequencerUptimeFeed_,
        uint256 gracePeriod_,
        bool inverted_
    ) {
        if (feedNumerator_ == address(0) || feedDenominator_ == address(0))
            revert ChainlinkCompositeConverter_ZeroFeed();
        if (heartbeat_ == 0) revert ChainlinkCompositeConverter_ZeroHeartbeat();

        feedNumerator = AggregatorV3Interface(feedNumerator_);
        feedDenominator = AggregatorV3Interface(feedDenominator_);
        uint8 numDec = feedNumerator.decimals();
        uint8 denDec = feedDenominator.decimals();
        baseDecimals = baseDecimals_;
        inverted = inverted_;

        scaleFwdNum = 10 ** (uint256(denDec) + baseDecimals_);
        scaleFwdDen = 10 ** (uint256(numDec) + tokenDecimals_);
        scaleInvNum = 10 ** (uint256(numDec) + baseDecimals_);
        scaleInvDen = 10 ** (uint256(denDec) + tokenDecimals_);

        heartbeat = heartbeat_;
        sequencerUptimeFeed = AggregatorV3Interface(sequencerUptimeFeed_);
        gracePeriod = gracePeriod_;
    }

    /// @inheritdoc IAssetConverter
    function toBaseUnits(
        uint256 tokenAmount,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        (uint256 num, uint256 den) = _readAnswers();
        // Fold the feed ratio and the decimal scaling into a single mulDiv so the
        // only rounding happens on the final result. Splitting this into two
        // mulDivs (ratio first, scaling second) lets the intermediate value
        // truncate to a tiny number — or zero — before being scaled back up,
        // which can silently lose a large fraction of the converted amount.
        if (!inverted) {
            return
                Math.mulDiv(
                    tokenAmount,
                    num * scaleFwdNum,
                    den * scaleFwdDen,
                    rounding
                );
        } else {
            return
                Math.mulDiv(
                    tokenAmount,
                    den * scaleInvNum,
                    num * scaleInvDen,
                    rounding
                );
        }
    }

    /// @inheritdoc IAssetConverter
    function fromBaseUnits(
        uint256 baseUnits,
        Math.Rounding rounding
    ) external view override returns (uint256) {
        (uint256 num, uint256 den) = _readAnswers();
        // Single mulDiv (inverse of `toBaseUnits`) to avoid intermediate
        // truncation; see the note in `toBaseUnits`.
        if (!inverted) {
            return
                Math.mulDiv(
                    baseUnits,
                    den * scaleFwdDen,
                    num * scaleFwdNum,
                    rounding
                );
        } else {
            return
                Math.mulDiv(
                    baseUnits,
                    num * scaleInvDen,
                    den * scaleInvNum,
                    rounding
                );
        }
    }

    function _readAnswers() private view returns (uint256 num, uint256 den) {
        _checkSequencer();
        num = _readFeed(feedNumerator);
        den = _readFeed(feedDenominator);
    }

    function _readFeed(
        AggregatorV3Interface feed
    ) private view returns (uint256 answer) {
        (, int256 ans, , uint256 updatedAt, ) = feed.latestRoundData();
        if (ans <= 0) revert ChainlinkCompositeConverter_InvalidAnswer();
        if (updatedAt > block.timestamp)
            revert ChainlinkCompositeConverter_FutureAnswer();
        if (block.timestamp - updatedAt > heartbeat)
            revert ChainlinkCompositeConverter_StaleAnswer();
        return uint256(ans);
    }

    /// @dev Reverts if the L2 sequencer is down or within the grace period after recovery.
    function _checkSequencer() private view {
        if (address(sequencerUptimeFeed) == address(0)) return;
        (, int256 seqAns, uint256 startedAt, , ) = sequencerUptimeFeed
            .latestRoundData();
        if (seqAns == 1) revert ChainlinkCompositeConverter_SequencerDown();
        if (startedAt == 0) revert ChainlinkCompositeConverter_SequencerDown();
        if (block.timestamp - startedAt < gracePeriod)
            revert ChainlinkCompositeConverter_GracePeriodNotOver();
    }
}
