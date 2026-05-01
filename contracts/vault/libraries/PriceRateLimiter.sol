// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Bucket rate limiter for price-per-share moves expressed in basis points.
/// @dev callers use `using PriceRateLimiter for PriceRateLimiter.Bucket`
///      and invoke library functions as methods on the bucket struct.
library PriceRateLimiter {
    using Math for uint256;

    error PriceRateLimiter_RateLimitExceeded();

    event PricePerShareRateLimitUpdated(uint32 maxBucketBps, uint64 refillRate);

    /// @dev Micro-basis-points: 1 unit = 0.0001% (1/1,000,000), NOT standard bps (1/10,000).
    ///      This provides finer granularity for rate limiting price changes.
    ///      Example: 100 units = 0.01%, 10000 units = 1%.
    uint256 private constant BPS_DENOMINATOR = 100_0000;

    /// @dev Packed into one 32-byte storage slot: 6+4+4+8 = 22 bytes.
    struct Bucket {
        uint48 lastRefill; // ─╮ timestamp of last checkpoint
        uint32 capacityBps; //  │ available capacity (bps)
        uint32 maxBps; //  │ bucket ceiling
        uint64 refillRate; // ─╯ refill rate: bps/sec × 2^32
    }

    struct Config {
        uint32 maxBps;
        uint64 refillRate;
    }

    /// @notice Refills toward `maxBps` then drains `changeBps` from the bucket.
    /// @param changeBps Basis-point change to consume; use `_relativeChangeBps` to compute.
    function _consume(Bucket storage s, uint256 changeBps) internal {
        _checkpoint(s);
        if (
            changeBps > type(uint32).max || uint256(s.capacityBps) < changeBps
        ) {
            revert PriceRateLimiter_RateLimitExceeded();
        }
        unchecked {
            s.capacityBps -= uint32(changeBps);
        }
    }

    /// @notice Returns a memory copy of the bucket with the refill virtually applied to `block.timestamp`.
    function _currentBucketState(
        Bucket memory b
    ) internal view returns (Bucket memory) {
        return _refill(b);
    }

    /// @dev Applies elapsed-time refill to a memory bucket; noop when `block.timestamp <= b.lastRefill`.
    function _refill(Bucket memory b) private view returns (Bucket memory) {
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
