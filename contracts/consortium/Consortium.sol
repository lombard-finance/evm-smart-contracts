// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { EIP1271SignatureUtils } from "../libs/EIP1271SignatureUtils.sol";
import { Actions } from "../libs/Actions.sol";
import { INotaryConsortium } from "./INotaryConsortium.sol";

/// @title The contract utilizes consortium governance functions using multisignature verification
/// @author Lombard.Finance
/// @notice The contracts are a part of the Lombard.Finance protocol
contract Consortium is Ownable2StepUpgradeable, INotaryConsortium {
    struct ValidatorSet {
        /// @notice addresses of the signers
        address[] validators;
        /// @notice weight of each signer
        uint256[] weights;
        /// @notice current threshold for signatures weight to be accepted
        uint256 weightThreshold;
    }
    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        /// @notice Current epoch
        uint256 epoch;

        /// @notice Store the Validator set for each epoch
        mapping(uint256 => ValidatorSet) validatorSet;
    }

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

    /// @notice Sets the initial validator set from any epoch
    /// @param _initialValSet - The initial list of validators
    function setInitalValidatorSet(bytes memory _initialValSet) external onlyOwner {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        Actions.ValSetAction memory action = Actions.validateValSet(_initialValSet);

        if($.epoch != 0) {
            revert ValSetAlreadySet();
        }

        _setValidatorSet(action.validators, action.weights, action.weightThreshold, action.epoch);
    }

    /// @notice Validates the provided signature against the given hash
    /// @param _payloadHash the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    function checkProof(bytes32 _payloadHash, bytes calldata _proof) public {
        _checkProof(_payloadHash, _proof);
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

    function setNextValidatorSet(bytes calldata payload, bytes calldata proof) external {

        // payload validation
        if (bytes4(payload) != Actions.NEW_VALSET) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.ValSetAction memory action = Actions.validateValSet(payload[4:]);

        ConsortiumStorage storage $ = _getConsortiumStorage();

        // check proof
        bytes32 payloadHash = sha256(payload);
        this.checkProof(payloadHash, proof);

        if(action.epoch != $.epoch + 1)
            revert InvalidEpoch();
        
        _setValidatorSet(action.validators, action.weights, action.weightThreshold, action.epoch);
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

    function _setValidatorSet(address[] memory _validators, uint256[] memory _weights, uint256 _threshold, uint256 _epoch) internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        // do not allow to rewrite existing valset
        if ($.validatorSet[_epoch].weightThreshold != 0) {
            revert InvalidEpoch();
        }

        $.epoch = _epoch;
        $.validatorSet[_epoch] = ValidatorSet({
            validators: _validators,
            weights: _weights,
            weightThreshold: _threshold
        });
        emit ValidatorSetUpdated(_epoch, _validators, _weights, _threshold);
    }

    /// @dev Checks that `_proof` is correct
    /// @param _payloadHash data to be signed
    /// @param _proof encoding of (validators, weights, signatures)
    /// @dev Negative weight means that the validator did not sign, any positive weight means that the validator signed
    function _checkProof(bytes32 _payloadHash, bytes memory _proof) internal {
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

        uint256 weight = 0;
        uint256[] storage weights = $.validatorSet[$.epoch].weights;
        for(uint256 i; i < length;) {
            if(signatures[i].length != 0) {
                if(!EIP1271SignatureUtils.checkSignature(validators[i], _payloadHash, signatures[i])) {
                    revert SignatureVerificationFailed();
                }
                unchecked { weight += weights[i]; }
            }
            unchecked { ++i; }
        }
        if(weight < $.validatorSet[$.epoch].weightThreshold) {
            revert NotEnoughSignatures();
        }
    }
}
