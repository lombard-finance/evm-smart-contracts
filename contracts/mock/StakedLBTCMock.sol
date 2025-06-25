// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";

/**
 * @title Mock implementation of StakedLBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract LBTCMock is LBTC {
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
