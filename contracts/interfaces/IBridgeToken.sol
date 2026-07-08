// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title IBridgeToken
/// @notice Interface for the Bridge Token (LBTC) with minting and burning capabilities.
interface IBridgeToken is IERC20Metadata {
    /// @notice Mints tokens to a specified address.
    /// @param to The address to receive the minted tokens.
    /// @param amount The amount of tokens to mint.
    /// @param feeAddress The address to receive the bridge fee.
    /// @param feeAmount The amount of the fee.
    /// @param originTxId The transaction ID from the source chain.
    /// @param originOutputIndex The output index from the source chain.
    function mint(
        address to,
        uint256 amount,
        address feeAddress,
        uint256 feeAmount,
        bytes32 originTxId,
        uint256 originOutputIndex
    ) external;

    /// @notice Unwraps tokens for bridging to another chain.
    /// @param amount The amount of tokens to unwrap.
    /// @param chainId The destination chain ID.
    function unwrap(uint256 amount, uint256 chainId) external;

    /// @notice Burns tokens from the caller's balance.
    /// @param value The amount of tokens to burn.
    function burn(uint256 value) external;

    /// @notice Burns tokens from a specified account.
    /// @param account The account from which tokens will be burned.
    /// @param value The amount of tokens to burn.
    function burnFrom(address account, uint256 value) external;
}
