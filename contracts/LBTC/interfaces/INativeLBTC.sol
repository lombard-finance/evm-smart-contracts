// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

interface INativeLBTC is IBaseLBTC {
    error FeeGreaterThanAmount();
}
