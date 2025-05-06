// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title An interface over the TellerWithMultiAssetSupport contract.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
interface ITeller {
    function deposit(
        IERC20 depositAsset,
        uint256 depositAmount,
        uint256 minimumMint
    ) external returns (uint256 shares);

    function bulkDeposit(
        IERC20 depositAsset,
        uint256 depositAmount,
        uint256 minimumMint,
        address to
    ) external returns (uint256 shares);

    function vault() external view returns (address);
}
