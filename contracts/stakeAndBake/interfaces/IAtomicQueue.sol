// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev https://etherscan.io/address/0x3b4acd8879fb60586ccd74bc2f831a4c5e7dbbf8
interface IAtomicQueue {

    /// @notice Stores request information needed to fulfill a users atomic request.
    /// @param deadline unix timestamp for when request is no longer valid
    /// @param atomicPrice the price in terms of `want` asset the user wants their `offer` assets "sold" at
    /// @dev atomicPrice MUST be in terms of `want` asset decimals.
    /// @param offerAmount the amount of `offer` asset the user wants converted to `want` asset
    ///@param inSolve bool used during solves to prevent duplicate users, and to prevent redoing multiple checks
    struct AtomicRequest {
        uint64 deadline; // deadline to fulfill request
        uint88 atomicPrice; // In terms of want asset decimals
        uint96 offerAmount; // The amount of offer asset the user wants to sell.
        bool inSolve; // Indicates whether this user is currently having their request fulfilled.
    }

    /// @notice Mostly identical to `updateAtomicRequest` but with additional checks to ensure the request is safe.
    /// @notice Adds in accountant and discount to calculate a safe atomicPrice.
    /// @dev This function will completely ignore the provided atomic price and calculate a new one based off the    the accountant rate in quote and the discount provided.
    /// @param accountant the accountant to use to get the rate in quote
    /// @param discount the discount to apply to the rate in quote
    function safeUpdateAtomicRequest(
        IERC20 offer,
        IERC20 want,
        AtomicRequest memory userRequest,
        address accountant,
        uint256 discount
    ) external;
}
