// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../libs/EIP1271SignatureUtils.sol";

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract LombardConsortium is Ownable2StepUpgradeable, IERC1271 {
    using ECDSA for bytes32;

    error BadSignature();
    error InvalidPlayer();
    error DuplicateSignature();
    error InvalidThreshold();

    event PlayersChanged(address[] prevPlayers, address[] newPlayers);

    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        address[] players;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;


    /// @notice Retrieve the ConsortiumStorage struct from the specific storage slot
    /// @return The storage reference to the ConsortiumStorage struct
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
    /// @param _players - The initial list of players
    function __Consortium_init(address[] memory _players) internal onlyInitializing {
        _setPlayers(_players);
    }

    /// @notice Initializes the consortium contract with players and the owner key
    /// @param _players - The initial list of players
    /// @param _ownerKey - The address of the initial owner
    function initialize(address[] memory _players, address _ownerKey) external initializer {
        __Ownable_init(_ownerKey);
        __Ownable2Step_init();
        __Consortium_init(_players);
    }

    /// @notice Allows the owner to change the list of players
    /// @param _newPlayers - The new list of players
    function changePlayers(address[] memory _newPlayers) external onlyOwner {
        _setPlayers(_newPlayers);
    }

    /// @notice Internal function to set the list of players and emit an event
    /// @param _newPlayers - The new list of players
    function _setPlayers(address[] memory _newPlayers) internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        emit PlayersChanged($.players, _newPlayers);
        $.players = _newPlayers;
    }

    /// @notice Returns the current list of players
    /// @return The array of player addresses
    function getPlayers() external view returns (address[] memory) {
        return _getConsortiumStorage().players;
    }


    /// @notice Calculates the threshold number of signatures needed for consensus
    /// @param playerCount - The total number of players
    /// @return The threshold number of signatures required
    function _calculateThreshold(uint256 _playerCount) private pure returns (uint256) {
        require(_playerCount > 0, "Invalid player count");
        // Threshold is ceil(players * 2/3)
        return (_playerCount * 2 + 2) / 3;
    }

    /// @notice Verifies if the provided signatures are valid for the given hash
    /// @param _hash - The hash of the data to be signed
    /// @param _signatures - The concatenated signatures to be verified
    /// @return magicValue The EIP-1271 magic value if the signatures are valid
    function isValidSignature(
        bytes32 _hash,
        bytes memory _signatures
    ) external view override returns (bytes4 magicValue) {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        uint256 threshold = _calculateThreshold($.players.length);

        address[] memory players = $.players;
        uint256 validSignatures = 0;
        address[] memory usedAddresses = new address[](players.length);

        for (uint256 i = 0; i < _signatures.length; i += 65) {
            bytes memory sig = new bytes(65);
            for (uint256 j = 0; j < 65; j++) {
                sig[j] = _signatures[i + j];
            }

            address recovered = _hash.recover(sig);

            bool isPlayer = false;
            for (uint256 k = 0; k < players.length; k++) {
                if (players[k] == recovered) {
                    isPlayer = true;
                    break;
                }
            }
            if (!isPlayer) {
                revert InvalidPlayer();
            }

            for (uint256 k = 0; k < validSignatures; k++) {
                if (usedAddresses[k] == recovered) {
                    revert DuplicateSignature();
                }
            }

            usedAddresses[validSignatures] = recovered;
            validSignatures++;

            if (validSignatures >= threshold) {
                return EIP1271SignatureUtils.EIP1271_MAGICVALUE;
            }
        }

        revert BadSignature();
    }

    /// @notice Returns the current threshold for valid signatures
    /// @return The threshold number of signatures required
    function threshold() external view returns (uint256) {
        return _calculateThreshold(_getConsortiumStorage().players.length);
    }
}
