// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { EIP1271SignatureUtils } from "../libs/EIP1271SignatureUtils.sol";
import { Actions } from "../libs/Actions.sol";

/// @dev Error thrown when signature proof is already used
error ProofAlreadyUsed();

/// @dev Error thrown when signatures length is not equal to signers length
error LengthMismatch();

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
    struct ValidatorSet {
        /// @notice addresses of the signers
        address[] validators;
        /// @notice weight of each signer
        uint256[] weights;
        /// @notice current threshold for signatures to be accepted
        uint256 threshold;
    }
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Current epoch
        uint256 epoch;

        /// @notice Store the Validator set for each epoch
        mapping(uint256 => ValidatorSet) validatorSet;

        /// @notice Mapping of proofs to their use status
        /// @dev True if the proof is used, false otherwise
        mapping(bytes32 => bool) usedProofs;
    }

    // bytes4(keccak256("setValidators(bytes[],uint256[],uint256)"))
    bytes4 constant SET_VALIDATORS_ACTION = 0x333b09c0;

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

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
    function setInitalValidatorSet(bytes[] memory _initialValidatorSet, uint256[] memory _weights, uint256 _threshold) external onlyOwner {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if($.epoch != 0) {
            revert ValidatorSetMustApprove();
        }

        Actions.ValidatorSetAction memory action = Actions.validateValidatorSet(_initialValidatorSet, _weights, _threshold);

        _setValidatorSet(action.validators, action.weights, action.threshold);
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _message the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    function checkProof(bytes32 _message, bytes calldata _proof) public {
        _checkProof(enhanceMessage(_message, _msgSender()), _proof);
    }

    /// @notice Returns the validator for a given epoch
    /// @param epoch the epoch to get the threshold for
    function getValidatoSet(uint256 epoch) external view returns (ValidatorSet memory) {
        return _getConsortiumStorage().validatorSet[epoch];
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
        bytes32 enhancedMessage = sha256(abi.encode(
            block.chainid, 
            _sender, 
            address(this), 
            $.epoch,
            _message
        ));
        return enhancedMessage;
    }

    function setNextValidatorSet(bytes calldata payload, bytes calldata proof) external {
        // check proof
        this.checkProof(sha256(payload), proof);

        // payload validation
        if (bytes4(payload) != Actions.SET_VALIDATORS_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.ValidatorSetAction memory action = Actions.setValidatorSet(payload[4:]);
        
        _setValidatorSet(action.validators, action.weights, action.threshold);
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
        ConsortiumStorage storage $ = _getConsortiumStorage();

        uint256 epoch = ++$.epoch;
        $.validatorSet[epoch] = ValidatorSet({
            validators: _validators,
            weights: _weights,
            threshold: _threshold
        });
        emit ValidatorSetUpdated(epoch, _validators, _weights, _threshold);
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
        
        address[] storage validators = $.validatorSet[$.epoch].validators;
        uint256 length = validators.length;
        if(signatures.length != length) {
            revert LengthMismatch();
        }

        bytes32 proofHash = sha256(_proof);
        if($.usedProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }

        uint256 count = 0;
        uint256[] storage weights = $.validatorSet[$.epoch].weights;
        for(uint256 i; i < length;) {
            if(signatures[i].length != 0) {
                if(!EIP1271SignatureUtils.checkSignature(validators[i], _message, signatures[i])) {
                    revert SignatureVerificationFailed();
                }
                unchecked { count += weights[i]; } 
            }
            unchecked { ++i; }
        }
        if(count < $.validatorSet[$.epoch].threshold) {
            revert NotEnoughSignatures();
        }
        $.usedProofs[proofHash] = true;
    }
}
