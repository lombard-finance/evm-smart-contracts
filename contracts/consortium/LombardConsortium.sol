// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../libs/EIP1271SignatureUtils.sol";

/// @dev Error thrown when trying to initialize with too few players
error InsufficientInitialPlayers(uint256 provided, uint256 minimum);

/// @dev Error thrown when trying to initialize or add players exceeding the maximum limit
error TooManyPlayers();

/// @dev Error thrown when trying to add a player that already exists
error PlayerAlreadyExists(address player);

/// @dev Error thrown when trying to remove a non-existent player
error PlayerNotFound(address player);

/// @dev Error thrown when trying to remove a player that would result in too few players
error CannotRemovePlayer();

/// @dev Error thrown when signatures from the same players are present in the multisig
error DuplicatedSignature(address player);

/// @dev Error thrown when signature proof is already used
error ProofAlreadyUsed();

/// @dev Error thrown when signature proof is expired
error ProofExpired();

/// @dev Error thrown when signatures length is not equal to signers length
error LengthMismatch();

/// @dev Error thrown when nonce is already used
error NonceAlreadyUsed();

/// @dev Error thrown when there are not enough signatures
error NotEnoughSignatures();

/// @dev Error thrown when signature verification fails
error SignatureVerificationFailed();

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract LombardConsortium is Ownable2StepUpgradeable {
    event PlayerAdded(address player);
    event PlayerRemoved(address player);

    /// @title ConsortiumStorage
    /// @dev Struct to hold the consortium's state
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Consortium address
        /// @custom:oz-renamed-from consortium
        address __removed_consortium; 

        /// @notice Mapping of addresses to their postion in the player list
        /// @dev Position in the player list
        /// @dev value is 1-indexed so 0 means not a player
        mapping(address => uint256) players;

        /// @notice List of all player addresses
        /// @dev Used for iteration and maintaining order
        address[] playerList;

        /// @notice The current threshold for signature validation
        /// @dev Calculated as floor(2/3 * playerList.length) + 1
        uint256 threshold;

        /// @notice Mapping of proofs to their use status
        /// @dev True if the proof is used, false otherwise
        mapping(bytes32 => bool) usedProofs;

        /// @notice Mapping of nonces to their use status
        /// @dev True if the nonce is used, false otherwise
        mapping(uint256 => bool) usedNonces;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

    /// @dev Maximum number of players allowed in the consortium.
    /// @notice This value is determined by the minimum of CometBFT consensus limitations and gas considerations:
    /// - CometBFT has a hard limit of 10,000 validators (https://docs.cometbft.com/v0.38/spec/core/state)
    /// - Gas-based calculation:
    ///   - Assumes 4281 gas per ECDSA signature verification
    ///   - Uses a conservative 30 million gas block limit
    ///   - Maximum possible signatures: 30,000,000 / 4,281 ≈ 7007
    ///   - Reverse calculated for BFT consensus (2/3 + 1):
    ///     7,007 = (10,509 * 2/3 + 1) rounded down
    /// - The lower value of 10,000 (CometBFT limit) and 10,509 (gas calculation) is chosen
    /// @dev This limit ensures compatibility with CometBFT while also considering gas limitations
    ///      for signature verification within a single block.
    uint256 private constant MAX_PLAYERS = 10_000;

    /// @dev Minimum number of players allowed in the system.
    /// @notice While set to 1 to allow for non-distributed scenarios, this configuration
    /// does not provide Byzantine fault tolerance. For a truly distributed and
    /// fault-tolerant system, a minimum of 4 players would be recommended to tolerate
    /// at least one Byzantine fault.
    uint256 private constant MIN_PLAYERS = 1;

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
        ConsortiumStorage storage $ = _getConsortiumStorage();

        uint256 playerCount = _initialPlayers.length;
        if (playerCount < MIN_PLAYERS) {
            revert InsufficientInitialPlayers(playerCount, MIN_PLAYERS);
        }
        if (playerCount > MAX_PLAYERS) {
            revert TooManyPlayers();
        }

        for (uint256 i; i < playerCount;) {
            address player = _initialPlayers[i];
            if ($.players[player] != 0) {
                revert PlayerAlreadyExists(player);
            }
            unchecked { ++i; }
            $.players[player] = i;
            $.playerList.push(player);
            emit PlayerAdded(player);
        }
        _updateThreshold();
    }

    /// @notice Internal function to update threshold value
    function _updateThreshold() internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        uint256 playerCount = $.playerList.length;

        // threshold = floor(2/3 * playerCount) + 1
        $.threshold = Math.mulDiv(
            playerCount,
            2,
            3,
            Math.Rounding.Floor
        ) + 1;
    }

    /// @dev Checks that `_proof` is correct
    /// @param _rawMessage data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    /// @dev The signatures must be in the same order as the players list to avoid extra onchain verification ocst
    function _checkProof(bytes32 _rawMessage, address _targetContract, bytes memory _proof) internal {
        // decode proof
        (uint256 nonce, uint256 expiry, address[] memory signers, bytes[] memory signatures) = abi.decode(_proof, (uint256, uint256, address[], bytes[]));
        if(block.timestamp > expiry) revert ProofExpired();
        if(signatures.length != signers.length) revert LengthMismatch();
        
        ConsortiumStorage storage $ = _getConsortiumStorage();
        if(signers.length < $.threshold) revert NotEnoughSignatures();

        bytes32 proofHash = keccak256(_proof);
        if($.usedProofs[proofHash]) revert ProofAlreadyUsed();
        if($.usedNonces[nonce]) revert NonceAlreadyUsed();  

        bytes32 fullMessage = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(
                _rawMessage,
                nonce,
                expiry,
                uint256(block.chainid),
                _targetContract
            ))
        );

        uint256 lastPlayer;
        for(uint256 i; i < signers.length;) {
            uint256 currentPlayer = $.players[signers[i]];
            if(currentPlayer == 0) revert PlayerNotFound(signers[i]);
            if(currentPlayer <= lastPlayer) revert DuplicatedSignature(signers[i]);
            lastPlayer = currentPlayer;

            if(!EIP1271SignatureUtils.checkSignature(signers[i], fullMessage, signatures[i])) 
            revert SignatureVerificationFailed();
            
            unchecked { ++i; }
        }

        $.usedProofs[proofHash] = true;
        $.usedNonces[nonce] = true;
    }

    /// @notice Initializes the consortium contract with players and the owner key
    /// @param _players - The initial list of players
    /// @param _ownerKey - The address of the initial owner
    function initialize(address[] memory _players, address _ownerKey) external initializer {
        __Ownable_init(_ownerKey);
        __Ownable2Step_init();
        __Consortium_init(_players);
    }

    /// @notice Adds player if approved by consortium
    /// @param _player - Address of the new player to add
    /// @param _proof - Consortium proof
    function addPlayer(address _player, bytes calldata _proof) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if ($.playerList.length == MAX_PLAYERS) revert TooManyPlayers();

        if ($.players[_player] != 0) {
            revert PlayerAlreadyExists(_player);
        }

        bytes32 rawMessage = keccak256(abi.encodeWithSignature(
            "addPlayer(address)",
            _player
        ));

        // External call so 
        _checkProof(rawMessage, address(this), _proof);

        $.playerList.push(_player);
        $.players[_player] = $.playerList.length;
        emit PlayerAdded(_player);
        _updateThreshold();
    }

    /// @notice Removes player if approved by consortium
    /// @param _player - Address of the player to remove
    /// @param _proof - Consortium proof
    function removePlayer(address _player, bytes calldata _proof) external {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if ($.playerList.length == MIN_PLAYERS) revert CannotRemovePlayer();

        uint256 playerIndex = $.players[_player];
        if (playerIndex == 0) {
            revert PlayerNotFound(_player);
        }

        bytes32 rawMessage = keccak256(abi.encodeWithSignature(
            "removePlayer(address)",
            _player
        ));

        _checkProof(rawMessage, address(this), _proof);

        if(playerIndex != $.playerList.length) {
            address lastPlayer = $.playerList[$.playerList.length - 1];
            $.playerList[playerIndex - 1] = lastPlayer;
            $.players[lastPlayer] = playerIndex;
        }
        $.playerList.pop();
        delete $.players[_player];
        emit PlayerRemoved(_player);
        _updateThreshold();
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _rawMessage the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    /// @return The magic value (0x1626ba7e) if the signature is valid
    function checkProof(bytes32 _rawMessage, bytes calldata _proof) external returns (bytes4) {
        _checkProof(_rawMessage, msg.sender, _proof);

        return EIP1271SignatureUtils.EIP1271_MAGICVALUE;
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