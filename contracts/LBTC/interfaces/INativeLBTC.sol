// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

/// @custom:security-contact security@lombard.finance
interface INativeLBTC is IBaseLBTC {
    error FeeGreaterThanAmount();

    function mintV1(bytes calldata rawPayload, bytes calldata proof) external;
}
