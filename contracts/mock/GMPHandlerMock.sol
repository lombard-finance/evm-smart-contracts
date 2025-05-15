// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IHandler, IERC165} from "../gmp/IHandler.sol";
import {GMPUtils} from "../gmp/libs/GMPUtils.sol";

/// Dummy contract to return msgBody
contract GMPHandlerMock is IHandler {
    bool public enabled;

    event MessageReceived(bytes message);

    constructor(bool enabled_) {
        enabled = enabled_;
    }

    function handlePayload(
        GMPUtils.Payload memory payload
    ) external override returns (bytes memory) {
        require(enabled, "not enabled");
        emit MessageReceived(payload.msgBody);
        return payload.msgBody;
    }

    function enable() external {
        enabled = true;
    }

    function disable() external {
        enabled = false;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) external view override returns (bool) {
        return
            interfaceId == type(IHandler).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
