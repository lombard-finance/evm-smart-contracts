// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

interface IStakedLBTC is IBaseLBTC {
    error UnauthorizedAccount(address account);

    event OperatorRoleTransferred(
        address indexed previousOperator,
        address indexed newOperator
    );
    event ClaimerUpdated(address indexed claimer, bool isClaimer);
    event PauserRoleTransferred(
        address indexed previousPauser,
        address indexed newPauser
    );
    event MinterUpdated(address indexed minter, bool isMinter);

    function mint(bytes calldata payload, bytes calldata proof) external;
}
