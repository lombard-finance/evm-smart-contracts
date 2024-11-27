// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDepositor} from "./IDepositor.sol";

/**
 * @title Depositor for the `TellerWithMultiAssetSupport` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract TellerWithMultiAssetSupportDepositor is IDepositor {
    /**
     * @notice Deposit function.
     * @param vault The address of the vault we deposit to
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(address vault, bytes depositPayload) public {
        (
            address tokenAddress,
            uint256 value,
            uint256 mininumMint
        ) = abi.decode(
            depositPayload,
            (address, uint256, uint256)
        );

        bytes4 selector = bytes4(keccak256(bytes("deposit(address, uint256, uint256)")));
        vault.call(abi.encodeWithSelector(selector, tokenAddress, uint256, uint256));
    }
}
