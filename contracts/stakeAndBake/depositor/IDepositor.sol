// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Interface to abstract over specifics of depositing into a vault.
 * This just makes sure that any vault contract allowed in the `StakeAndBake` contract
 * takes a variable size byte array so that we can independently specify the decoding
 * and contract call.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
interface IDepositor {
    /**
     * @notice Deposit function interface.
     * @param owner The address of the user who will receive the shares
     * @param depositPayload Optional ABI encoded parameters needed for a vault deposit call
     */
    function deposit(
        address owner,
        uint256 depositAmount,
        bytes calldata depositPayload
    ) external;

    /**
     * @notice Retrieves the final vault address. Used for granting `permit` to the right address.
     */
    function destination() external view returns (address);
}
