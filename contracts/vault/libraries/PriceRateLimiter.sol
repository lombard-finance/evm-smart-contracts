// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Bucket rate limiter for price-per-share moves expressed in basis points.
/// @dev callers use `using PriceRateLimiter for PriceRateLimiter.Bucket`
///      and invoke library functions as methods on the bucket struct.
library PriceRateLimiter {
    using Math for uint256;

    error PricePerShareRateLimitExceeded();
    error InvalidPricePerShareRateLimit();

    event PricePerShareRateLimitUpdated(uint32 maxBucketBps, uint64 refillRate);

    // 1 unit = 1/1_000_000 = 0.0001 %; minimum expressible yearly rate with weekly buckets ≈ 0.005 %
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
            revert PricePerShareRateLimitExceeded();
        }
        unchecked {
            s.capacityBps -= uint32(changeBps);
        }
    }

    /// @notice Returns a memory copy of the bucket with the refill virtually applied to `block.timestamp`.
    function _currentBucketState(
        Bucket memory b
    ) internal view returns (Bucket memory) {
        uint48 ts = uint48(block.timestamp);
        if (ts > b.lastRefill) {
            uint256 elapsed = uint256(ts) - uint256(b.lastRefill);
            uint256 added = (elapsed * uint256(b.refillRate)) >> 32;
            uint256 newLevel = uint256(b.capacityBps) + added;
            b.capacityBps = newLevel > uint256(b.maxBps)
                ? b.maxBps
                : uint32(newLevel);
            b.lastRefill = ts;
        }
        return b;
    }

    /// @notice Hook for config business-logic validation. Extend to add constraints.
    function _validateConfig(Config memory /* config */) internal pure {}

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
        uint48 ts = uint48(block.timestamp);
        uint48 last = s.lastRefill;
        s.lastRefill = ts;
        if (ts <= last) return;
        uint256 elapsed = uint256(ts) - uint256(last);
        uint256 added = (elapsed * uint256(s.refillRate)) >> 32;
        uint256 newLevel = uint256(s.capacityBps) + added;
        s.capacityBps = newLevel > uint256(s.maxBps)
            ? s.maxBps
            : uint32(newLevel);
    }
}
