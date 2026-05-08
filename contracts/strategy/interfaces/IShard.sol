// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IShardExecValidator} from "./IShardExecValidator.sol";

/// @title IShard
/// @notice Errors and events shared by Shard and RemoteShard.
interface IShard {
    /// @dev Validator rejected `exec` for `(msg.sender, to, value, data, input)`.
    error Shard_CallNotAllowed();

    /// @dev Contract ETH balance (including `msg.value` on this call) is less than `value`.
    error Shard_InvalidEthFunding();

    /// @dev Thrown when a zero address is supplied for a shard parameter or configuration.
    error Shard_ZeroAddress();

    /// @dev `exec` target must not be this shard (`to == address(this)`).
    error Shard_ExecToSelfNotAllowed();

    /// @notice An `exec` call completed successfully (validator-gated or privileged overload).
    event Executed(
        address indexed caller,
        address indexed to,
        uint256 value,
        bytes data
    );

    /// @notice Plain ETH accepted in the shard's `receive` (pre-funding for `exec`).
    event EthReceived(address indexed from, uint256 amount);

    /// @notice The Merkle or other policy validator contract was replaced by admin.
    event ValidatorUpdated(
        IShardExecValidator indexed oldValidator,
        IShardExecValidator indexed newValidator
    );
}
