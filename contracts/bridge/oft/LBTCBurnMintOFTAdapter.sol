// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter, SafeERC20, IERC20} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {RateLimitedOFTAdapter} from "./extensions/RateLimitedOFTAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ILBTC} from "../../LBTC/ILBTC.sol";


contract LBTCBurnMintOFTAdapter is OFTAdapter, RateLimitedOFTAdapter {
    using SafeERC20 for IERC20;

    constructor(
        address _token,
        address _lzEndpoint,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _owner) Ownable(_owner) {}

    function approvalRequired() external pure virtual override returns (bool) {
        return false;
    }

    /**
     * @dev Burns tokens from the sender's specified balance in this contract.
     * @param _from The address to debit from.
     * @param _amountLD The amount of tokens to send in local decimals.
     * @param _minAmountLD The minimum amount to send in local decimals.
     * @param _dstEid The destination chain ID.
     * @return amountSentLD The amount sent in local decimals.
     * @return amountReceivedLD The amount received in local decimals on the remote.
     */
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    )
        internal
        virtual
        override(OFTAdapter, RateLimitedOFTAdapter)
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        _checkAndUpdateRateLimit(_dstEid, _amountLD);
        (amountSentLD, amountReceivedLD) = _debitView(
            _amountLD,
            _minAmountLD,
            _dstEid
        );
        ILBTC(address(innerToken)).burn(_from, amountSentLD);
    }

    /**
     * @dev Credits tokens to the specified address.
     * @param _to The address to credit the tokens to.
     * @param _amountLD The amount of tokens to credit in local decimals.
     * @dev _srcEid The source chain ID.
     * @return amountReceivedLD The amount of tokens ACTUALLY received in local decimals.
     */
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 /*_srcEid*/
    ) internal virtual override returns (uint256 amountReceivedLD) {
        // @dev Mint the tokens and transfer to the recipient.
        ILBTC(address(innerToken)).mint(_to, _amountLD);
        return _amountLD;
    }
}
