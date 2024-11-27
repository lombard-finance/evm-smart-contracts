// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IDepositor} from "./IDepositor.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

/**
 * @title Depositor for the `BoringVault` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract BoringVaultDepositor is IDepositor {
    using FixedPointMathLib for uint256;

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
    function deposit(address teller, bytes calldata depositPayload) external {
        (
            address depositAsset,
            uint256 depositAmount
        ) = abi.decode(
            depositPayload,
            (address, uint256)
        );

        // This amount should be encoded by the frontend, however, we should still guard against
        // it in case of a user-made call.
        if (depositAmount == 0) revert ZeroAssets();

        bytes4 selector = bytes4(keccak256(bytes("vault()")));
        (bool success, bytes memory result) = teller.call(abi.encodeWithSelector(selector));
        require(success);
        address boringVault = abi.decode(result, (address));

        selector = bytes4(keccak256(bytes("accountant()")));
        (success, result) = teller.call(abi.encodeWithSelector(selector));
        require(success);
        address accountant = abi.decode(result, (address));

        // Since we need to bypass the Teller contract, we need to take it upon ourselves to
        // perform all the necessary checks and the share conversion.
        uint256 oneShare = 10 ** ERC20(boringVault).decimals();

        // Retrieve the rate.
        selector = bytes4(keccak256(bytes("getRateInQuoteSafe(address)")));
        (success, result) = accountant.call(abi.encodeWithSelector(selector, depositAsset));
        require(success);
        uint256 rate = abi.decode(result, (uint256));

        // Retrieve asset info to understand the shares we should be asking back for.
        selector = bytes4(keccak256(bytes("assetData()")));
        (success, result) = teller.call(abi.encodeWithSelector(selector, depositAsset));
        require(success);
        Asset memory asset = abi.decode(result, (Asset));

        uint256 shares = depositAmount.mulDivDown(oneShare, rate);
        shares = asset.sharePremium > 0 ? shares.mulDivDown(1e4 - asset.sharePremium, 1e4) : shares;

        // Finally, call the vault.enter function.
        selector = bytes4(keccak256(bytes("enter(address, address, uint256, address, uint256)")));
        (success,) = boringVault.call(abi.encodeWithSelector(selector, tx.origin, depositAsset, depositAmount, tx.origin, 0));
        require(success);
    }
}
