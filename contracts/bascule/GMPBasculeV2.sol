// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IGMPBascule} from "./interfaces/IGMPBascule.sol";

/// Bascule contract for preventing bridge hacks from hitting the chain.
/// This is the on-chain component of an off-chain/on-chain system.
/// The off-chain component watches all relevant chains and sign mints
/// by key with wasm policy attached. Then report signed mints to this contract.
/// The contract records the relevant GMP mint messages.
/// Finally, when a AssetRouter wants to mint funds,
/// it can validate that a corresponding mint took place using the
/// validateMint function.
///
/// @custom:security-contact security@cubist.dev
contract GMPBasculeV2 is IGMPBascule, Pausable, AccessControlDefaultAdminRules {
    // Describes the state of a mint in the mintHistory.
    enum MintState {
        UNREPORTED, // unreported must be '0'
        REPORTED,
        MINTED
    }

    // Role that can pause mint reporting
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    // Role that can report mint to the history
    bytes32 public constant MINT_REPORTER_ROLE =
        keccak256("MINT_REPORTER_ROLE");
    // Role that can validate mints
    bytes32 public constant MINT_VALIDATOR_ROLE =
        keccak256("MINT_VALIDATOR_ROLE");
    // Role that can be used to change the validation threshold
    bytes32 public constant VALIDATION_GUARDIAN_ROLE =
        keccak256("VALIDATION_GUARDIAN_ROLE");

    // The bascule validates all mints whose amounts are greater than or
    // equal to this threshold. The bascule allows all mints below this
    // threshold. The contract will still produce events that off-chain code can
    // use to monitor smaller mints. This threshold can only be changed by
    // the guardian.
    //
    // When the threshold is zero (the default), the bascule validates all
    // mints.
    //
    // NOTE: Raising this threshold should be done with extreme caution.  In
    // particular, you MUST make sure that validateMint is called with a
    // correct mint amount.
    uint256 public validateThreshold;

    // Maximum number of batch mints it's possible to make at once
    uint256 public maxMints;

    // Mapping that tracks deposits on a different chain that can be used to
    // mint the corresponding funds on this chain.
    //
    // NOTE: The deposit identifier should be a hash with enough information to
    // uniquely identify the deposit transaction on the source chain and the
    // recipient, amount, and chain-id on this chain.
    // See README for more.
    mapping(bytes32 mintID => MintState state) public mintHistory;

    // The address entitled to sign payload deposit reporter brings
    address public trustedSigner;

    /// @dev Create a new GMPBasculeV1.
    /// @param aDefaultAdmin Address of the admin. This address should be controlled by a multisig.
    /// @param aPauser Address of the account that may pause.
    /// @param aMintReporter Address of the account that may report deposits on the source chain.
    /// @param aMintValidator Address of the account that may validate mints.
    /// @param aMaxMints Maximum number of deposits that can be reported at once.
    /// @param aTrustedSigner The key with GMP Bascule Wasm policy attached.
    constructor(
        address aDefaultAdmin,
        address aPauser,
        address aMintReporter,
        address aMintValidator,
        uint256 aMaxMints,
        address aTrustedSigner
    ) AccessControlDefaultAdminRules(3 days, aDefaultAdmin) {
        _grantRole(PAUSER_ROLE, aPauser);
        _grantRole(MINT_REPORTER_ROLE, aMintReporter);
        _grantRole(MINT_VALIDATOR_ROLE, aMintValidator);
        maxMints = aMaxMints;
        // By default, the bascule validates all mints and does not grant
        // anyone the guardian role.
        //
        // Initialize explicitly for readability/maintainability
        validateThreshold = 0; // validate all
        trustedSigner = aTrustedSigner;
    }

    /// ACCESS CONTROL FUNCTIONS ///

    /**
     * Pause deposit reporting and mint validation.
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * Unpause deposit reporting and mint validation.
     */
    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * Update the threshold for checking validation mints.
     * Lowering the threshold means we validate more mints; it only requires
     * the default admin role. Increasing the threshold means we validate fewer
     * mints; it requires the validation guardian role (which the admin must
     * first grant), which is immediately renounced after the threshold is raised.
     *
     * NOTE: Raising this threshold should be done with extreme caution.  In
     * particular, you MUST make sure that validateMint is called with a
     * correct mint amount (i.e., the amount of the actual mint).
     *
     * Emits {UpdateValidateThreshold}.
     */
    function updateValidateThreshold(
        uint256 newThreshold
    ) public onlyRole(VALIDATION_GUARDIAN_ROLE) whenNotPaused {
        // Retains the original reverting behavior of the original
        // for compatibility with off-chain code.
        if (newThreshold == validateThreshold) {
            revert SameValidationThreshold();
        }
        // Actually update the threshold
        _updateValidateThreshold(newThreshold);
    }

    /**
     * Set the maximum number of mints that can be reported at once.
     * May only be invoked by the contract admin.
     *
     * @param aMaxMints New maximum number of mints that can be reported at once.
     */
    function setMaxMints(
        uint256 aMaxMints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxMints = aMaxMints;
        emit MaxMintsUpdated(aMaxMints);
    }

    /**
     * Set the new trusted signer address.
     * May only be invoked by the contract admin.
     *
     * @param aTrustedSigner New trusted signer.
     */
    function setTrustedSigner(
        address aTrustedSigner
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (aTrustedSigner == address(0)) {
            revert ZeroTrustedAddress();
        }
        trustedSigner = aTrustedSigner;
        emit TrustedSignerUpdated(aTrustedSigner);
    }

    /**
     * Report that a series of mints will happen soon.
     * May only be invoked by the mint reporter.
     *
     * @param reportId Unique identifier corresponding to the report.
     * @param mints The mints received through GMP.
     *
     * Emits {MintsReported}.
     */
    function reportMints(
        bytes32 reportId,
        Message[] calldata mints,
        bytes[] calldata proofs
    ) public whenNotPaused onlyRole(MINT_REPORTER_ROLE) {
        // Make sure that the input arrays conform to length requirements
        uint256 numMints = mints.length;
        if (numMints > maxMints) {
            revert BadMintReport();
        }

        if (numMints != proofs.length) {
            revert BadMintProofsSize();
        }

        // Vet each set of mintID and add to history
        for (uint256 i; i < numMints; ) {
            Message memory mintMsg = mints[i];
            bytes32 mintID = _mintID(mintMsg);

            if (mintHistory[mintID] == MintState.UNREPORTED) {
                bytes memory proof = proofs[i];
                if (!_checkProof(mintID, proof)) {
                    revert BadProof(i, mintID, proof);
                }

                mintHistory[mintID] = MintState.REPORTED;
            } else {
                // Only warn instead of reverting, unlike old contract
                emit MintAlreadyReportedOrProcessed(mintID);
            }

            unchecked {
                ++i;
            }
        }
        emit MintsReported(reportId, numMints);
    }

    /**
     * Validate a mint (before executing it) if the amount is above
     * threshold.
     *
     * This function checks if our accounting has recorded a mint that
     * corresponds to this validate request. A mint can only be minted once.
     *
     * @param mintMsg The mint message to be minted.
     *
     * Emits {MintValidated}.
     */
    function validateMint(
        Message calldata mintMsg
    ) external override whenNotPaused onlyRole(MINT_VALIDATOR_ROLE) {
        bytes32 mintID = _mintID(mintMsg);
        MintState state = mintHistory[mintID];
        // Mint found and not minted
        if (state == MintState.REPORTED) {
            mintHistory[mintID] = MintState.MINTED;
            emit MintValidated(mintID, mintMsg.amount);
            return;
        }
        // Already withdrawn
        if (state == MintState.MINTED) {
            revert AlreadyMinted(mintID, mintMsg.amount);
        }
        // Not reported
        if (mintMsg.amount >= validateThreshold) {
            // We disallow a mint if it's not in the mintHistory and
            // the value is above the threshold.
            revert MintFailedValidation(mintID, mintMsg.amount);
        }
        // We don't have the mintID in the mintHistory, and the value of the
        // withdrawal is below the threshold, so we allow the withdrawal without
        // additional on-chain validation.
        //
        // Unlike in original Bascule, this contract records withdrawals
        // even when the validation threshold is raised.
        mintHistory[mintID] = MintState.MINTED;
        emit MintNotValidated(mintID, mintMsg.amount);
    }

    /// PRIVATE FUNCTIONS ///
    /**
     * Update the validate threshold.
     * @param newThreshold New threshold.
     *
     * Emits {UpdateValidateThreshold}.
     */
    function _updateValidateThreshold(uint256 newThreshold) internal {
        emit UpdateValidateThreshold(validateThreshold, newThreshold);
        validateThreshold = newThreshold;
    }

    /**
     * Checks the proof provided for deposit.
     * @param data signed data.
     * @param sig signatire.
     * @return Boolean value with result of the check: true - successful (the transaction should be allowed), false - failed (the transaction should be reverted)
     */
    function _checkProof(
        bytes32 data,
        bytes memory sig
    ) internal view returns (bool) {
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(
            data,
            sig
        );
        // ignore if bad signature
        if (err != ECDSA.RecoverError.NoError) {
            return false;
        }
        // if signer doesn't match consider data invalid
        if (signer != trustedSigner) {
            return false;
        }
        return true;
    }

    function _mintID(Message memory self) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    self.nonce,
                    block.chainid,
                    self.recipient,
                    self.toToken,
                    self.amount
                )
            );
    }
}
