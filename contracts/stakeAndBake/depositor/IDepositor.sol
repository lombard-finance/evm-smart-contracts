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
     * @param vault The address of the vault we deposit to
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(address vault, bytes calldata depositPayload) external;
}
