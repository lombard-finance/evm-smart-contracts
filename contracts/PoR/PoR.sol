// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IPoR} from "./IPoR.sol";
contract PoR is AccessControlUpgradeable, IPoR {
    struct AddressData {
        string addressStr;
        bytes32 rootPkId;
        string messageOrDerivationData;
        bytes signature;
    }
    struct RootPubkeyData {
        bytes pubkey;
        /// @notice Number of derived from this root pubkey.
        uint256 derivedAddressesCount;
    }
    /// @custom:storage-location erc7201:lombardfinance.storage.PoR
    struct PORStorage {
        /// @notice Mapping from id to index in rootPubkeyData.
        /// @dev id is keccak256 of the pubkey
        mapping(bytes32 => RootPubkeyData) idToPubkeyData;
        /// @notice Data associated to each address.
        AddressData[] addressData;
        /// @notice Mapping to track index of each address.
        /// @dev contains index + 1 to avoid 0 index
        mapping(string => uint256) addressIndex;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.PoR")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 constant POR_STORAGE_LOCATION =
        0x2820bf7f0bcf92e901021c9470a614652331fbef5e77eebe7a3799436b598900;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    function initialize(address _owner) public initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
    }

    /// ACCESS CONTROL FUNCTIONS ///

    /// @notice Adds a root pubkey to the Proof of Reserve (PoR).
    /// @param _pubkey Root pubkey.
    function addRootPubkey(
        bytes calldata _pubkey
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_pubkey.length != 65) {
            revert InvalidRootPubkey();
        }
        PORStorage storage $ = _getPORStorage();
        bytes32 rootPkId = keccak256(_pubkey);
        if ($.idToPubkeyData[rootPkId].pubkey.length != 0) {
            revert RootPubkeyAlreadyExists(_pubkey);
        }
        $.idToPubkeyData[rootPkId] = RootPubkeyData({
            pubkey: _pubkey,
            derivedAddressesCount: 0
        });
    }

    /// @notice Deletes a root pubkey from the Proof of Reserve (PoR).
    /// @param _pubkey Root pubkey to delete.
    function deleteRootPubkey(
        bytes calldata _pubkey
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PORStorage storage $ = _getPORStorage();
        bytes32 rootPkId = keccak256(_pubkey);
        RootPubkeyData storage rootPubkeyData = $.idToPubkeyData[rootPkId];
        if (rootPubkeyData.pubkey.length == 0) {
            revert RootPubkeyDoesNotExist(_pubkey);
        }
        if (rootPubkeyData.derivedAddressesCount != 0) {
            revert RootPubkeyCannotBeDeleted();
        }
        delete $.idToPubkeyData[rootPkId];
    }

    /// @notice Adds multiple entries to the arrays.
    /// @param _addresses Array of addresses in string format.
    /// @param _rootPkIds Array of root pubkey ids.
    /// @param _messagesOrDerivationData Array of messages to sign or derivation paths.
    /// @param _signatures Array of signed messages.
    /// @dev _rootPkIds should be bytes32(0) if the address is not derived from a root pubkey.
    /// @dev _signatures should be empty if _rootPkIds is not empty as there is no message to sign.
    function addAddresses(
        string[] calldata _addresses,
        bytes32[] calldata _rootPkIds,
        string[] calldata _messagesOrDerivationData,
        bytes[] calldata _signatures
    ) external onlyRole(OPERATOR_ROLE) {
        if (
            _addresses.length != _rootPkIds.length ||
            _addresses.length != _messagesOrDerivationData.length ||
            _addresses.length != _signatures.length
        ) {
            revert ArrayLengthMismatch();
        }

        PORStorage storage $ = _getPORStorage(); // Access the storage

        for (uint256 i = 0; i < _addresses.length; i++) {
            // Check if address exists already
            if ($.addressIndex[_addresses[i]] != 0) {
                revert AddressAlreadyExists(_addresses[i]);
            }
            bool derived = _rootPkIds[i] != bytes32(0);
            if (derived && $.idToPubkeyData[_rootPkIds[i]].pubkey.length == 0) {
                revert InvalidRootPubkeyId(_rootPkIds[i]);
            }
            // Store data
            $.addressData.push(
                AddressData({
                    addressStr: _addresses[i],
                    rootPkId: _rootPkIds[i],
                    messageOrDerivationData: _messagesOrDerivationData[i],
                    signature: _signatures[i]
                })
            );
            $.addressIndex[_addresses[i]] = $.addressData.length; // Store the index + 1
            if (derived) {
                $.idToPubkeyData[_rootPkIds[i]].derivedAddressesCount++;
            }
        }
    }

    /// @notice Deletes multiple entries from the Proof of Reserve (PoR) by address.
    /// @dev Non-existing addresses are ignored.
    /// @param _addresses Array of addresses to delete from the PoR.
    function deleteAddresses(
        string[] calldata _addresses
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PORStorage storage $ = _getPORStorage(); // Access the storage

        uint256 length = $.addressData.length;
        for (uint256 i; i < _addresses.length; ) {
            string calldata _address = _addresses[i];
            uint256 index = $.addressIndex[_address]; // Get the index of the address
            if (index != 0) {
                bytes32 rootPkId = $.addressData[index - 1].rootPkId;
                if (rootPkId != bytes32(0)) {
                    $.idToPubkeyData[rootPkId].derivedAddressesCount--;
                }
                if (index != length) {
                    // Remove the address, message, and signature
                    $.addressData[index - 1] = $.addressData[length - 1];
                    $.addressIndex[
                        $.addressData[length - 1].addressStr
                    ] = index;
                }

                // remove data
                $.addressData.pop();
                delete $.addressIndex[_address];

                unchecked {
                    length--;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Updates messages and signatures for a given set of addresses.
    /// @dev Assumes messages are being added so signatures cannot be empty.
    /// @param _addresses Array of addresses to update.
    /// @param _messages Array of new messages.
    /// @param _signatures Array of new signatures.
    function updateMessageSignature(
        string[] calldata _addresses,
        string[] calldata _messages,
        bytes[] calldata _signatures
    ) external onlyRole(OPERATOR_ROLE) {
        PORStorage storage $ = _getPORStorage();

        if (
            _addresses.length != _messages.length ||
            _addresses.length != _signatures.length
        ) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i; i < _addresses.length; ) {
            uint256 index = $.addressIndex[_addresses[i]];
            if (index == 0) {
                revert AddressDoesNotExist(_addresses[i]);
            }
            if (bytes(_messages[i]).length == 0 && _signatures[i].length == 0) {
                revert InvalidMessageSignature(
                    _addresses[i],
                    _messages[i],
                    _signatures[i]
                );
            }
            AddressData storage addressData = $.addressData[index - 1];
            addressData.messageOrDerivationData = _messages[i];
            addressData.signature = _signatures[i];
            unchecked {
                ++i;
            }
        }
    }

    /// GETTERS ///

    /// @notice Returns the number of addresses in the Proof of Reserve (PoR).
    /// @return Number of addresses.
    function getPoRAddressListLength() external view returns (uint256) {
        return _getPORStorage().addressData.length;
    }

    /// @notice Returns data for a given set of addresses.
    /// @dev Default/empty data is returned for non-existing addresses.
    /// @param _addresses Array of addresses to get data for.
    /// @return rootPkIds Array of root pubkey ids.
    /// @return messagesOrPaths Array of messages or derivation paths.
    /// @return signatures Array of signatures.
    function getPoRSignatureMessages(
        string[] calldata _addresses
    )
        external
        view
        returns (bytes32[] memory, string[] memory, bytes[] memory)
    {
        PORStorage storage $ = _getPORStorage();

        bytes32[] memory rootPkIds = new bytes32[](_addresses.length);
        string[] memory messagesOrPaths = new string[](_addresses.length);
        bytes[] memory signatures = new bytes[](_addresses.length);

        for (uint256 i; i < _addresses.length; ) {
            uint256 index = $.addressIndex[_addresses[i]];
            if (index != 0) {
                AddressData storage addressData = $.addressData[index - 1];
                rootPkIds[i] = addressData.rootPkId;
                messagesOrPaths[i] = addressData.messageOrDerivationData;
                signatures[i] = addressData.signature;
            }
            unchecked {
                ++i;
            }
        }

        return (rootPkIds, messagesOrPaths, signatures);
    }

    /// @notice Returns addresses and data  in a range.
    /// @param _start Start index.
    /// @param _end End index.
    /// @return addresses Array of addresses.
    /// @return rootPkIds Array of root pubkey ids.
    /// @return messagesOrPaths Array of messages or derivation paths.
    /// @return signatures Array of signatures.
    function getPoRAddressSignatureMessages(
        uint256 _start,
        uint256 _end
    )
        external
        view
        returns (
            string[] memory,
            bytes32[] memory,
            string[] memory,
            bytes[] memory
        )
    {
        PORStorage storage $ = _getPORStorage();

        if (_end >= $.addressData.length) {
            _end = $.addressData.length - 1;
        }
        if (_start > _end) {
            return (
                new string[](0),
                new bytes32[](0),
                new string[](0),
                new bytes[](0)
            );
        }

        string[] memory addresses = new string[](_end - _start + 1);
        bytes32[] memory rootPkIds = new bytes32[](_end - _start + 1);
        string[] memory messagesOrPaths = new string[](_end - _start + 1);
        bytes[] memory signatures = new bytes[](_end - _start + 1);

        for (uint256 i; _start <= _end; ) {
            AddressData storage addressData = $.addressData[_start];
            addresses[i] = addressData.addressStr;
            rootPkIds[i] = addressData.rootPkId;
            messagesOrPaths[i] = addressData.messageOrDerivationData;
            signatures[i] = addressData.signature;
            unchecked {
                ++i;
                ++_start;
            }
        }

        return (addresses, rootPkIds, messagesOrPaths, signatures);
    }

    /// @notice Returns all addresses data.
    /// @return All addresses data.
    function getPoRAddressSignatureMessages()
        external
        view
        returns (AddressData[] memory)
    {
        PORStorage storage $ = _getPORStorage();
        return $.addressData;
    }

    /// @notice Function to get the storage reference
    function _getPORStorage() private pure returns (PORStorage storage $) {
        assembly {
            $.slot := POR_STORAGE_LOCATION
        }
    }

    /// @notice Returns public key for a given id
    /// @param _id Root pubkey id.
    function getRootPubkey(bytes32 _id) external view returns (bytes memory) {
        return _getPORStorage().idToPubkeyData[_id].pubkey;
    }
}
