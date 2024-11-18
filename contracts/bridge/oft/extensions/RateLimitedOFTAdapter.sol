// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {RateLimiter} from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";

abstract contract RateLimitedOFTAdapter is OFTAdapter, RateLimiter {
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
        _checkAndUpdateRateLimit(_dstEid, _amountLD);
        return super._debit(_from, _amountLD, _minAmountLD, _dstEid);
    }

    /**
     * @dev Sets the rate limits based on RateLimitConfig array. Only callable by the owner.
     * @param _rateLimitConfigs An array of RateLimitConfig structures defining the rate limits.
     */
    function setRateLimits(
        RateLimitConfig[] calldata _rateLimitConfigs
    ) external onlyOwner {
        _setRateLimits(_rateLimitConfigs);
    }
}
