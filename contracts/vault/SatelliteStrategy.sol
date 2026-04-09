// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IStrategyExecValidator} from "./IStrategyExecValidator.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title SatelliteStrategy
/// @notice Intermediary strategy without §B vault pipe (`docs/spec/002-strategy.md` §C).
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
