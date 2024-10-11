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
error ValidatorSetClash();

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

/// @dev Error thrown when unexpected action is used
error UnexpectedAction(bytes4 action);

/// @dev Event emitted when the validator set is updated
event ValidatorSetUpdated(uint256 epoch, address[] validators, uint256[] weights, uint256 threshold);

/// @dev Error thrown when validator set must be approved the action
error ValidatorSetMustApprove();

/// @dev Error thrown when no validator set is set
error NoValidatorSet();

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract LombardConsortium is Ownable2StepUpgradeable {    
    /// @title ConsortiumStorage
    /// @dev Struct to hold the consortium's state
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Current epoch
        uint256 epoch;

        /// @notice current threshold for signatures to be accepted
        uint256 threshold;
        /// @notice addresses of the signers
        address[] validators;
        /// @notice weight of each signer
        uint256[] weights;

        /// @notice Mapping of proofs to their use status
        /// @dev True if the proof is used, false otherwise
        mapping(bytes32 => bool) usedProofs;
    }

    // bytes4(keccak256("setValidators(address[],uint256[],uint256)"))
    bytes4 constant SET_VALIDATORS_ACTION = 0x56a02237;

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
    uint256 private constant MAX_VALIDATOR_SET_SIZE = 102;

    /// @dev Minimum number of players allowed in the system.
    /// @notice While set to 1 to allow for non-distributed scenarios, this configuration
    /// does not provide Byzantine fault tolerance. For a truly distributed and
    /// fault-tolerant system, a minimum of 4 players would be recommended to tolerate
    /// at least one Byzantine fault.
    /// @dev TODO: Review if needed
    uint256 private constant MIN_VALIDATOR_SET_SIZE = 1;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the consortium contract
    /// @param _owner - The address of the initial owner 
    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Consortium_init();
    }

    /// @notice Sets the initial validator set
    /// @param _initialValidatorSet - The initial list of validators
    /// @param _weights - The initial list of weights
    /// @param _threshold - The initial threshold
    function setInitalValidatorSet(address[] memory _initialValidatorSet, uint256[] memory _weights, uint256 _threshold) external onlyOwner {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if($.epoch != 0) {
            revert ValidatorSetMustApprove();
        }

        _setValidatorSet(_initialValidatorSet, _weights, _threshold);
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _message the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    function checkProof(bytes32 _message, bytes calldata _proof) public {
        _checkProof(enhanceMessage(_message, _msgSender()), _proof);
    }

    /// @notice Returns the current threshold for valid signatures
    function getThreshold() external view returns (uint256) {
        return _getConsortiumStorage().threshold;
    }

    /// @notice Returns the current epoch
    function curEpoch() external view returns (uint256) {
        return _getConsortiumStorage().epoch;
    }

    /// @notice returns an enhanced version of the message
    /// @param _message the payload to enhance
    /// @param _sender address of the account that will trigger the verification
    function enhanceMessage(bytes32 _message, address _sender) public view returns (bytes32) {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        bytes32 enhancedMessage = keccak256(abi.encode(
            block.chainid, 
            _sender, 
            address(this), 
            $.epoch,
            _message
        ));
        return enhancedMessage;
    }

    function transferValidatorsOwnership(bytes calldata payload, bytes calldata proof) external onlyOwner {
        // check proof
        this.checkProof(keccak256(payload), proof);

        // payload validation
        if (bytes4(payload) != SET_VALIDATORS_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        // extra data can be btc txn hash here, irrelevant for verification
        (address[] memory validators, uint256[] memory weights, uint256 threshold) =
            abi.decode(payload[4:], (address[], uint256[], uint256));
        
        _setValidatorSet(validators, weights, threshold);
    }

    /// @notice Internal initializer for the consortium
    function __Consortium_init() internal onlyInitializing {}

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

    function _setValidatorSet(address[] memory _validators, uint256[] memory _weights, uint256 _threshold) internal {
        if(_validators.length < MIN_VALIDATOR_SET_SIZE || _validators.length > MAX_VALIDATOR_SET_SIZE) 
            revert InvalidValidatorSetSize();  

        if(_validators.length != _weights.length) 
            revert LengthMismatch();

        if(_threshold == 0) 
            revert InvalidThreshold();

        uint256 sum = 0;
        for(uint256 i; i < _weights.length;) {
            sum += _weights[i];
            unchecked { ++i; }
        }
        if(sum < _threshold) 
            revert InvalidThreshold();

        ConsortiumStorage storage $ = _getConsortiumStorage();
        
        address curValidator = _validators[0];
        if(curValidator == address(0)) revert ZeroValidator();
        for(uint256 i = 1; i < _validators.length;) {
            if(curValidator <= _validators[i]) revert NotIncreasingValidatorSet();
            curValidator = _validators[i];
            unchecked { ++i; }
        }

        $.validators = _validators;
        $.weights = _weights;
        $.threshold = _threshold;
        emit ValidatorSetUpdated(++$.epoch, _validators, _weights, _threshold);
    }

    /// @dev Checks that `_proof` is correct
    /// @param _message data to be signed
    /// @param _proof encoding of (validators, weights, signatures)
    /// @dev Negative weight means that the validator did not sign, any positive weight means that the validator signed
    function _checkProof(bytes32 _message, bytes memory _proof) internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        if($.epoch == 0) {
            revert NoValidatorSet();
        }
        // decode proof
        bytes[] memory signatures = abi.decode(_proof, (bytes[]));
        
        address[] storage validators = $.validators;
        uint256 length = validators.length;
        if(signatures.length != length) 
            revert LengthMismatch();

        bytes32 proofHash = keccak256(_proof);
        if($.usedProofs[proofHash]) revert ProofAlreadyUsed();

        uint256 count = 0;
        uint256[] storage weights = $.weights;
        for(uint256 i; i < length;) {
            if(signatures[i].length != 0) {
                if(!EIP1271SignatureUtils.checkSignature(validators[i], _message, signatures[i])) 
                    revert SignatureVerificationFailed();
                unchecked { count += weights[i]; } 
            }
            unchecked { ++i; }
        }
        if(count < $.threshold) revert NotEnoughSignatures();

        $.usedProofs[proofHash] = true;
    }
}
