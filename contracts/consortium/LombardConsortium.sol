// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "../libs/EIP1271SignatureUtils.sol";

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

/// @dev Error thrown when signature is invalid
error LombardConsortium__SignatureValidationError(uint256 signatureIndex, uint8 errorCode);

/// @dev Error thrown when data length is invalid
error LombardConsortium__InvalidDataLength();

/// @dev Error thrown when public key length is invalid
error LombardConsortium__InvalidPublicKeyLength();

/// @dev Error thrown when signature proof is already used
error LombardConsortium__ProofAlreadyUsed();

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract LombardConsortium is Ownable2StepUpgradeable, IERC1271 {
    event PlayerAdded(address player);
    event PlayerRemoved(address player);

    /// @title ConsortiumStorage
    /// @dev Struct to hold the consortium's state
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Mapping of addresses to their player status
        /// @dev True if the address is a player, false otherwise
        mapping(address => bool) players;

        /// @notice Mapping of proofs to their use status
        /// @dev True if the proof is used, false otherwise
        mapping(bytes32 => bool) usedProofs;

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
    /// - Assumes 4281 gas per ECDSA signature verification
    /// - Uses a conservative 30 million gas block limit
    /// - Allows for maximum possible signatures: 30,000,000 / 4,281 ≈ 7007
    /// - Reverse calculated for BFT consensus (2/3 + 1):
    ///   7,007 = (10,509 * 2/3 + 1) rounded down
    /// - 10,509 players allow for 4,283 required signatures in the worst case
    /// @dev This limit ensures the contract can theoretically handle signature verification
    ///      for all players within a single block's gas limit.
    uint256 private constant MAX_PLAYERS = 10_509;

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
        // threshold = floor(2/3 * playerCount) + 1
        // equivalent to:
        // ceil(2/3 * playerCount) if playerCount is not multiple of 3,
        // ceil(2/3 * playerCount) + 1 otherwise
        $.threshold = Math.ceilDiv(playerCount * 2, 3) + (playerCount % 3 == 0 ? 1 : 0);
    }

    /// @dev Checks that `proofSignature` is signature of `keccak256(data)`
    /// @param _data arbitrary data with some unique fields (tx hash, output index, etc)
    /// @param _proofSignature signed `data` hash
    function _checkProof( bytes calldata _data, bytes calldata _proofSignature) internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        bytes32 proofHash = keccak256(_data);

        // we can trust data only if proof is signed by Consortium
        EIP1271SignatureUtils.checkSignature($.consortium, proofHash, _proofSignature);
        // We can save the proof, because output with index in unique pair
        if ($.usedProofs[proofHash]) {
            revert LombardConsortium__ProofAlreadyUsed();
        }
        $.usedProofs[proofHash] = true;
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
    /// @param _data - Data to verify (incl. player public key)
    /// @param _proofSignature - Consortium signature
    function addPlayer(bytes calldata _data, bytes calldata _proofSignature) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if ($.playerList.length >= MAX_PLAYERS) {
            revert LombardConsortium__TooManyPlayers($.playerList.length + 1, MAX_PLAYERS);
        }

        // Check for minimum length: 32 (length prefix) + 65 (public key) = 97 bytes
        if (_data.length < 97) revert LombardConsortium__InvalidDataLength();

        _checkProof(_data, _proofSignature);

        (bytes memory publicKey, ) = abi.decode(_data, (bytes, bytes));

        if (publicKey.length != 65) revert LombardConsortium__InvalidPublicKeyLength();

        address newPlayer = address(uint160(uint256(keccak256(publicKey))));

        if ($.players[newPlayer]) {
            revert LombardConsortium__PlayerAlreadyExists(newPlayer);
        }

        $.players[newPlayer] = true;
        $.playerList.push(newPlayer);
        emit PlayerAdded(newPlayer);
        _updateThreshold();
    }

    /// @notice Removes player if approved by consortium
    /// @param _data - Data to verify (incl. player public key)
    /// @param _proofSignature - Consortium signature
    function removePlayer(bytes calldata _data, bytes calldata _proofSignature) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if ($.playerList.length <= MIN_PLAYERS) {
            revert LombardConsortium__CannotRemovePlayer($.playerList.length, MIN_PLAYERS);
        }

        // Check for minimum length: 32 (length prefix) + 65 (public key) = 97 bytes
        if (_data.length < 97) revert LombardConsortium__InvalidDataLength();

        _checkProof(_data, _proofSignature);

        (bytes memory publicKey, ) = abi.decode(_data, (bytes, bytes));

        if (publicKey.length != 65) revert LombardConsortium__InvalidPublicKeyLength();

        address playerToRemove = address(uint160(uint256(keccak256(publicKey))));

        if (!$.players[playerToRemove]) {
            revert LombardConsortium__PlayerNotFound(playerToRemove);
        }

        $.players[playerToRemove] = false;
        for (uint256 i; i < $.playerList.length; i++) {
            if ($.playerList[i] == playerToRemove) {
                $.playerList[i] = $.playerList[$.playerList.length - 1];
                $.playerList.pop();
                break;
            }
        }
        emit PlayerRemoved(playerToRemove);
        _updateThreshold();
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _hash The hash of the data to be signed
    /// @param _signatures The signatures to validate
    /// @return The magic value (0x1626ba7e) if the signature is valid, wrong value
    ///         (0xffffffff) otherwise
    function isValidSignature(bytes32 _hash, bytes calldata _signatures) external view override returns (bytes4) {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if (_signatures.length % 65 != 0) revert LombardConsortium__InvalidSignatureLength();
        uint256 signatureCount = _signatures.length / 65;

        if (signatureCount < $.threshold) revert LombardConsortium__InsufficientSignatures();
        if (signatureCount > $.playerList.length) revert LombardConsortium__TooManySignatures();

        address[] memory seenSigners = new address[](signatureCount);
        uint256 validSignatures;

        address signer;
        ECDSA.RecoverError error;
        bytes32 r;
        bytes32 s;
        uint8 v;

        for (uint256 i; i < signatureCount;) {
            assembly {
                r := calldataload(add(_signatures.offset, mul(i, 65)))
                s := calldataload(add(_signatures.offset, add(mul(i, 65), 32)))
                v := byte(0, calldataload(add(_signatures.offset, add(mul(i, 65), 64))))
            }

            (signer, error, ) = ECDSA.tryRecover(_hash, v, r, s);

            if (!$.players[signer]) revert LombardConsortium__PlayerNotFound(signer);
            if (error != ECDSA.RecoverError.NoError) revert LombardConsortium__SignatureValidationError(i, uint8(error));

            // Check for duplicate signatures
            for (uint256 j; j < validSignatures;) {
                if (seenSigners[j] == signer) revert LombardConsortium__DuplicatedSignature(signer);
                unchecked { ++j; }
            }

            seenSigners[validSignatures] = signer;
            unchecked {
                ++validSignatures;
                ++i;
            }
        }

        return validSignatures >= $.threshold ? EIP1271SignatureUtils.EIP1271_MAGICVALUE : EIP1271SignatureUtils.EIP1271_WRONGVALUE;
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