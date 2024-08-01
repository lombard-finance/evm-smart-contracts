// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "../libs/EIP1271SignatureUtils.sol";

error LombardConsortium__SignatureValidationError();

/// @dev Error thrown when trying to initialize with too few players
error LombardConsortium__InsufficientInitialPlayers(uint256 provided, uint256 minimum);

/// @dev Error thrown when trying to initialize or add players exceeding the maximum limit
error LombardConsortium__TooManyPlayers(uint256 provided, uint256 maximum);

/// @dev Error thrown when trying to add a player that already exists
error LombardConsortium__PlayerAlreadyExists(address player);

/// @dev Error thrown when trying to remove a non-existent player
error LombardConsortium__PlayerNotFound(address player);

/// @dev Error thrown when trying to remove a player that would result in too few players
error LombardConsortium__CannotRemovePlayer(uint256 currentCount, uint256 minimum);

/// @dev Error thrown when trying to check signatures byte length is a multiple of 65
///      (ECDSA signature length)
error LombardConsortium__InvalidSignatureLength();

/// @dev Error thrown when signatures amount is below the required threshold
error LombardConsortium__InsufficientSignatures();

/// @dev Error thrown when signatures amount is more than players amount
error LombardConsortium__TooManySignatures();

/// @dev Error thrown when signatures from the same players are present in the multisig
error LombardConsortium__DuplicatedSignature(address player);

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
        /// @dev Calculated as floor(2/3 * playerList.length) + 1
        uint256 threshold;

        /// @notice Consortium address
        address consortium;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

    /// @dev Maximum number of players allowed in the consortium.
    /// @notice This value is calculated based on gas limits and BFT consensus requirements:
    /// - Assumes ~7000 gas per ECDSA signature verification
    /// - Uses a conservative 30 million gas block limit
    /// - Allows for maximum possible signatures: 30,000,000 / 7,000 ≈ 4,285
    /// - Reverse calculated for BFT consensus (2/3 + 1):
    ///   4,285 = (6,423 * 2/3 + 1) rounded down
    /// - 6,423 players allow for 4,283 required signatures in the worst case
    /// @dev This limit ensures the contract can theoretically handle signature verification
    ///      for all players within a single block's gas limit.
    uint256 private constant MAX_PLAYERS = 6423;

    /// @dev Minimum number of players required for BFT consensus.
    /// @notice This ensures the system can tolerate at least one Byzantine fault.
    uint256 private constant MIN_PLAYERS = 4;

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
    /// @param _consortium - Consortium address
    function __Consortium_init(address[] memory _initialPlayers, address _consortium) internal onlyInitializing {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        $.consortium = _consortium;

        uint256 playerCount = _initialPlayers.length;
        if (playerCount < MIN_PLAYERS) {
            revert LombardConsortium__InsufficientInitialPlayers(playerCount, MIN_PLAYERS);
        }
        if (playerCount > MAX_PLAYERS) {
            revert LombardConsortium__TooManyPlayers(playerCount, MAX_PLAYERS);
        }

        for (uint256 i; i < playerCount;) {
            address player = _initialPlayers[i];
            if ($.players[player]) {
                revert LombardConsortium__PlayerAlreadyExists(player);
            }
            $.players[player] = true;
            $.playerList.push(player);
            emit PlayerAdded(player);
            unchecked { ++i; }
        }
        _updateThreshold();
    }

    /// @notice Internal function to update threshold value
    function _updateThreshold() internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        uint256 playerCount = $.playerList.length;
        // for multiple of 3 need to increment
        $.threshold = Math.ceilDiv(playerCount * 2, 3) + (playerCount % 3 == 0 ? 1 : 0);
    }

    /// @notice Initializes the consortium contract with players and the owner key
    /// @param _players - The initial list of players
    /// @param _ownerKey - The address of the initial owner
    /// @param _consortium - Consortium address
    function initialize(address[] memory _players, address _ownerKey, address _consortium) external initializer {
        __Ownable_init(_ownerKey);
        __Ownable2Step_init();
        __Consortium_init(_players, _consortium);
    }

    /// @notice Adds player if approved by consortium
    /// @param _newPlayer - Player address to add
    /// @param _data - Data to verify
    /// @param _proofSignature - Consortium signature
    function addPlayer(address _newPlayer, bytes calldata _data, bytes calldata _proofSignature) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if ($.playerList.length >= MAX_PLAYERS) {
            revert LombardConsortium__TooManyPlayers($.playerList.length + 1, MAX_PLAYERS);
        }
        if ($.players[_newPlayer]) {
            revert LombardConsortium__PlayerAlreadyExists(_newPlayer);
        }

        bytes32 proofHash = keccak256(_data);

        // we can trust data only if proof is signed by Consortium
        EIP1271SignatureUtils.checkSignature($.consortium, proofHash, _proofSignature);

        $.players[_newPlayer] = true;
        $.playerList.push(_newPlayer);
        emit PlayerAdded(_newPlayer);
        _updateThreshold();
    }

    /// @notice Removes player if approved by consortium
    /// @param _playerToRemove - Player address to remove
    /// @param _data - Data to verify
    /// @param _proofSignature - Consortium signature
    function removePlayer(address _playerToRemove, bytes calldata _data, bytes calldata _proofSignature) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if (!$.players[_playerToRemove]) {
            revert LombardConsortium__PlayerNotFound(_playerToRemove);
        }
        if ($.playerList.length <= MIN_PLAYERS) {
            revert LombardConsortium__CannotRemovePlayer($.playerList.length, MIN_PLAYERS);
        }

        bytes32 proofHash = keccak256(_data);

        // we can trust data only if proof is signed by Consortium
        EIP1271SignatureUtils.checkSignature($.consortium, proofHash, _proofSignature);

        $.players[_playerToRemove] = false;
        for (uint256 i; i < $.playerList.length; i++) {
            if ($.playerList[i] == _playerToRemove) {
                $.playerList[i] = $.playerList[$.playerList.length - 1];
                $.playerList.pop();
                break;
            }
        }
        emit PlayerRemoved(_playerToRemove);
        _updateThreshold();
    }

    // /// @notice Validates the provided signature against the given hash
    // /// @param _hash The hash of the data to be signed
    // /// @param _signatures The signatures to validate
    // /// @return The magic value (0x1626ba7e) if the signature is valid, wrong value
    // ///         (0xffffffff) otherwise
    function isValidSignature(bytes32 _hash, bytes calldata _signatures) external view override returns (bytes4) {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        uint256 signatureCount = _signatures.length / 65;
        if (_signatures.length % 65 != 0) revert LombardConsortium__InvalidSignatureLength();
        if (signatureCount < $.threshold) revert LombardConsortium__InsufficientSignatures();
        if (signatureCount > $.playerList.length) revert LombardConsortium__TooManySignatures();

        address[] memory signers = new address[](signatureCount);
        uint256 validSignatures;

        for (uint256 i; i < signatureCount;) {
            (uint8 v, bytes32 r, bytes32 s) = _splitSignature(_signatures, i);
            address signer = ECDSA.recover(_hash, v, r, s);

            if (!$.players[signer]) revert LombardConsortium__PlayerNotFound(signer);
            if (_contains(signers, signer)) revert LombardConsortium__DuplicatedSignature(signer);

            signers[validSignatures++] = signer;
            unchecked { ++i; }
        }

        return validSignatures >= $.threshold ? EIP1271SignatureUtils.EIP1271_MAGICVALUE : EIP1271SignatureUtils.EIP1271_WRONGVALUE;
    }

    function _splitSignature(bytes calldata _signatures, uint256 _index) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        uint256 start = _index * 65;
        assembly {
            r := calldataload(add(_signatures.offset, start))
            s := calldataload(add(_signatures.offset, add(start, 32)))
            v := byte(0, calldataload(add(_signatures.offset, add(start, 64))))
        }
    }

    /// TODO: Use openzeppelin bitmaps for it
    /// @notice internal function to check presence of element in array
    function _contains(address[] memory array, address element) internal pure returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == element) {
                return true;
            }
        }
        return false;
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