// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RateLimits} from "../../libs/RateLimits.sol";

/**
 * @title RateLimiter
 * @dev Abstract contract for implementing net rate limiting functionality.  This effectively allows two operations to
 * offset each others net impact (e.g., inflow v.s. outflow of assets).  It is designed to be inherited by other
 * contracts requiring rate limiting capabilities to protect resources or services from excessive use.
 * @dev A flexible rate limit that grows during congestive periods and shrinks during calm periods could give some
 * leeway when someone tries to forcefully congest the network, while still preventing huge amounts to be sent at once.
 */
abstract contract EfficientRateLimiter {
    // Tracks rate limits for outbound transactions to a dstEid.
    mapping(uint32 dstEid => RateLimits.Data limit) public outboundRateLimits;
    // Tracks rate limits for inbound transactions from a srcEid.
    mapping(uint32 srcEid => RateLimits.Data limit) public inboundRateLimits;

    // Define an enum to clearly distinguish between inbound and outbound rate limits.
    enum RateLimitDirection {
        Inbound,
        Outbound
    }

    /// @notice Emitted when a rate limit seems to be malformed.
    error MalformedRateLimit();

    /**
     * @notice Emitted when _setRateLimits occurs.
     * @param rateLimitConfigs An array of `RateLimits.Config` structs representing the rate limit configurations set per endpoint id.
     * - `eid`: The source / destination endpoint id (depending on direction).
     * - `limit`: This represents the maximum allowed amount within a given window.
     * - `window`: Defines the duration of the rate limiting window.
     * @param direction Specifies whether the outbound or inbound rates were changed.
     */
    event RateLimitsChanged(
        RateLimits.Config[] rateLimitConfigs,
        RateLimitDirection direction
    );

    /**
     * @notice Get the current amount that can be sent to this destination endpoint id for the given rate limit window.
     * @param _dstEid The destination endpoint id.
     * @return currentAmountInFlight The current amount that was sent in this window.
     * @return amountCanBeSent The amount that can be sent.
     */
    function getAmountCanBeSent(
        uint32 _dstEid
    )
        external
        view
        virtual
        returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)
    {
        RateLimits.Data storage orl = outboundRateLimits[_dstEid];
        return
            _amountCanBeSent(
                orl.amountInFlight,
                orl.lastUpdated,
                orl.limit,
                orl.window
            );
    }

    /**
     * @notice Get the current amount that can be received from the source endpoint id for the given rate limit window.
     * @param _srcEid The source endpoint id.
     * @return currentAmountInFlight The current amount that has been received in this window.
     * @return amountCanBeReceived The amount that can be received.
     */
    function getAmountCanBeReceived(
        uint32 _srcEid
    )
        external
        view
        virtual
        returns (uint256 currentAmountInFlight, uint256 amountCanBeReceived)
    {
        RateLimits.Data storage irl = inboundRateLimits[_srcEid];
        return
            _amountCanBeReceived(
                irl.amountInFlight,
                irl.lastUpdated,
                irl.limit,
                irl.window
            );
    }

    /**
     * @notice Sets the Rate Limits.
     * @param _rateLimitConfigs A `RateLimits.Config[]` array representing the rate limit configurations for either outbound or inbound.
     * @param direction Indicates whether the rate limits being set are for outbound or inbound.
     */
    function _setRateLimits(
        RateLimits.Config[] memory _rateLimitConfigs,
        RateLimitDirection direction
    ) internal virtual {
        for (uint256 i = 0; i < _rateLimitConfigs.length; i++) {
            RateLimits.Data storage rateLimit = direction ==
                RateLimitDirection.Outbound
                ? outboundRateLimits[_rateLimitConfigs[i].chainId]
                : inboundRateLimits[_rateLimitConfigs[i].chainId];

            // Checkpoint the existing rate limit to not retroactively apply the new decay rate.
            _checkAndUpdateRateLimit(
                _rateLimitConfigs[i].chainId,
                0,
                direction
            );

            if (
                rateLimit.limit == 0 ||
                rateLimit.limit == 2 ** 256 - 1 ||
                rateLimit.window == 0
            ) revert MalformedRateLimit();

            // Does NOT reset the amountInFlight/lastUpdated of an existing rate limit.
            rateLimit.limit = _rateLimitConfigs[i].limit;
            rateLimit.window = _rateLimitConfigs[i].window;
        }
        emit RateLimitsChanged(_rateLimitConfigs, direction);
    }

    /**
     * @notice Checks current amount in flight and amount that can be sent for a given rate limit window.
     * @param _amountInFlight The amount in the current window.
     * @param _lastUpdated Timestamp representing the last time the rate limit was checked or updated.
     * @param _limit This represents the maximum allowed amount within a given window.
     * @param _window Defines the duration of the rate limiting window.
     * @return currentAmountInFlight The amount in the current window.
     * @return amountCanBeSent The amount that can be sent.
     */
    function _amountCanBeSent(
        uint256 _amountInFlight,
        uint256 _lastUpdated,
        uint256 _limit,
        uint256 _window
    )
        internal
        view
        virtual
        returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)
    {
        (currentAmountInFlight, amountCanBeSent) = RateLimits
            .availableAmountToSend(
                _amountInFlight,
                _lastUpdated,
                _limit,
                _window
            );
    }

    /**
     * @notice Checks current amount in flight and amount that can be sent for a given rate limit window.
     * @param _amountInFlight The amount in the current window.
     * @param _lastUpdated Timestamp representing the last time the rate limit was checked or updated.
     * @param _limit This represents the maximum allowed amount within a given window.
     * @param _window Defines the duration of the rate limiting window.
     * @return currentAmountInFlight The amount in the current window.
     * @return amountCanBeReceived The amount that can be received.
     */
    function _amountCanBeReceived(
        uint256 _amountInFlight,
        uint256 _lastUpdated,
        uint256 _limit,
        uint256 _window
    )
        internal
        view
        virtual
        returns (uint256 currentAmountInFlight, uint256 amountCanBeReceived)
    {
        (currentAmountInFlight, amountCanBeReceived) = RateLimits
            .availableAmountToSend(
                _amountInFlight,
                _lastUpdated,
                _limit,
                _window
            );
    }

    /**
     * @notice Checks and updates the rate limit based on the endpoint ID and amount.
     * @param _eid The endpoint ID for which the rate limit needs to be checked and updated.
     * @param _amount The amount to add to the current amount in flight.
     * @param direction The direction (Outbound or Inbound) of the rate limits being checked.
     */
    function _checkAndUpdateRateLimit(
        uint32 _eid,
        uint256 _amount,
        RateLimitDirection direction
    ) internal {
        // Select the correct mapping based on the direction of the rate limit
        RateLimits.Data storage rl = direction == RateLimitDirection.Outbound
            ? outboundRateLimits[_eid]
            : inboundRateLimits[_eid];

        // Calculate current amount in flight and available capacity
        (uint256 currentAmountInFlight, uint256 availableCapacity) = RateLimits
            .availableAmountToSend(
                rl.amountInFlight,
                rl.lastUpdated,
                rl.limit,
                rl.window
            );

        // Check if the requested amount exceeds the available capacity
        if (_amount > availableCapacity) {
            revert RateLimits.RateLimitExceeded();
        }

        // Update the rate limit with the new amount in flight and the current timestamp
        rl.amountInFlight = currentAmountInFlight + _amount;
        rl.lastUpdated = block.timestamp;

        RateLimits.Data storage oppositeRL = direction ==
            RateLimitDirection.Outbound
            ? inboundRateLimits[_eid]
            : outboundRateLimits[_eid];
        (
            uint256 otherCurrentAmountInFlight,
            uint256 otherAvailableCapacity
        ) = RateLimits.availableAmountToSend(
                oppositeRL.amountInFlight,
                oppositeRL.lastUpdated,
                oppositeRL.limit,
                oppositeRL.window
            );
        unchecked {
            oppositeRL.amountInFlight = otherCurrentAmountInFlight > _amount
                ? otherCurrentAmountInFlight - _amount
                : 0;
        }
        oppositeRL.lastUpdated = block.timestamp;
    }
}
