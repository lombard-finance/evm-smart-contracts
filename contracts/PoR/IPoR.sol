// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPoR {
    /// @notice Error thrown when the lengths of the arrays do not match.
    error ArrayLengthMismatch();

    /// @notice Error thrown when the address already exists.
    error AddressAlreadyExists(string addressStr);

    /// @notice Error thrown when the address does not exist.
    error AddressDoesNotExist(string addressStr);

    /// @notice Error thrown when the message or signature is invalid.
    error InvalidMessageSignature(string addressStr, string messageOrPath, bytes signature);

    /// @notice Error thrown when the root pubkey is invalid.
    error InvalidRootPubkey();

    /// @notice Error thrown when the root pubkey id is invalid.
    error InvalidRootPubkeyId(string id);

    /// @notice Error thrown when the root pubkey already exists.
    error RootPubkeyAlreadyExists(string pubkey);

    /// @notice Error thrown when the id already exists.
    error IdAlreadyExists(string id);

    /// @notice Error thrown when the root pubkey does not exist.
    error RootPubkeyDoesNotExist(string pubkey);

    /// @notice Error thrown when the root pubkey cannot be deleted.
    error RootPubkeyCannotBeDeleted();
}