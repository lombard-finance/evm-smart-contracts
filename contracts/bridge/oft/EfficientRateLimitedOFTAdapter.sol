// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {EfficientRateLimiter} from "./EfficientRateLimiter.sol";
import {RateLimits} from "../../libs/RateLimits.sol";

/**
 * @title OFT Adapter contract with EfficientRateLimiter
 */
abstract contract EfficientRateLimitedOFTAdapter is
    OFTAdapter,
    EfficientRateLimiter
{
    /**
     * @notice Sets the cross-chain tx rate limits for specific endpoints based on provided configurations.
     * It allows configuration of rate limits either for outbound or inbound directions.
     * This method is designed to be called by contract admins for updating the system's rate limiting behavior.
     *
     * @param _rateLimitConfigs An array of `RateLimits.Config` structs that specify the new rate limit settings.
     * Each struct includes an endpoint ID, the limit value, and the window duration.
     * @param direction The direction (`Outbound` or `Inbound`) specifies whether the endpoint ID passed should be considered a dstEid or srcEid.
     * This parameter determines which set of rate limits (outbound or inbound) will be updated for each endpoint.
     */
    function setRateLimits(
        RateLimits.Config[] calldata _rateLimitConfigs,
        RateLimitDirection direction
    ) external onlyOwner {
        _setRateLimits(_rateLimitConfigs, direction);
    }

    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    )
        internal
        virtual
        override
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        (amountSentLD, amountReceivedLD) = super._debit(
            _from,
            _amountLD,
            _minAmountLD,
            _dstEid
        );
        // Check and update the rate limit based on the destination endpoint ID (dstEid) and the amount in local decimals.
        _checkAndUpdateRateLimit(
            _dstEid,
            amountSentLD,
            RateLimitDirection.Outbound
        );
        return (amountSentLD, amountReceivedLD);
    }

    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 _srcEid
    ) internal virtual override returns (uint256 amountReceivedLD) {
        // Check and update the rate limit based on the source endpoint ID (srcEid) and the amount in local decimals from the message.
        _checkAndUpdateRateLimit(
            _srcEid,
            _amountLD,
            RateLimitDirection.Inbound
        );
        amountReceivedLD = super._credit(_to, _amountLD, _srcEid);
        return amountReceivedLD;
    }
}
