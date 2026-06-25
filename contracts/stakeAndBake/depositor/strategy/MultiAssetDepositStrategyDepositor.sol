// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDepositor} from "../IDepositor.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMultiAssetDeposit} from "../../../strategy/interfaces/IMultiAssetDeposit.sol";

/**
 * @title Depositor for Lombard MultiAssetDeposit Strategy.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract MultiAssetDepositStrategyDepositor is IDepositor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error UnauthorizedAccount(address account);

    IMultiAssetDeposit public immutable strategy;
    IERC20 public immutable depositAsset;
    address public immutable stakeAndBake;

    constructor(
        IMultiAssetDeposit strategy_,
        IERC20 depositAsset_,
        address stakeAndBake_
    ) {
        strategy = strategy_;
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

        // Take the SnB's depositAsset
        depositAsset.safeTransferFrom(msg.sender, address(this), depositAmount);

        // Give the strategy the needed allowance.
        depositAsset.safeIncreaseAllowance(address(strategy), depositAmount);

        // Deposit and obtain strategy shares.
        return
            abi.encode(
                strategy.deposit(
                    address(depositAsset),
                    depositAmount,
                    owner,
                    minimumMint
                )
            );
    }
}
