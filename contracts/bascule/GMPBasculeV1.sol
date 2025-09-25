// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/IBascule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Bascule contract for preventing bridge hacks from hitting the chain.
/// This is the on-chain component of an off-chain/on-chain system.
/// The off-chain component watches all relevant chains and reports
/// deposits to a deployment of this contract on *at most* one chain
/// (to prevent replay attacks). Then, this contract records the relevant
/// deposit transactions. Finally, when a bridge wants to withdraw funds,
/// it can validate that a corresponding deposit took place using the
/// validateWithdrawal function.
///
/// @custom:security-contact security@cubist.dev
contract GMPBasculeV1 is Pausable, AccessControlDefaultAdminRules {

    struct Message {
        /// The nonce of GMP message.
        /// It makes each message unique. Assumes the Ledger chain is only one sender,
        /// otherwise need to include source chain.
        uint256 nonce;
        /// The target chain where token will be minted.
        bytes32 target_chain;
        /// The recipient address that will own the minted token.
        bytes32 recipient;
        /// The address of the token
        bytes32 to_token;
        /// The hex-encoded amount of token that will be minted.
        uint256 amount;
    }

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
    // withdraw the corresponding funds on this chain.
    //
    // NOTE: The deposit identifier should be a hash with enough information to
    // uniquely identify the deposit transaction on the source chain and the
    // recipient, amount, and chain-id on this chain.
    // See README for more.
    mapping(bytes32 mintID => Mint mint) public mintHistory;

    // The address entitled to sign payload deposit reporter brings
    address public trustedSigner;

    /**
     * Event emitted when the maximum number of mints is changed.
     * @param numMints New maximum number of mints.
     */
    event MaxMintsUpdated(uint256 numMints);

    /**
     * Event emitted when the trusted signer is changed.
     * @param trustedSigner New trusted signer.
     */
    event TrustedSignerUpdated(address trustedSigner);

    /**
     * Event emitted when a batch of mints is reported.
     * @param reportId The report identifier. This is a convenience to make off-chain state management easier.
     * @param numMints The number of mints reported.
     */
    event MintsReported(bytes32 indexed reportId, uint256 numMints);

    /**
     * Warning event emitted when a mint was already reported.
     * @param mintID The ID of the already-reported mint.
     */
    event MintAlreadyReported(bytes32 indexed mintID);

    /**
     * Event emitted when a withdrawal is validated.
     * @param mintAmount Amount of the mint.
     * @param mintID Unique identifier for a mint.
     */
    event MintValidated(bytes32 mintID, uint256 mintAmount);

    /**
     * Error on attempt to mint an already minted tokens.
     * @param mintID Unique identifier for mint that failed validation.
     * @param mintAmount Amount of the withdrawal.
     */
    error AlreadyMinted(bytes32 mintID, uint256 mintAmount);

    error NotReported(bytes32 mintID);

    /**
     * Error when batch deposit arguments are non-conforming.
     */
    error BadMintReport();

    /**
     * Error when batch deposit size does not match the side of proofs.
     */
    error BadMintProofsSize();

    /**
     * Error when proof signer is not the trusted signer.
     */
    error BadProof(uint256 index, bytes32 mintID, bytes proof);

    /**
     * Create a new GMPBasculeV1.
     * @param aDefaultAdmin Address of the admin. This address should be controlled by a multisig.
     * @param aPauser Address of the account that may pause.
     * @param aMintReporter Address of the account that may report deposits on the source chain.
     * @param aMintValidator Address of the account that may validate withdrawals.
     * @param aMaxMints Maximum number of deposits that can be reported at once.
     */
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
     * Pause deposit reporting and withdrawal validation.
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * Unpause deposit reporting and withdrawal validation.
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
    ) public whenNotPaused onlyRole(MINT_VALIDATOR_ROLE) {
        bytes32 mintID = _mintID(mintMsg);
        Mint memory mint = mintHistory[mintID];
        // Deposit found and not withdrawn
        if (mint.status == MintState.REPORTED) {
            mintHistory[mintID].status = MintState.MINTED;
            emit MintValidated(mintID, mintMsg.amount);
            return;
        }
        // Already withdrawn
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
     * @return Boolean value with result of the chec: true - successful, false - failed
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

    function _mintID(Message memory self) internal pure returns (bytes32) {
        return sha256(abi.encode(self));
    }
}
