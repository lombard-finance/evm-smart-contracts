// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// @dev deprecated interface for bindings
interface IEfficientRateLimiterV1 {
    struct RateLimitConfig {
        uint32 eid;
        uint256 limit;
        uint256 window;
    }

    enum RateLimitDirection {
        Inbound,
        Outbound
    }

    function setRateLimits(
        RateLimitConfig[] calldata _rateLimitConfigs,
        RateLimitDirection direction
    ) external;
}
