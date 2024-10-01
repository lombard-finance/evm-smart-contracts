// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../libs/EIP1271SignatureUtils.sol";

/// @dev Error thrown when trying to initialize with too few players
error InsufficientInitialPlayers(uint256 provided, uint256 minimum);

/// @dev Error thrown when trying to initialize with invalid validator set size
error InvalidValidatorSetSize();

/// @dev Error thrown when trying to initialize with a validator set that already exists
error ValidatorSetAlreadyExists();

/// @dev Error thrown when trying to initialize with a validator that is zero address
error ZeroValidator();

/// @dev Error thrown when trying to initialize with a validator set that is not increasing
error NotIncreasingValidatorSet();

/// @dev Error thrown when invalid validator set is used in a proof
error InvalidValidatorSet();

/// @dev Error thrown when validator set is empty
error EmptyValidatorSet();

/// @dev Error thrown when threshold is zero
error InvalidThreshold();

/// @dev Error thrown when epoch is invalid for validator set
error InvalidEpochForValidatorSet(uint256 epoch);

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
    event ValidatorSetUpdated(uint256 epoch, address[] validators);
    
    struct ValidatorSet {
        bytes32 hash;
        uint256 threshold;
    }
    /// @title ConsortiumStorage
    /// @dev Struct to hold the consortium's state
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Current epoch
        uint256 epoch;

        /// @notice Mapping of epoch to validator set information
        mapping(uint256 => ValidatorSet) validatorSet;
        /// @notice Mapping of validator set hash to epoch
        mapping(bytes32 => uint256) validatorSetEpoch;

        /// @notice Mapping of proofs to their use status
        /// @dev True if the proof is used, false otherwise
        mapping(bytes32 => bool) usedProofs;
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
    /// @dev TODO: Review this amount after final implementation, too many might make signatures unverifiable
    uint256 private constant MAX_VALIDATOR_SET_SIZE = 10_000;

    /// @dev Minimum number of players allowed in the system.
    /// @notice While set to 1 to allow for non-distributed scenarios, this configuration
    /// does not provide Byzantine fault tolerance. For a truly distributed and
    /// fault-tolerant system, a minimum of 4 players would be recommended to tolerate
    /// at least one Byzantine fault.
    /// @dev TODO: Review if needed
    uint256 private constant MIN_VALIDATOR_SET_SIZE = 1;

    /// @dev Number of epochs after which a validator set is considered expired
    /// @dev TODO: Check if needed and which amount to set
    uint256 private constant EPOCH_EXPIRY = 16;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the consortium contract with players and the owner key
    /// @param _initialValidatorSet - The initial list of validators
    /// @param _owner - The address of the initial owner 
    function initialize(address[] memory _initialValidatorSet, uint256 _threshold, address _owner) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Consortium_init(_initialValidatorSet, _threshold);
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _message the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    function checkProof(bytes32 _message, bytes calldata _proof) external {
        _checkProof(_message, _proof);
    }

    /// @notice Returns the current threshold for valid signatures
    /// @param _epoch the epoch to get the threshold for
    /// @return The threshold number of signatures required
    function getThreshold(uint256 _epoch) external view returns (uint256) {
        return _getConsortiumStorage().validatorSet[_epoch].threshold;
    }

    /// @notice Returns the current epoch
    /// @return The current epoch
    function curEpoch() external view returns (uint256) {
        return _getConsortiumStorage().epoch;
    }

    function transferValidatorsOwnership(address[] memory _newValidators, uint256 _threshold, bytes memory proof) external onlyOwner {
        _checkProof(keccak256(abi.encode(_newValidators, _threshold)), proof);
        _setValidatorSet(_newValidators, _threshold);
    }

    /// @notice Internal initializer for the consortium with players
    /// @param _initialValidators - The initial list of validators
    function __Consortium_init(address[] memory _initialValidators, uint256 _threshold) internal onlyInitializing {
        _setValidatorSet(_initialValidators, _threshold);
    }

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

    function _setValidatorSet(address[] memory _validators, uint256 _threshold) internal {
        if(_validators.length < MIN_VALIDATOR_SET_SIZE|| _validators.length > MAX_VALIDATOR_SET_SIZE) 
            revert InvalidValidatorSetSize();       

        if(_threshold == 0) revert InvalidThreshold();

        ConsortiumStorage storage $ = _getConsortiumStorage();

        bytes32 validatorSetHash = keccak256(abi.encode(_validators, _threshold));
        if($.validatorSetEpoch[validatorSetHash] != 0) revert ValidatorSetAlreadyExists();

        address curValidator = _validators[0];
        if(curValidator == address(0)) revert ZeroValidator();
        for(uint256 i = 1; i < _validators.length;) {
            if(curValidator <= _validators[i]) revert NotIncreasingValidatorSet();
            curValidator = _validators[i];
            unchecked { ++i; }
        }

        uint256 epoch = ++$.epoch;
        $.validatorSet[epoch] = ValidatorSet(validatorSetHash, _threshold);
        $.validatorSetEpoch[validatorSetHash] = epoch;
        emit ValidatorSetUpdated(epoch, _validators);
    }

    /// @dev Checks that `_proof` is correct
    /// @param _message data to be signed
    /// @param _proof encoding of (validators, weights, signatures)
    /// @dev Negative weight means that the validator did not sign, any positive weight means that the validator signed
    function _checkProof(bytes32 _message, bytes memory _proof) internal {
        // decode proof
        (address[] memory validators, uint256[] memory weights, uint256 threshold, bytes[] memory signatures) = abi.decode(_proof, (address[], uint256[], uint256, bytes[]));
        
        uint256 validatorsLength = validators.length;
        if(validatorsLength == 0) 
            revert EmptyValidatorSet();
        if(signatures.length != validatorsLength || weights.length != validatorsLength) 
            revert LengthMismatch();
        
        ConsortiumStorage storage $ = _getConsortiumStorage();
        bytes32 validatorSetHash = keccak256(abi.encode(validators, threshold));
        uint256 epoch = $.validatorSetEpoch[validatorSetHash];
        if(epoch == 0 || (epoch + EPOCH_EXPIRY < $.epoch)) 
            revert InvalidEpochForValidatorSet(epoch);

        bytes32 proofHash = keccak256(_proof);
        if($.usedProofs[proofHash]) revert ProofAlreadyUsed();

        uint256 count = 0;
        for(uint256 i; i < validators.length;) {
            if(weights[i] != 0) {
                if(!EIP1271SignatureUtils.checkSignature(validators[i], _message, signatures[i])) 
                    revert SignatureVerificationFailed();
                unchecked { ++count; } 
            }
            unchecked { ++i; }
        }
        if(count < threshold) revert NotEnoughSignatures();

        $.usedProofs[proofHash] = true;
    }
}
