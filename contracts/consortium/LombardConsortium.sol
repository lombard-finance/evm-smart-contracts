// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../libs/EIP1271SignatureUtils.sol";
import "./interfaces/ISignatureValidator.sol";

error SignatureValidationError();

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract LombardConsortium is Ownable2StepUpgradeable, IERC1271 {
    event PlayerAdded(address player);
    event PlayerRemoved(address player);
    event ApprovedHash(address indexed approver, bytes32 indexed hash);

    /// @title ConsortiumStorage
    /// @dev Struct to hold the consortium's state
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Mapping of addresses to their player status
        /// @dev True if the address is a player, false otherwise
        mapping(address => bool) players;

        /// @notice List of all player addresses
        /// @dev Used for iteration and maintaining order
        address[] playerList;

        /// @notice The current threshold for signature validation
        /// @dev Calculated as (2/3 * playerList.length) + 1, with floor rounding
        uint256 threshold;

        /// @notice Mapping of addresses to their approved hashes
        /// @dev A non-zero value indicates the hash is approved
        mapping(address => mapping(bytes32 => uint256)) approvedHashes;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

    /// @notice Retrieve the ConsortiumStorage struct from the specific storage slot
    function _getConsortiumStorage()
        private
        pure
        returns (ConsortiumStorage storage $)
    {
        assembly {
            $.slot := CONSORTIUM_STORAGE_LOCATION
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Internal initializer for the consortium with players
    /// @param _initialPlayers - The initial list of players
    function __Consortium_init(address[] memory _initialPlayers) internal onlyInitializing {
        //_setPlayers(_players);
        ConsortiumStorage storage $ = _getConsortiumStorage();
        for (uint i = 0; i < _initialPlayers.length; i++) {
            require(!$.players[_initialPlayers[i]], "Duplicate player");
             $.players[_initialPlayers[i]] = true;
            $.playerList.push(_initialPlayers[i]);
            emit PlayerAdded(_initialPlayers[i]);
        }
        _updateThreshold();
    }

    /// @notice Internal function to update threshold value
    function _updateThreshold() internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        $.threshold = ($.playerList.length * 2 / 3) + 1;
    }

    /// @notice Initializes the consortium contract with players and the owner key
    /// @param _players - The initial list of players
    /// @param _ownerKey - The address of the initial owner
    function initialize(address[] memory _players, address _ownerKey) external initializer {
        __Ownable_init(_ownerKey);
        __Ownable2Step_init();
        __Consortium_init(_players);
    }

    /// @notice Adds player from consortium
    /// @param _newPlayer - Player address to add
    function addPlayer(address _newPlayer) external onlyOwner {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        require(!$.players[_newPlayer], "Player already exists");
        $.players[_newPlayer] = true;
        $.playerList.push(_newPlayer);
        emit PlayerAdded(_newPlayer);
        _updateThreshold();
    }

    /// @notice Removes player from consortium
    /// @param _playerToRemove - Player address to remove
    function removePlayer(address _playerToRemove) external onlyOwner {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        require($.players[_playerToRemove], "Player not found");
        $.players[_playerToRemove] = false;
        for (uint i = 0; i < $.playerList.length; i++) {
            if ($.playerList[i] == _playerToRemove) {
                $.playerList[i] = $.playerList[$.playerList.length - 1];
                $.playerList.pop();
                break;
            }
        }
        emit PlayerRemoved(_playerToRemove);
        _updateThreshold();
    }

    /// @notice Approves a hash for the calling player
    /// @dev Only players can approve hashes
    /// @param hashToApprove The hash to be approved
     function approveHash(bytes32 hashToApprove) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        require($.players[msg.sender], "Only players can approve hashes");
        $.approvedHashes[msg.sender][hashToApprove] = 1;
        emit ApprovedHash(msg.sender, hashToApprove);
    }

    /// @notice Validates the provided signature against the given hash
    /// @dev Implements IERC1271
    /// @param hash The hash of the data to be signed
    /// @param signatures The signatures to validate
    /// @return magicValue The magic value (0x1626ba7e) if the signature is valid, 0 otherwise
    function isValidSignature(bytes32 hash, bytes memory signatures) external view override returns (bytes4) {
        try this.validateSignature(hash, signatures) returns (bool valid) {
            return valid ? EIP1271SignatureUtils.EIP1271_MAGICVALUE : EIP1271SignatureUtils.EIP1271_WRONGVALUE;
        } catch {
            revert SignatureValidationError();
        }
    }

    /**
     * @notice External wrapper for _isValidSignature to use with try/catch.
     * @param hash The hash of the data to be signed
     * @param signatures The signatures to validate
     * @return valid True if the signature is valid, false otherwise
     */
    function validateSignature(bytes32 hash, bytes memory signatures) external view returns (bool) {
        return _isValidSignature(hash, abi.encode(hash), signatures);
    }

    /**
     * @notice Checks whether the signature provided is valid for the provided data and hash. Reverts otherwise.
     * @dev Supports contract signatures, approved hashes, eth_sign, and standard ECDSA signatures.
     * Since the EIP-1271 does an external call, be mindful of reentrancy attacks.
     * @param dataHash Hash of the data (could be either a message hash or transaction hash)
     * @param data That should be signed (this is passed to an external validator contract)
     * @param signatures Signature data that should be verified.
     *                   Can be packed ECDSA signature ({bytes32 r}{bytes32 s}{uint8 v}), contract signature (EIP-1271) or approved hash.
     */
    function _isValidSignature(bytes32 dataHash, bytes memory data, bytes memory signatures) internal view returns (bool) {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        uint256 _threshold = $.threshold;
        require(_threshold > 0, "Threshold not set");
        require(signatures.length >= _threshold * 65, "Insufficient signature length");

        address lastOwner = address(0);
        address currentOwner;
        uint256 i;

        for (i = 0; i < _threshold; i++) {
            (uint8 v, bytes32 r, bytes32 s) = signatureSplit(signatures, i);
            if (v == 0) {
                // Contract signature
                currentOwner = address(uint160(uint256(r)));

                // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
                // This check is not completely accurate, since it is possible that more signatures than the threshold are send.
                // Here we only check that the pointer is not pointing inside the part that is being processed
                require(uint256(s) >= _threshold * 65, "Invalid contract signature pointer");

                // Check that signature data pointer (s) is in bounds (points to the length of data -> 32 bytes)
                require(uint256(s) + 32 <= signatures.length, "Invalid contract signature pointer");

                // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
                uint256 contractSignatureLen;
                assembly {
                    contractSignatureLen := mload(add(add(signatures, s), 0x20))
                }
                require(uint256(s) + 32 + contractSignatureLen <= signatures.length, "Invalid contract signature length");

                // Check if the contract signature is valid
                bytes memory contractSignature;
                assembly {
                    // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                    contractSignature := add(add(signatures, s), 0x20)
                }
                require(ISignatureValidator(currentOwner).isValidSignature(data, contractSignature) == EIP1271SignatureUtils.EIP1271_MAGICVALUE, "Invalid contract signature");
            } else if (v == 1) {
                // Approved hash
                currentOwner = address(uint160(uint256(r)));
                // Hashes are automatically approved by the sender of the message or when they have been pre-approved
                require(msg.sender == currentOwner || $.approvedHashes[currentOwner][dataHash] != 0, "Hash not approved");
            }
             else if (v > 30) {
                // Support eth_sign
                currentOwner = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s);
            } else {
                // Default ecrecover
                currentOwner = ecrecover(dataHash, v, r, s);
            }
            require(currentOwner > lastOwner && $.players[currentOwner], "Invalid signer or signature order");
            lastOwner = currentOwner;
        }

        return true;
    }

    /**
     * @notice Splits signature bytes into `uint8 v, bytes32 r, bytes32 s`
     * https://github.com/safe-global/safe-smart-account/blob/eccba0d2429c4531c1da9bdce09cce8e1fce950e/contracts/common/SignatureDecoder.sol#L21
     * @dev Make sure to perform a bounds check for @param pos, to avoid out of bounds access on @param signatures
     *      The signature format is a compact form of {bytes32 r}{bytes32 s}{uint8 v}
     *      Compact means uint8 is not padded to 32 bytes.
     * * @param signatures Concatenated {r, s, v} signatures.
     * @param pos Which signature to read.
     *            A prior bounds check of this parameter should be performed, to avoid out of bounds access.
     * @return v Recovery ID.
     * @return r Output value r of the signature.
     * @return s Output value s of the signature.
     */
    function signatureSplit(bytes memory signatures, uint256 pos) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        assembly {
            let signaturePos := mul(0x41, pos)
            r := mload(add(signatures, add(signaturePos, 0x20)))
            s := mload(add(signatures, add(signaturePos, 0x40)))
            v := byte(0, mload(add(signatures, add(signaturePos, 0x60))))
        }
    }

    /// @notice Returns the current list of players
    /// @return The array of player addresses
    function getPlayers() external view returns (address[] memory) {
        return _getConsortiumStorage().playerList;
    }

    /// @notice Returns the current threshold for valid signatures
    /// @return The threshold number of signatures required
    function getThreshold() external view returns (uint256) {
        return _getConsortiumStorage().threshold;
    }
}