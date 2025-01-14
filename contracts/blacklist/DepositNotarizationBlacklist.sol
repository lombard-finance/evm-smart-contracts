// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./IDepositNotarizationBlacklist.sol";

/**
 * @title DepositNotarizationBlacklist
 * @dev This contract allows to manage a blacklist of transaction outputs in order for notarization process
 * to ignore them.
 */
contract DepositNotarizationBlacklist is
    IDepositNotarizationBlacklist,
    AccessControlUpgradeable
{
    bytes32 public constant ADD_BLACKLIST_ROLE =
        keccak256("ADD_BLACKLIST_ROLE");
    bytes32 public constant REMOVE_BLACKLIST_ROLE =
        keccak256("REMOVE_BLACKLIST_ROLE");

    mapping(bytes32 => mapping(uint32 => bool)) internal _blacklist;

    /**
     * @dev Constructor that disables initializers to prevent the implementation contract from being initialized.
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract setting the first owner.
     * @param admin The address of the default admin.
     */
    function initialize(address admin) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Checks if a transaction output is blacklisted.
     * @param txId The transaction ID.
     * @param vout The output index.
     * @return True if the transaction output is blacklisted, false otherwise.
     */
    function isBlacklisted(
        bytes32 txId,
        uint32 vout
    ) external view returns (bool) {
        return _blacklist[txId][vout];
    }

    /**
     * @notice Adds transaction outputs to the blacklist.
     * @param txId The transaction ID.
     * @param vouts The array of output indices to be blacklisted.
     */
    function addToBlacklist(
        bytes32 txId,
        uint32[] calldata vouts
    ) external onlyRole(ADD_BLACKLIST_ROLE) {
        for (uint i = 0; i < vouts.length; i++) {
            if (_blacklist[txId][vouts[i]]) {
                revert AlreadyBlacklisted(txId, vouts[i]);
            }
            _blacklist[txId][vouts[i]] = true;
            emit Blacklisted(txId, vouts[i], msg.sender);
        }
    }

    /**
     * @notice Removes transaction outputs from the blacklist.
     * @param txId The transaction ID.
     * @param vouts The array of output indices to be blacklisted.
     */
    function removeFromBlacklist(
        bytes32 txId,
        uint32[] calldata vouts
    ) external onlyRole(REMOVE_BLACKLIST_ROLE) {
        for (uint i = 0; i < vouts.length; i++) {
            if (!_blacklist[txId][vouts[i]]) {
                revert AlreadyCleared(txId, vouts[i]);
            }
            _blacklist[txId][vouts[i]] = false;
            emit Cleared(txId, vouts[i], msg.sender);
        }
    }
}
