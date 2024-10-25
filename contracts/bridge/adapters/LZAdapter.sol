// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AbstractAdapter} from "./AbstractAdapter.sol";
import {OFTAdapter} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTAdapter.sol";
import {SendParam, MessagingFee} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";

contract LZAdapter is AbstractAdapter {
    OFTAdapter oftAdapter;

    constructor(
        address oftAdapter_,
        address _lbtc,
        address _owner
    ) AbstractAdapter(_lbtc, _owner) {
        oftAdapter = OFTAdapter(oftAdapter_);
    }

    /// USER ACTIONS ///

    function getFee(
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) external view override returns (uint256) {
        MessagingFee memory fee = oftAdapter.quoteSend(
            _buildMessage(_toChain, _toAddress, _amount, _payload),
            false
        );
        return fee.nativeFee;
    }

    function deposit(
        address,
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) external payable override {
        // allow adapter to take the assets
        lbtc.approve(address(oftAdapter), _amount);

        SendParam memory sendParam = _buildMessage(
            _toChain,
            _toAddress,
            _amount,
            _payload
        );
        MessagingFee memory fee = oftAdapter.quoteSend(sendParam, false);
        if (msg.value < fee.nativeFee) {
            revert NotEnoughToPayFee(fee.nativeFee);
        }
        oftAdapter.send{value: msg.value}(sendParam, fee, msg.sender);
    }

    /// ONLY OWNER FUNCTIONS ///

    function _buildMessage(
        bytes32 _toChain,
        bytes32 _toAddress,
        uint256 _amount, 
        bytes memory _payload
    ) internal pure returns (SendParam memory) {
        return
            SendParam({
                dstEid: uint32(uint256(_toChain)), 
                to: _toAddress, 
                amountLD: _amount, 
                minAmountLD: 0,
                extraOptions: "", 
                composeMsg: "", 
                oftCmd: _payload // to emit on destination chain
            });
    }
}
