// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDepositor} from "./IDepositor.sol";

/**
 * @title Depositor for the `TellerWithMultiAssetSupport` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract TellerWithMultiAssetSupportDepositor is IDepositor {
    function deposit(address vault, bytes depositPayload) public {
        (
            address tokenAddress,
            uint256 value,
            uint256 mininumMint
        ) = abi.decode(
            depositPayload,
            (address, uint256, uint256)
        );

        TellerWithMultiAssetSupport teller = TellerWithMultiAssetSupport(vault);
        teller.deposit(tokenAddress, value, mininumMint);
    }
}
