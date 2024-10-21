// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract PoR is AccessControlUpgradeable {
    /// @custom:storage-location erc7201:lombardfinance.storage.PoR
    struct PORStorage {
        /// @notice Addresses in string format. Can be any type of address.
        string[] addressStr;
        /// @notice Messages to sign or derivation paths.
        string[] messageOrPath;
        /// @notice Signed messages.
        /// @dev If the signature is empty, messageOrPath contains a derivation path.
        bytes[] signature;
        /// @notice Mapping to track index of each address.
        /// @dev contains index + 1 to avoid 0 index
        mapping(string => uint256) addressIndex;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.PoR")) - 1)) & ~bytes32(uint256(0xff))
    bytes32  constant POR_STORAGE_LOCATION = 
        0x2820bf7f0bcf92e901021c9470a614652331fbef5e77eebe7a3799436b598900;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Error thrown when the lengths of the arrays do not match.
    error ArrayLengthMismatch();
    
    /// @notice Error thrown when the address already exists.
    error AddressAlreadyExists(string addressStr);

    /// @notice Error thrown when the range is invalid.
    error InvalidRange();

    /// @notice Error thrown when the address does not exist.
    error AddressDoesNotExist(string addressStr);

    /// @notice Error thrown when the message or signature is invalid.
    error InvalidMessageSignature(string addressStr, string messageOrPath, bytes signature);

    function initialize(address _owner) public initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
    }

    /// ACCESS CONTROL FUNCTIONS ///

    /// @notice Adds multiple entries to the arrays.
    /// @param _addresses Array of addresses in string format.
    /// @param _messagesOrPaths Array of messages to sign or derivation paths.
    /// @param _signatures Array of signed messages.
    function addAddresses(
        string[] calldata _addresses,
        string[] calldata _messagesOrPaths,
        bytes[] calldata _signatures
    ) external onlyRole(OPERATOR_ROLE) {
        if (_addresses.length != _messagesOrPaths.length || _addresses.length != _signatures.length) {
            revert ArrayLengthMismatch();
        }

        PORStorage storage $ = _getPORStorage(); // Access the storage

        for (uint256 i = 0; i < _addresses.length; i++) {
            // Check if address exists already
            if($.addressIndex[_addresses[i]] != 0) {
                revert AddressAlreadyExists(_addresses[i]);
            }
            // Store data
            $.addressStr.push(_addresses[i]);
            $.messageOrPath.push(_messagesOrPaths[i]);
            $.signature.push(_signatures[i]);
            $.addressIndex[_addresses[i]] = $.addressStr.length; // Store the index + 1
        }
    }

    /// @notice Deletes multiple entries from the Proof of Reserve (PoR) by address.
    /// @dev Non-existing addresses are ignored.
    /// @param _addresses Array of addresses to delete from the PoR.
    function deleteAddresses(string[] calldata _addresses) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PORStorage storage $ = _getPORStorage(); // Access the storage

        uint256 length = $.addressStr.length;
        for (uint256 i; i < length;) {
            string calldata _address = _addresses[i];
            uint256 index = $.addressIndex[_address]; // Get the index of the address
            if(index != 0) {
                if(index != length) {
                    // Remove the address, message, and signature
                    $.addressStr[index - 1] = $.addressStr[length - 1];
                    $.messageOrPath[index - 1] = $.messageOrPath[length - 1];
                    $.signature[index - 1] = $.signature[length - 1];
                    $.addressIndex[$.addressStr[length - 1]] = index;
                }

                // remove data
                $.addressStr.pop();
                $.messageOrPath.pop();
                $.signature.pop();
                delete $.addressIndex[_address];

                unchecked { length--; }
            }
            unchecked { ++i; }
        }
    }

    /// @notice Updates messages and signatures for a given set of addresses.
    /// @dev Assumes messages are being added so signatures cannot be empty.
    /// @param _addresses Array of addresses to update.
    /// @param _messages Array of new messages.
    /// @param _signatures Array of new signatures.
    function updateMessageSignature(string[] calldata _addresses, string[] calldata _messages, bytes[] calldata _signatures) external onlyRole(OPERATOR_ROLE) {
        PORStorage storage $ = _getPORStorage();

        if (_addresses.length != _messages.length || _addresses.length != _signatures.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i; i < _addresses.length;) {
            uint256 index = $.addressIndex[_addresses[i]];
            if(index == 0) {
                revert AddressDoesNotExist(_addresses[i]);
            }
            if(bytes(_messages[i]).length == 0 || _signatures[i].length == 0) {
                revert InvalidMessageSignature(_addresses[i], _messages[i], _signatures[i]);
            }
            $.messageOrPath[index - 1] = _messages[i];
            $.signature[index - 1] = _signatures[i];
            unchecked { ++i; }
        }
    }

    /// GETTERS ///

    /// @notice Returns data for a given set of addresses.
    /// @dev Default/empty data is returned for non-existing addresses.
    /// @param _addresses Array of addresses to get data for.
    /// @return messagesOrPaths Array of messages or derivation paths.
    /// @return signatures Array of signatures.
    function getPoRSignatureMessages(string[] calldata _addresses) external view returns (string[] memory, bytes[] memory) {
        PORStorage storage $ = _getPORStorage();

        string[] memory messagesOrPaths = new string[](_addresses.length);
        bytes[] memory signatures = new bytes[](_addresses.length);

        for (uint256 i; i < _addresses.length;) {
            uint256 index = $.addressIndex[_addresses[i]];
            if(index != 0) {
                messagesOrPaths[i] = $.messageOrPath[index - 1];
                signatures[i] = $.signature[index - 1];
            }
            unchecked { ++i; }
        }

        return (messagesOrPaths, signatures);
    }

    /// @notice Returns addresses and data  in a range.
    /// @param _start Start index.
    /// @param _end End index.
    /// @return addresses Array of addresses.
    /// @return messagesOrPaths Array of messages or derivation paths.
    /// @return signatures Array of signatures.
    function getPoRAddressSignatureMessages(uint256 _start, uint256 _end) public view returns (string[] memory, string[] memory, bytes[] memory) {
        PORStorage storage $ = _getPORStorage();

        if(_end >= $.addressStr.length) {
            _end = $.addressStr.length - 1;
        }
        if(_start > _end) {
            revert InvalidRange();
        }   

        string[] memory addresses = new string[](_end - _start + 1);
        string[] memory messagesOrPaths = new string[](_end - _start + 1);
        bytes[] memory signatures = new bytes[](_end - _start + 1); 

        for(uint256 i; _start <= _end;) {
            addresses[i] = $.addressStr[_start];
            messagesOrPaths[i] = $.messageOrPath[_start];
            signatures[i] = $.signature[_start];
            unchecked { ++i; ++_start; }
        }

        return (addresses, messagesOrPaths, signatures);
    }

    /// @notice Returns all addresses data.
    /// @return addresses Array of addresses.
    /// @return messagesOrPaths Array of messages or derivation paths.
    /// @return signatures Array of signatures.
    function getPoRAddressSignatureMessages() external view returns (string[] memory, string[] memory, bytes[] memory) {
        return getPoRAddressSignatureMessages(0, type(uint256).max); // avoid extra storage access
    }

    /// @notice Function to get the storage reference
    function _getPORStorage() private pure returns (PORStorage storage $) {
        assembly {
            $.slot := POR_STORAGE_LOCATION
        }
    }
}
