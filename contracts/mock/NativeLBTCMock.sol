// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NativeLBTC} from "../LBTC/NativeLBTC.sol";

/**
 * @title Mock implementation of NativeLBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract NativeLBTCMock is NativeLBTC {
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
