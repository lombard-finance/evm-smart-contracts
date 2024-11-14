// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

abstract contract PausableOFTAdapter is OFTAdapter, Pausable {
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    )
        internal
        virtual
        override
        whenNotPaused
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        return super._debit(_from, _amountLD, _minAmountLD, _dstEid);
    }

    function pause() external whenNotPaused onlyOwner {
        _pause();
    }

    function unpause() external whenPaused onlyOwner {
        _unpause();
    }
}
