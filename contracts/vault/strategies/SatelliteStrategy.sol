// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title SatelliteStrategy
/// @notice Strategy deployment using only validator-gated `exec` (no `pullFromVault` / `pushToVault` vault wiring).
/// @dev Use when outbound liquidity is handled purely via approved external calls rather than `IVault.requestFunding`.
contract SatelliteStrategy is StrategyBaseUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param validator_ Policy validator (`IStrategyExecValidator`).
    /// @param defaultAdmin_ Receives `DEFAULT_ADMIN_ROLE`.
    function initialize(
        IStrategyExecValidator validator_,
        address defaultAdmin_
    ) external initializer {
        __StrategyBase_init(validator_, defaultAdmin_);
    }
}
