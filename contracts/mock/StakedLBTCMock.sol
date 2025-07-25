// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StakedLBTC} from "../LBTC/StakedLBTC.sol";

/**
 * @title Mock implementation of StakedLBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract StakedLBTCMock is StakedLBTC {
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
