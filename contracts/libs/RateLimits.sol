// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library RateLimits {
    /**
     * @notice Rate Limit struct.
     * @param amountInFlight The amount in the current window.
     * @param lastUpdated Timestamp representing the last time the rate limit was checked or updated.
     * @param limit This represents the maximum allowed amount within a given window.
     * @param window Defines the duration of the rate limiting window.
     */
    struct Data {
        uint256 amountInFlight;
        uint256 lastUpdated;
        uint256 limit;
        uint256 window;
    }

    /**
     * @notice Rate Limit Configuration struct.
     * @param chainId The destination endpoint id.
     * @param limit This represents the maximum allowed amount within a given window.
     * @param window Defines the duration of the rate limiting window.
     */
    struct Config {
        bytes32 chainId;
        uint256 limit;
        uint256 window;
    }

    /// @notice Error that is thrown when an amount exceeds the rate_limit.
    error RateLimitExceeded();

    /// @notice Error that is thrown when a rate limit seems to be malformed.
    error MalformedRateLimit();

    function setRateLimit(Data storage rl, Config memory config) internal {
        // @dev Ensure we checkpoint the existing rate limit as to not retroactively apply the new decay rate.
        updateLimit(rl, 0);

        // @dev Does NOT reset the amountInFlight/lastUpdated of an existing rate limit.
        rl.limit = config.limit;
        rl.window = config.window;
    }

    function availableAmountToSend(
        Data memory rl
    )
        internal
        view
        returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)
    {
        return
            availableAmountToSend(
                rl.amountInFlight,
                rl.lastUpdated,
                rl.limit,
                rl.window
            );
    }

    /**
     * @notice Checks current amount in flight and amount that can be sent for a given rate limit window.
     * @param _amountInFlight The total amount that was in flight at the last update.
     * @param _lastUpdated Timestamp representing the last time the rate limit was checked or updated.
     * @param _limit The maximum allowable amount within the specified window
     * @param _window Defines the duration of the rate limiting window.
     * @return currentAmountInFlight The amount in the current window.
     * @return amountCanBeSent The amount that can be sent.
     */
    function availableAmountToSend(
        uint256 _amountInFlight,
        uint256 _lastUpdated,
        uint256 _limit,
        uint256 _window
    )
        internal
        view
        returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)
    {
        uint256 timeSinceLastDeposit = block.timestamp - _lastUpdated;
        if (timeSinceLastDeposit >= _window) {
            currentAmountInFlight = 0;
            amountCanBeSent = _limit;
        } else {
            uint256 decay = (_limit * timeSinceLastDeposit) / _window;
            currentAmountInFlight = _amountInFlight <= decay
                ? 0
                : _amountInFlight - decay;
            amountCanBeSent = _limit <= currentAmountInFlight
                ? 0
                : _limit - currentAmountInFlight;
        }
    }

    /**
     * @notice Verifies whether the specified amount falls within the rate limit constraints.
     * On successful verification, it updates amountInFlight and lastUpdated. If the amount exceeds
     * the rate limit, the operation reverts.
     * @param rl The rate limits to update.
     * @param _amount The amount to check and apply for rate limit constraints.
     */
    function updateLimit(Data storage rl, uint256 _amount) internal {
        (
            uint256 currentAmountInFlight,
            uint256 amountCanBeSent
        ) = availableAmountToSend(rl);
        if (_amount > amountCanBeSent) revert RateLimitExceeded();

        rl.amountInFlight = currentAmountInFlight + _amount;
        rl.lastUpdated = block.timestamp;
    }

    function checkRateLimitSanity(uint256 limit) internal pure {
        if (limit == 0) revert RateLimits.MalformedRateLimit();
    }
}
