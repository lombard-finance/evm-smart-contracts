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

    error Strategy_ZeroAddress();

    event Executed(
        address indexed caller,
        address indexed to,
        uint256 value,
        bytes data
    );

    event ValidatorUpdated(
        IStrategyExecValidator indexed oldValidator,
        IStrategyExecValidator indexed newValidator
    );
}
