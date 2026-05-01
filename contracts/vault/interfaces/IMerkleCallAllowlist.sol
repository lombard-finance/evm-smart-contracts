// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @notice Payload proving an encoded rule is a member of the active Merkle tree.
/// @dev `ruleEncoded` layout is versioned by the validator (see `MerkleAllowlistValidator`).
struct CallVerificationInput {
    /// @dev Canonical encoded rule bytes (`RULE_VERSION` prefix and constraint layout).
    bytes ruleEncoded;
    /// @dev Merkle proof from leaf (`ruleEncoded`) to `allowlistRoot`.
    bytes32[] merkleProof;
}

/// @title IMerkleCallAllowlist
/// @notice Merkle-root–governed allowlist for validating arbitrary `(sender, to, value, data)` tuples off-chain and verifying on-chain.
interface IMerkleCallAllowlist {
    /// @notice Emitted when the active Merkle root changes.
    event AllowlistRootUpdated(bytes32 oldRoot, bytes32 newRoot);

    /// @return The active allowlist Merkle root; `bytes32(0)` means deny-all.
    function allowlistRoot() external view returns (bytes32);

    /// @return Domain separator used in leaf hashing; matches `keccak256(abi.encodePacked(...))` on-chain.
    function domainSeparator() external view returns (bytes32);

    /// @notice Sets the active Merkle root. Access control is implementation-defined.
    function setAllowlistRoot(bytes32 newRoot) external;

    /// @notice Returns whether `(sender, to, value, data)` is allowed under `input` for the active root.
    /// @dev `sender` is the logical call sender from the integrator, not `msg.sender` of this call.
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        CallVerificationInput calldata input
    ) external view returns (bool);
}
