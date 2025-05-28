// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {GMPUtils} from "./libs/GMPUtils.sol";
import {MessagePath} from "./libs/MessagePath.sol";

interface IHandler is IERC165 {
    ///
    /// @return Could return some result, that will be emitted in `MessageHandled` event
    function handlePayload(
        GMPUtils.Payload memory
    ) external returns (bytes memory);
}
