// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20.sol";
import {IDepositor} from "./IDepositor.sol";

/**
 * @title Depositor for the `BoringVault` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract BoringVaultDepositor is IDepositor {
    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();

    struct Asset {
        bool allowDeposits;
        bool allowWithdrawals;
        uint16 sharePremium;
    }

    /**
     * @notice Deposit function.
     * @param teller The address of the BoringVault's associated teller
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(address teller, bytes depositPayload) public {
        (
            address depositAsset,
            uint256 depositAmount,
        ) = abi.decode(
            depositPayload,
            (address, uint256)
        );

        // This amount should be encoded by the frontend, however, we should still guard against
        // it in case of a user-made call.
        if (depositAmount == 0) revert ZeroAssets();

        bytes4 selector = bytes4(keccak256(bytes("vault()")));
        boringVault = teller.call(abi.encodeWithSelector(selector));

        bytes4 selector = bytes4(keccak256(bytes("accountant()")));
        accountant = teller.call(abi.encodeWithSelector(selector));

        // Since we need to bypass the Teller contract, we need to take it upon ourselves to
        // perform all the necessary checks and the share conversion.
        uint256 oneShare = 10 ** ERC20(boringVault).decimals();

        // Retrieve the rate.
        bytes4 selector = bytes4(keccak256(bytes("getRateInQuoteSafe(address)")));
        uint256 rate = accountant.call(abi.encodeWithSelector(selector, depositAsset));

        // Retrieve asset info to understand the shares we should be asking back for.
        bytes4 selector = bytes4(keccak256(bytes("assetData()")));
        Asset asset = teller.call(abi.encodeWithSelector(selector, depositAsset));

        shares = depositAmount.mulDivDown(oneShare, rate);
        shares = asset.sharePremium > 0 ? shares.mulDivDown(1e4 - asset.sharePremium, 1e4) : shares;

        // Finally, call the vault.enter function.
        bytes4 selector = bytes4(keccak256(bytes("enter(address, address, uint256, address, uint256)")));
        vault.call(abi.encodeWithSelector(selector, _msgSender(), depositAsset, depositAmount, _msgSender(), 0));
    }
}
