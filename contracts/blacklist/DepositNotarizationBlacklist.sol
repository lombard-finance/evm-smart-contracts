// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

import "./IDepositNotarizationBlacklist.sol";

contract DepositNotarizationBlacklist is IDepositNotarizationBlacklist, Ownable2StepUpgradeable {
    
    mapping(bytes32 => mapping(uint256 => bool)) internal _blacklist;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(address firstOwner) initializer external {
        __Ownable_init(firstOwner);
    }

    function isBlacklisted(bytes32 txId, uint32 vout) external view returns (bool) {
        return _blacklist[txId][vout];
    }

    function addToBlacklist(bytes32 txId, uint32[] calldata vouts) external onlyOwner {
        for (uint i = 0; i < vouts.length; i++) {
            _blacklist[txId][vouts[i]] = true;
            emit Blacklisted(txId, vouts[i]);
        }
    }
}
