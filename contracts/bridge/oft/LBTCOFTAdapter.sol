// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EfficientRateLimitedOFTAdapter} from "./EfficientRateLimitedOFTAdapter.sol";
import {IBaseLBTC} from "../../LBTC/interfaces/IBaseLBTC.sol";

contract LBTCOFTAdapter is EfficientRateLimitedOFTAdapter {
    constructor(
        address _token,
        address _lzEndpoint,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _owner) Ownable(_owner) {}

    /**
     * @dev Burns locked LBTC to prevent ability to withdraw from adapter.
     * Peer should be set to zero before calling this method.
     */
    function empty() external onlyOwner {
        IBaseLBTC(address(innerToken)).burn(
            innerToken.balanceOf(address(this))
        );
    }
}
