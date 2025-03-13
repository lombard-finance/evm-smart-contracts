// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Actions} from "../libs/Actions.sol";
import {INotaryConsortium} from "./INotaryConsortium.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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

    /// ONLY OWNER FUNCTIONS ///

    /// @notice Sets the initial validator set from any epoch
    /// @param _initialValSet - The initial list of validators
    function setInitialValidatorSet(
        bytes calldata _initialValSet
    ) external onlyOwner {
        // Payload validation
        if (bytes4(_initialValSet) != Actions.NEW_VALSET)
            revert UnexpectedAction(bytes4(_initialValSet));

        ConsortiumStorage storage $ = _getConsortiumStorage();

        Actions.ValSetAction memory action = Actions.validateValSet(
            _initialValSet[4:]
        );

        if ($.epoch != 0) {
            revert ValSetAlreadySet();
        }

        _setValidatorSet(
            $,
            action.validators,
            action.weights,
            action.weightThreshold,
            action.epoch
        );
    }

    /// USER ACTIONS ///

    /// @notice Validates the provided signature against the given hash
    /// @param _payloadHash the hash of the data to be signed
    /// @param _proof nonce, expiry and signatures to validate
    function checkProof(
        bytes32 _payloadHash,
        bytes calldata _proof
    ) public view override {
        _checkProof(_payloadHash, _proof);
    }

    function setNextValidatorSet(
        bytes calldata payload,
        bytes calldata proof
    ) external {
        // payload validation
        if (bytes4(payload) != Actions.NEW_VALSET) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.ValSetAction memory action = Actions.validateValSet(
            payload[4:]
        );

        ConsortiumStorage storage $ = _getConsortiumStorage();

        // check proof
        bytes32 payloadHash = sha256(payload);
        checkProof(payloadHash, proof);

        if (action.epoch != $.epoch + 1) revert InvalidEpoch();

        _setValidatorSet(
            $,
            action.validators,
            action.weights,
            action.weightThreshold,
            action.epoch
        );
    }

    /// GETTERS ///

    /// @notice Returns the validator for a given epoch
    /// @param epoch the epoch to get the threshold for
    function getValidatorSet(
        uint256 epoch
    ) external view returns (ValidatorSet memory) {
        return _getConsortiumStorage().validatorSet[epoch];
    }

    /// @notice Returns the current epoch
    function curEpoch() external view returns (uint256) {
        return _getConsortiumStorage().epoch;
    }

    /// PRIVATE FUNCTIONS ///

    /// @notice Internal initializer for the consortium
    function __Consortium_init() internal onlyInitializing {}

    function _setValidatorSet(
        ConsortiumStorage storage $,
        address[] memory _validators,
        uint256[] memory _weights,
        uint256 _threshold,
        uint256 _epoch
    ) internal {
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
    /// @param _proof encoding of signatures array
    /// @dev Negative weight means that the validator did not sign, any positive weight means that the validator signed
    function _checkProof(
        bytes32 _payloadHash,
        bytes calldata _proof
    ) internal view virtual {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        if ($.epoch == 0) {
            revert NoValidatorSet();
        }
        // decode proof
        bytes[] memory signatures = abi.decode(_proof, (bytes[]));

        address[] storage validators = $.validatorSet[$.epoch].validators;
        uint256 length = validators.length;
        if (signatures.length != length) {
            revert LengthMismatch();
        }

        uint256 weight = 0;
        uint256[] storage weights = $.validatorSet[$.epoch].weights;
        for (uint256 i; i < length; ++i) {
            // each signature preset R || S values
            // V is missed, because validators use Cosmos SDK keyring which is not signing in eth style
            // We only check signatures which are the expected 64 bytes long - we are expecting
            // a signatures array with the same amount of items as there are validators, but not all
            // validators will need to sign for a proof to be valid, so validators who have not signed
            // will have their corresponding signature set to 0 bytes.
            // In case of a malformed signature (i.e. length isn't 0 bytes but also isn't 64 bytes)
            // this signature will be discarded.
            if (signatures[i].length == 64) {
                // split signature by R and S values
                bytes memory sig = signatures[i];
                bytes32 r;
                bytes32 s;

                // load the first 32 bytes (r) and the second 32 bytes (s) from the sig
                assembly {
                    r := mload(add(sig, 0x20)) // first 32 bytes (offset 0x20)
                    s := mload(add(sig, 0x40)) // next 32 bytes (offset 0x40)
                }

                if (r != bytes32(0) && s != bytes32(0)) {
                    // try recover with V = 27
                    (address signer, ECDSA.RecoverError err, ) = ECDSA
                        .tryRecover(_payloadHash, 27, r, s);

                    // ignore if bad signature
                    if (err != ECDSA.RecoverError.NoError) {
                        continue;
                    }

                    // if signer doesn't match try V = 28
                    if (signer != validators[i]) {
                        (signer, err, ) = ECDSA.tryRecover(
                            _payloadHash,
                            28,
                            r,
                            s
                        );
                        if (err != ECDSA.RecoverError.NoError) {
                            continue;
                        }

                        if (signer != validators[i]) {
                            continue;
                        }
                    }
                    // signature accepted

                    unchecked {
                        weight += weights[i];
                    }
                }
            }
        }
        if (weight < $.validatorSet[$.epoch].weightThreshold) {
            revert NotEnoughSignatures();
        }
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
}
