// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

interface IStakedLBTC is IBaseLBTC {
    event OperatorRoleTransferred(
        address indexed previousOperator,
        address indexed newOperator
    );
    event ClaimerUpdated(address indexed claimer, bool isClaimer);
}
