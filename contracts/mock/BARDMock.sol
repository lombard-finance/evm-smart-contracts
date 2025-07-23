// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BARD} from "../BARD/BARD.sol";

/**
 * @title Mock implementation of LBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract BARDMock is BARD {
    constructor() BARD(address(1), address(2)) {}
}
