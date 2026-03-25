// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

interface IStakedLBTC is IBaseLBTC {
    /// @dev Used by `migrateToAccessControl` when arguments mismatch legacy state; also legacy custom errors.
    error UnauthorizedAccount(address account);
    event ClaimerUpdated(address indexed claimer, bool isClaimer);
    event PauserRoleTransferred(
        address indexed previousPauser,
        address indexed newPauser
    );
    event MinterUpdated(address indexed minter, bool isMinter);

    function mint(
        bytes calldata payload,
        bytes calldata proof
    ) external returns (address);

    function ratio() external view returns (uint256);

    function getRate() external view returns (uint256);
}
