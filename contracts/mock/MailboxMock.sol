// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Mailbox} from "../gmp/Mailbox.sol";

/// Dummy contract to return msgBody
contract MailboxMock is Mailbox {
    // allow any payloadHash without signature verification
    function _verifyPayload(
        MailboxStorage storage $,
        bytes32 payloadHash,
        bytes calldata,
        bytes calldata
    ) internal virtual override {
        $.deliveredPayload[payloadHash] = true;
    }
}
