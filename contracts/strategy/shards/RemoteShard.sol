// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IShardExecValidator} from "../interfaces/IShardExecValidator.sol";
import {ShardBaseUpgradeable} from "./ShardBaseUpgradeable.sol";

/// @title RemoteShard
/// @notice Shard deployment using only validator-gated `exec` (no `pullFromStrategy` / `pushToStrategy` strategy wiring).
/// @dev Use when outbound liquidity is handled purely via approved external calls rather than `IStrategy.requestFunding`.
contract RemoteShard is ShardBaseUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param validator_ Policy validator (`IShardExecValidator`).
    /// @param defaultAdmin_ Receives `DEFAULT_ADMIN_ROLE`.
    function initialize(
        IShardExecValidator validator_,
        address defaultAdmin_
    ) external initializer {
        __ShardBase_init(validator_, defaultAdmin_);
    }
}
