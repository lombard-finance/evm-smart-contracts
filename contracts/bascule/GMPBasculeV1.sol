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
contract GMPBasculeV1 is IGMPBascule, Pausable, AccessControlDefaultAdminRules {
    // Describes the state of a mint in the mintHistory.
    enum MintState {
        UNREPORTED, // unreported must be '0'
        REPORTED,
        MINTED
    }

    struct Mint {
        Message msg;
        MintState status;
    }

    // Role that can pause mint reporting
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    // Role that can report mint to the history
    bytes32 public constant MINT_REPORTER_ROLE =
        keccak256("MINT_REPORTER_ROLE");
    // Role that can validate mints
    bytes32 public constant MINT_VALIDATOR_ROLE =
        keccak256("MINT_VALIDATOR_ROLE");

    // Maximum number of batch mints it's possible to make at once
    uint256 public maxMints;

    // Mapping that tracks deposits on a different chain that can be used to
    // mint the corresponding funds on this chain.
    //
    // NOTE: The deposit identifier should be a hash with enough information to
    // uniquely identify the deposit transaction on the source chain and the
    // recipient, amount, and chain-id on this chain.
    // See README for more.
    mapping(bytes32 mintID => Mint mint) public mintHistory;

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
     * Set the maximum number of deposits that can be reported at once.
     * May only be invoked by the contract admin.
     *
     * @param aMaxMints New maximum number of deposits that can be reported at once.
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

            if (mintHistory[mintID].status == MintState.UNREPORTED) {
                bytes memory proof = proofs[i];
                if (!_checkProof(mintID, proof)) {
                    revert BadProof(i, mintID, proof);
                }

                mintHistory[mintID] = Mint(mintMsg, MintState.REPORTED);
            } else {
                // Only warn instead of reverting, unlike old contract
                emit MintAlreadyReported(mintID);
            }

            unchecked {
                ++i;
            }
        }
        emit MintsReported(reportId, numMints);
    }

    /**
     * Validate a mint (before executing it)
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
        Mint memory mint = mintHistory[mintID];
        // Mint found and not validated
        if (mint.status == MintState.REPORTED) {
            mintHistory[mintID].status = MintState.MINTED;
            emit MintValidated(mintID, mintMsg.amount);
            return;
        }
        // Already minted
        if (mint.status == MintState.MINTED) {
            revert AlreadyMinted(mintID, mintMsg.amount);
        }
        // Not reported
        revert NotReported(mintID);
    }

    /// PRIVATE FUNCTIONS ///

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
        if (trustedSigner == address(0)) {
            return true;
        }
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
            sha256(
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
