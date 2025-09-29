// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDepositor} from "../IDepositor.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITeller} from "./ITeller.sol";

/**
 * @title Depositor for the `BoringVault` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract TellerWithMultiAssetSupportDepositor is IDepositor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();
    error ApproveFailed();
    error UnauthorizedAccount(address account);

    ITeller public immutable teller;
    IERC20 public immutable depositAsset;
    address public immutable stakeAndBake;
    address public immutable vault;

    constructor(ITeller teller_, IERC20 depositAsset_, address stakeAndBake_) {
        teller = teller_;
        depositAsset = depositAsset_;
        stakeAndBake = stakeAndBake_;
        address vault_ = teller.vault();
        vault = vault_;
    }

    modifier onlyStakeAndBake() {
        if (stakeAndBake != msg.sender) {
            revert UnauthorizedAccount(msg.sender);
        }
        _;
    }

    /**
     * @notice Deposit function.
     * @param owner The address of the user who will receive the shares
     * @param depositAmount The amount of tokens to deposit to the vault
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     * @return Number of shares minted for deposit
     * @dev depositPayload encodes the minimumMint for the teller
     */
    function deposit(
        address owner,
        uint256 depositAmount,
        bytes calldata depositPayload
    ) external nonReentrant onlyStakeAndBake returns (bytes memory) {
        uint256 minimumMint = abi.decode(depositPayload, (uint256));

        // Take the owner's LBTC.
        depositAsset.safeTransferFrom(msg.sender, address(this), depositAmount);

        // Give the vault the needed allowance.
        depositAsset.safeIncreaseAllowance(vault, depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = teller.bulkDeposit(
            depositAsset,
            depositAmount,
            minimumMint,
            owner
        );

        bytes memory ret = abi.encode(shares);
        return ret;
    }
}
