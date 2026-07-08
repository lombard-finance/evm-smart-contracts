// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title RateLimitsV2
 * @notice Gas-optimized successor to {RateLimits}.
 *
 * @dev Decay math matches {RateLimits}: a continuous linear-decay (leaky-bucket) limiter where
 *      `amountInFlight` decays towards zero at `limit / window` per second (no period reset).
 *      `limit` is bucket capacity — the maximum instantaneous in-flight amount — not a hard cap on
 *      total mintable volume over any `window`-length interval; in the worst case a caller can
 *      consume up to ~2× `limit` over `window` seconds (full burst, full decay, full burst again).
 *      Configuration and error semantics are tightened vs V1: `setRateLimit` rejects `window == 0`, caps decayed in-flight to the
 *      new limit on reconfigure, and `updateLimit` reverts {RateLimitNotConfigured} when unset
 *      (V1 allowed updates against a zero limit). {RateLimitExceeded} carries revert args.
 *
 *      Storage layout is the other major change. {RateLimits.Data} occupies four 256-bit slots
 *      and {RateLimits.updateLimit} copies the whole struct into memory (4 SLOADs) and writes
 *      two slots (2 SSTOREs) per call. {RateLimitsV2.Data} packs all four fields into a SINGLE
 *      256-bit slot, so a hot-path update costs 1 SLOAD + 1 SSTORE.
 *
 *      Field widths (sum = 256 bits → one slot). Do NOT reorder without re-checking packing:
 *        - amountInFlight  uint96  max ~7.92e28
 *        - limit           uint96  same bound; `amountInFlight` is always <= `limit`
 *        - lastUpdated     uint32  unix seconds; truncates after year 2106 — then
 *          `block.timestamp - lastUpdated` wraps large, the bucket reads as fully decayed, and
 *          the cap stops constraining (fails open, not locked)
 *        - window          uint32  seconds, max ~136 years
 * @custom:security-contact security@lombard.finance
 */
library RateLimitsV2 {
    /**
     * @notice Packed rate-limit state. All four fields share one storage slot.
     * @param amountInFlight Outstanding amount checkpointed at `lastUpdated`; decays linearly toward zero between updates.
     * @param limit Bucket capacity: maximum instantaneous `amountInFlight`. Not a per-window mint cap — up to ~2× `limit`
     *              can be consumed over any `window`-length interval in the worst case.
     * @param lastUpdated Timestamp the limit was last checked/updated.
     * @param window Time in seconds for a full bucket (`amountInFlight == limit`) to drain to zero at rate `limit / window` per second.
     */
    struct Data {
        uint96 amountInFlight;
        uint96 limit;
        uint32 lastUpdated;
        uint32 window;
    }

    /**
     * @notice Rate-limit configuration.
     * @param limit Bucket capacity: maximum instantaneous in-flight amount (see {Data.limit}).
     * @param window Drain time for a full bucket; sets decay rate `limit / window` per second (see {Data.window}).
     */
    struct Config {
        uint96 limit;
        uint32 window;
    }

    /// @notice Thrown when an amount exceeds the rate limit.
    /// @param requested Amount that was requested.
    /// @param remaining Remaining capacity at `block.timestamp` before applying `requested`.
    /// @param limit Configured bucket capacity (maximum instantaneous in-flight amount).
    error RateLimitExceeded(
        uint256 requested,
        uint256 remaining,
        uint256 limit
    );

    /// @notice Thrown when a rate limit is not configured (`limit` = `0`).
    error RateLimitNotConfigured();

    /// @notice Thrown when a rate limit is malformed (`limit` or `window` is zero).
    error MalformedRateLimit();

    /// @dev Checkpoints decayed in-flight at `block.timestamp`, then stores `config`. If decayed
    ///      in-flight exceeds `config.limit`, it is capped so the new limit applies immediately.
    ///      Reverts {MalformedRateLimit} when `config.limit == 0` or `config.window == 0`.
    ///      Note: the LBTC wrappers (`BaseLBTC.setMinterLimit`, `BridgeTokenAdapter.setMinterLimit`)
    ///      intercept `config.limit == 0` and delete the minter entry before calling this function,
    ///      so the `config.limit == 0` guard here is unreachable from those paths; it is retained
    ///      as a safety net for direct library callers.
    function setRateLimit(Data storage rl, Config calldata config) public {
        if (config.limit == 0 || config.window == 0) {
            revert MalformedRateLimit();
        }

        (uint256 amountInFlight, ) = availableAmount(rl);
        if (amountInFlight > config.limit) {
            amountInFlight = config.limit;
        }

        rl.amountInFlight = uint96(amountInFlight);
        rl.lastUpdated = uint32(block.timestamp);
        rl.limit = config.limit;
        rl.window = config.window;
    }

    function availableAmount(
        Data storage rl
    )
        public
        view
        returns (uint256 currentAmountInFlight, uint256 remainingCapacity)
    {
        if (rl.limit == 0) {
            return (0, 0);
        }

        // @dev Reading the four fields resolves to a single SLOAD (they share one slot).
        uint256 timeSinceLastUpdate = block.timestamp - rl.lastUpdated;
        if (timeSinceLastUpdate >= rl.window) {
            currentAmountInFlight = 0;
            remainingCapacity = rl.limit;
        } else {
            uint256 decay = (uint256(rl.limit) * timeSinceLastUpdate) /
                rl.window;
            currentAmountInFlight = rl.amountInFlight <= decay
                ? 0
                : uint256(rl.amountInFlight) - decay;
            remainingCapacity = rl.limit <= currentAmountInFlight
                ? 0
                : uint256(rl.limit) - currentAmountInFlight;
        }
    }

    /**
     * @notice Verifies the amount is within the rate limit and, on success, updates
     *         `amountInFlight`/`lastUpdated`. Reverts with {RateLimitExceeded} otherwise.
     * @param rl The rate limit to update.
     * @param _amount The amount to check and apply.
     */
    function updateLimit(Data storage rl, uint256 _amount) public {
        if (rl.limit == 0) revert RateLimitNotConfigured();

        (
            uint256 currentAmountInFlight,
            uint256 remainingCapacity
        ) = availableAmount(rl);
        if (_amount > remainingCapacity)
            revert RateLimitExceeded(_amount, remainingCapacity, rl.limit);

        // @dev Safe downcasts: `currentAmountInFlight + _amount <= limit` (bounded in setRateLimit),
        //      and block.timestamp < 2^32 until year 2106. Single-slot SSTORE.
        rl.amountInFlight = uint96(currentAmountInFlight + _amount);
        rl.lastUpdated = uint32(block.timestamp);
    }
}
