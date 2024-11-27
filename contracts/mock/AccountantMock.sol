// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Mock implementation of AccountantWithRateProviders
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract AccountantMock {
    function getRateInQuoteSafe(ERC20 quote) public pure returns (uint256 rateInQuote) {
        return 8;
    }
}
