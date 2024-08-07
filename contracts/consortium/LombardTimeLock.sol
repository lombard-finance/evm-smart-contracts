// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title Use for Consortium 
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol. Executor is EOA controlled by decentralized consortium consensus mechanism.
 */
contract LombardTimeLock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors
    ) TimelockController(minDelay, proposers, executors, address(0)) {}
}