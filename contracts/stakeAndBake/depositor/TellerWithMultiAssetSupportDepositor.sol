// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDepositor} from "./IDepositor.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TellerWithMultiAssetSupportMock} from "../../mock/TellerWithMultiAssetSupportMock.sol";

/**
 * @title Depositor for the `BoringVault` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract TellerWithMultiAssetSupportDepositor is IDepositor, ReentrancyGuard {
    using SafeERC20 for ERC20;

    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();
    error ApproveFailed();

    address public immutable teller;
    address public immutable depositAsset;

    constructor(address teller_, address depositAsset_) {
        teller = teller_;
        depositAsset = depositAsset_;
    }

    /**
     * @notice Deposit function.
     * @param owner The address of the user who will receive the shares
     * @param depositAmount The amount of tokens to deposit to the vault
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(
        address owner,
        uint256 depositAmount,
        bytes calldata depositPayload
    ) external nonReentrant {
        // Take the owner's LBTC.
        ERC20(depositAsset).safeTransferFrom(
            msg.sender,
            address(this),
            depositAmount
        );

        // Give the vault the needed allowance.
        address vault = destination();
        ERC20(depositAsset).safeIncreaseAllowance(vault, depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = ITeller(teller).deposit(
            ERC20(depositAsset),
            depositAmount,
            0
        );

        // Transfer vault shares to owner.
        ERC20(vault).safeTransfer(owner, shares);
    }

    /**
     * @notice Retrieves the final vault address. Used for granting allowance to the right address.
     */
    function destination() public returns (address) {
        return ITeller(teller).vault();
    }
}

/**
 * @title An interface over the TellerWithMultiAssetSupport contract.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
interface ITeller {
    function deposit(
        ERC20 depositAsset,
        uint256 depositAmount,
        uint256 minimumMint
    ) external returns (uint256);

    function vault() external view returns (address);
}
