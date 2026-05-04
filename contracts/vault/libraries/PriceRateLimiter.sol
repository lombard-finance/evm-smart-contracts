// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceRateLimiter
/// @notice Rate limit on how large a single relative `pricePerShare` move may be (micro-basis-point units), using configurable capacity and refill.
/// @dev Attach with `using PriceRateLimiter for PriceRateLimiter.Bucket` and call `_consume`, `_setConfig`, etc. on storage buckets.
///      **Micro-bps**: internal scale uses `BPS_DENOMINATOR = 1_000_000` (not 10_000).
library PriceRateLimiter {
    using Math for uint256;

    /// @dev Consumption exceeded refill-adjusted remaining bucket capacity for the attempted PPS delta.
    /// @param requestedBps Relative PPS change (micro-bps scale) that could not be consumed.
    /// @param availableBps Remaining bucket capacity after virtual refill, before the attempted consume.
    error PriceRateLimiter_RateLimitExceeded(
        uint256 requestedBps,
        uint256 availableBps
    );

    /// @notice Admin updated the rate-limit bucket configuration used when posting `pricePerShare`.
    /// @param maxBucketBps Bucket ceiling in the library’s micro-bps scale.
    /// @param refillRate Refill rate: additional capacity per second, scaled by `>> 32` in `_refill`.
    event PricePerShareRateLimitUpdated(uint32 maxBucketBps, uint64 refillRate);

    /// @dev Micro-basis-points: 1 unit = 0.0001% (1/1,000,000), NOT standard bps (1/10,000).
    ///      This provides finer granularity for rate limiting price changes.
    ///      Example: 100 units = 0.01%, 10000 units = 1%.
    uint256 private constant BPS_DENOMINATOR = 1_000_000;

    /// @notice Persistent capacity/refill state for this rate limiter.
    /// @dev Packed into one 32-byte storage slot (22 bytes used): timestamps and bps fields.
    struct Bucket {
        /// @dev Last refill checkpoint (unix seconds, truncated to uint48).
        uint48 lastRefill;
        /// @dev Remaining capacity in the library’s micro-bps scale.
        uint32 capacityBps;
        /// @dev Maximum bucket level (`capacityBps` cannot exceed this after refill).
        uint32 maxBps;
        /// @dev Refill increment per second, scaled: added capacity is `(elapsed * refillRate) >> 32`.
        uint64 refillRate;
    }

    /// @notice Immutable configuration passed to `_setConfig`.
    struct Config {
        /// @dev New bucket ceiling (micro-bps).
        uint32 maxBps;
        /// @dev New per-second refill rate (scaled as in `Bucket.refillRate`).
        uint64 refillRate;
    }

    /// @notice Virtual refill to `block.timestamp` without writing storage; used for revert context.
    function _availableAfterRefill(
        Bucket storage s
    ) internal view returns (uint256) {
        Bucket memory b = Bucket({
            lastRefill: s.lastRefill,
            capacityBps: s.capacityBps,
            maxBps: s.maxBps,
            refillRate: s.refillRate
        });
        b = _refill(b);
        return uint256(b.capacityBps);
    }

    /// @notice Refills toward `maxBps` then drains `changeBps` from the bucket.
    /// @param changeBps Basis-point change to consume; use `_relativeChangeBps` to compute.
    function _consume(Bucket storage s, uint256 changeBps) internal {
        _checkpoint(s);
        if (
            changeBps > type(uint32).max || uint256(s.capacityBps) < changeBps
        ) {
            revert PriceRateLimiter_RateLimitExceeded(
                changeBps,
                uint256(s.capacityBps)
            );
        }
        unchecked {
            s.capacityBps -= uint32(changeBps);
        }
    }

    /// @return True if `_consume(s, changeBps)` would revert (oversized change or no capacity).
    function _wouldExceedLimit(
        Bucket storage s,
        uint256 changeBps
    ) internal view returns (bool) {
        Bucket memory b = Bucket({
            lastRefill: s.lastRefill,
            capacityBps: s.capacityBps,
            maxBps: s.maxBps,
            refillRate: s.refillRate
        });
        b = _refill(b);
        if (changeBps > type(uint32).max) return true;
        return changeBps > uint256(b.capacityBps);
    }

    /// @notice Checkpoints refill then zeros remaining capacity (soft overflow: burn full bucket without applying an oversized move).
    function _drainRemaining(Bucket storage s) internal {
        _checkpoint(s);
        s.capacityBps = 0;
    }

    /// @dev Applies elapsed-time refill to a memory bucket; noop when `block.timestamp <= b.lastRefill`.
    ///      Used by `_checkpoint` and by `pricePerShareRateLimiterState` (via `using` on storage bucket).
    function _refill(Bucket memory b) internal view returns (Bucket memory) {
        uint48 ts = uint48(block.timestamp);
        if (ts <= b.lastRefill) return b;
        uint256 elapsed = uint256(ts) - uint256(b.lastRefill);
        uint256 added = (elapsed * uint256(b.refillRate)) >> 32;
        uint256 newLevel = uint256(b.capacityBps) + added;
        b.capacityBps = newLevel > uint256(b.maxBps)
            ? b.maxBps
            : uint32(newLevel);
        b.lastRefill = ts;
        return b;
    }

    /// @notice Checkpoints the refill to `block.timestamp`, then applies the new config.
    ///         Seeds a full bucket on first config; otherwise caps the stored level at the new `maxBps`.
    function _setConfig(Bucket storage s, Config memory config) internal {
        uint32 oldMax = s.maxBps;
        _checkpoint(s);

        s.maxBps = config.maxBps;
        s.refillRate = config.refillRate;

        if (oldMax == 0) {
            s.capacityBps = config.maxBps;
        } else if (s.capacityBps > config.maxBps) {
            s.capacityBps = config.maxBps;
        }

        emit PricePerShareRateLimitUpdated(config.maxBps, config.refillRate);
    }

    /// @notice Absolute relative change from `oldPps` to `newPps`, in basis points, rounded up.
    function _relativeChangeBps(
        uint256 oldPps,
        uint256 newPps
    ) internal pure returns (uint256) {
        uint256 diff = newPps >= oldPps ? newPps - oldPps : oldPps - newPps;
        return diff.mulDiv(BPS_DENOMINATOR, oldPps, Math.Rounding.Ceil);
    }

    /// @dev Advances stored refill state to `block.timestamp` without exceeding `maxBps`.
    function _checkpoint(Bucket storage s) private {
        Bucket memory updated = _refill(s);
        s.lastRefill = uint48(block.timestamp);
        s.capacityBps = updated.capacityBps;
    }
}
