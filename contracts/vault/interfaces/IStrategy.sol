// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IStrategyExecValidator} from "./IStrategyExecValidator.sol";

/// @title IStrategy
/// @notice Errors and events shared by Strategy and SatelliteStrategy.
interface IStrategy {
    /// @dev Validator rejected `exec` for `(msg.sender, to, value, data, input)`.
    error Strategy_CallNotAllowed();

    /// @dev Contract ETH balance (including `msg.value` on this call) is less than `value`.
    error Strategy_InvalidEthFunding();

    /// @dev Thrown when a zero address is supplied for a strategy parameter or configuration.
    error Strategy_ZeroAddress();

    /// @notice An `exec` call completed successfully (validator-gated or privileged overload).
    event Executed(
        address indexed caller,
        address indexed to,
        uint256 value,
        bytes data
    );

    /// @notice The Merkle or other policy validator contract was replaced by admin.
    event ValidatorUpdated(
        IStrategyExecValidator indexed oldValidator,
        IStrategyExecValidator indexed newValidator
    );
}
