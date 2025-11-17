// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Interface of the GMP Bascule contract used by AssetRouter
interface IGMPBascule {
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
    event MintAlreadyReportedOrProcessed(bytes32 indexed mintID);

    /**
     * Event emitted when a withdrawal is validated.
     * @param mintAmount Amount of the mint.
     * @param mintID Unique identifier for a mint.
     */
    event MintValidated(bytes32 mintID, uint256 mintAmount);

    /**
     * Event emitted when a mint is allowed on this chain without validation.
     * @param mintID Unique identifier for a mint that took place on another chain and was minted on this chain.
     * @param mintAmount Amount of the mint.
     */
    event MintNotValidated(bytes32 mintID, uint256 mintAmount);

    /**
     * Event emitted when the validation threshold is updated.
     * @param oldThreshold The old threshold.
     * @param newThreshold The new threshold.
     */
    event UpdateValidateThreshold(uint256 oldThreshold, uint256 newThreshold);

    /// @dev Error when trusted address is zero
    error ZeroTrustedAddress();

    /**
     * Error when a mint fails validation.
     * This means the corresponding mint is not in the map.
     * @param mintID Unique identifier for mint that failed validation.
     * @param mintAmount Amount of the mint.
     */
    error MintFailedValidation(bytes32 mintID, uint256 mintAmount);

    /**
     * Error when trying to change the validation threshold to the same value.
     */
    error SameValidationThreshold();

    /**
     * Error on attempt to mint an already minted tokens.
     * @param mintID Unique identifier for mint that failed validation.
     * @param mintAmount Amount of the withdrawal.
     */
    error AlreadyMinted(bytes32 mintID, uint256 mintAmount);

    /// @dev Error when mint not reported on validation
    /// @param mintID Sha256 hash with GMP mint data
    error NotReported(bytes32 mintID);

    /**
     * Error when batch deposit arguments are non-conforming.
     */
    error BadMintReport();

    /**
     * Error when batch deposit size does not match the size of proofs.
     */
    error BadMintProofsSize();

    /**
     * Error when proof signer is not the trusted signer.
     */
    error BadProof(uint256 index, bytes32 mintID, bytes proof);

    /// @dev target chain field omitted, because always should be this chain
    struct Message {
        /// The nonce of GMP message.
        /// It makes each message unique. Assumes the Ledger chain is only one sender,
        /// otherwise need to include source chain.
        uint256 nonce;
        /// The recipient address that will own the minted token.
        address recipient;
        /// The address of the token
        address toToken;
        /// The hex-encoded amount of token that will be minted.
        uint256 amount;
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
    function validateMint(Message calldata mintMsg) external;
}
