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

    /**
     * @notice Deposit function.
     * @param teller The address of the BoringVault's associated teller
     * @param owner The address of the user who will receive the shares
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(
        address teller,
        address owner,
        bytes calldata depositPayload
    ) external nonReentrant {
        (address depositAsset, uint256 depositAmount) = abi.decode(
            depositPayload,
            (address, uint256)
        );

        // Take the owner's LBTC.
        ERC20(depositAsset).safeTransferFrom(
            msg.sender,
            address(this),
            depositAmount
        );

        // Give the vault the needed allowance.
        address vault = this.destination(teller);
        ERC20(depositAsset).approve(vault, depositAmount);

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
    function destination(address teller) external returns (address) {
        bytes4 selector = bytes4(keccak256(bytes("vault()")));
        (bool success, bytes memory result) = teller.call(
            abi.encodeWithSelector(selector)
        );
        require(success);
        return abi.decode(result, (address));
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
}
