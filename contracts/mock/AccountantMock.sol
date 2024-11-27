// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20.sol";

/**
 * @title Mock implementation of AccountantWithRateProviders
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract AccountantMock {
    function getRateInQuote(ERC20 quote) public view returns (uint256 rateInQuote) {
        if (address(quote) == address(base)) {
            rateInQuote = accountantState.exchangeRate;
        } else {
            RateProviderData memory data = rateProviderData[quote];
            uint8 quoteDecimals = ERC20(quote).decimals();
            uint256 exchangeRateInQuoteDecimals = changeDecimals(accountantState.exchangeRate, decimals, quoteDecimals);
            if (data.isPeggedToBase) {
                rateInQuote = exchangeRateInQuoteDecimals;
            } else {
                uint256 quoteRate = data.rateProvider.getRate();
                uint256 oneQuote = 10 ** quoteDecimals;
                rateInQuote = oneQuote.mulDivDown(exchangeRateInQuoteDecimals, quoteRate);
            }
        }
    }
}
