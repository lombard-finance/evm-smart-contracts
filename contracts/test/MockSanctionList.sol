// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ISanctionList} from "../strategy/interfaces/ISanctionList.sol";

/// @title MockSanctionList
/// @notice Configurable `ISanctionList` for tests.
contract MockSanctionList is ISanctionList {
    mapping(address => bool) private _sanctioned;

    function setSanctioned(address addr, bool value) external {
        _sanctioned[addr] = value;
    }

    function isSanctioned(address addr) external view returns (bool) {
        return _sanctioned[addr];
    }
}
