// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDepositor} from "../IDepositor.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Depositor for an ERC4626 vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract KilnDepositor is IDepositor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();
    error ApproveFailed();
    error UnauthorizedAccount(address account);
    error MinimumMintNotMet(uint256 minimumMint, uint256 shares);

    IERC4626 public immutable vault;
    IERC20 public immutable depositAsset;
    address public immutable stakeAndBake;

    constructor(IERC4626 vault_, IERC20 depositAsset_, address stakeAndBake_) {
        vault = vault_;
        depositAsset = depositAsset_;
        stakeAndBake = stakeAndBake_;
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
     * @dev depositPayload encodes the minimumMint for the vault
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
        depositAsset.safeIncreaseAllowance(address(vault), depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = vault.deposit(depositAmount, owner);

        // Ensure minimumMint is reached.
        if (shares < minimumMint) {
            revert MinimumMintNotMet(minimumMint, shares);
        }

        bytes memory ret = abi.encode(shares);
        return ret;
    }
}
