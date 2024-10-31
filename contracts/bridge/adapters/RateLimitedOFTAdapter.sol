// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OFTAdapter} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTAdapter.sol";
import {RateLimiter} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/utils/RateLimiter.sol";
import {Origin} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {SendParam} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LBTC} from "../../LBTC/LBTC.sol";

contract RateLimitedOFTAdapter is OFTAdapter, RateLimiter {
    uint256 internal constant PAYLOAD_LENGTH = 228;

    /// @notice Emitted when a payload is processed.
    event PayloadProcessed(bytes payload);

    /// @notice Emitted when the payload length is invalid.
    error InvalidPayloadLength(bytes payload);

    constructor(
        address _token,
        address _lzEndpoint,
        address _delegate,
        address _owner
    ) OFTAdapter(_token, _lzEndpoint, _delegate) Ownable(_owner) {}

    /// ONLY OWNER FUNCTIONS ///
    function setRateLimits(
        RateLimitConfig[] memory _rateLimitConfigs
    ) external onlyOwner {
        super._setRateLimits(_rateLimitConfigs);
    }

    /// INTERNAL OVERRIDEN FUNCTIONS ///

    /**
     * @dev Add the payload to the message
     */
    function _buildMsgAndOptions(
        SendParam calldata _sendParam,
        uint256 _amountLD
    )
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        (message, options) = super._buildMsgAndOptions(_sendParam, _amountLD);
        // @dev Add the payload to the message
        message = abi.encodePacked(message, _sendParam.oftCmd);
        if (_sendParam.oftCmd.length != PAYLOAD_LENGTH) {
            revert InvalidPayloadLength(_sendParam.oftCmd);
        }
        return (message, options);
    }

    /**
     * @dev emits the payload
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address _executor, // @dev unused in the default implementation.
        bytes calldata _extraData // @dev unused in the default implementation.
    ) internal virtual override {
        // strip payload from message
        uint256 oftMessageLength = _message.length - PAYLOAD_LENGTH;
        super._lzReceive(
            _origin,
            _guid,
            _message[:oftMessageLength],
            _executor,
            _extraData
        );

        // emit the payload
        emit PayloadProcessed(_message[oftMessageLength:]);
    }

    /**
     * @inheritdoc OFTAdapter
     *
     * @dev burns tokens from the caller
     * @dev rate limits the amount of tokens that can be sent to the destination chain
     */
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

        (amountSentLD, amountReceivedLD) = super._debit(
            _from,
            _amountLD,
            _minAmountLD,
            _dstEid
        );

        // @dev burn the tokens received
        LBTC(address(innerToken)).burn(amountSentLD);
    }

    /**
     * @inheritdoc OFTAdapter
     */
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 /*_srcEid*/
    ) internal virtual override returns (uint256 amountReceivedLD) {
        // @dev Unlock the tokens and transfer to the recipient.
        LBTC(address(innerToken)).mint(_to, _amountLD);
        // @dev In the case of NON-default OFTAdapter, the amountLD MIGHT not be == amountReceivedLD.
        return _amountLD;
    }
}
