// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @dev Rule body + Merkle proof supplied on each verification (`docs/spec/001-merkle-call-data-allowlist.md` §10).
struct CallVerificationInput {
    bytes ruleEncoded;
    bytes32[] merkleProof;
}

/// @title Merkle-based allowlist for call-data validation
/// @notice Normative interface per `docs/spec/001-merkle-call-data-allowlist.md` (recommended Solidity-facing interface).
interface IMerkleCallAllowlist {
    /// @notice Emitted when the active Merkle root changes (§2).
    event AllowlistRootUpdated(bytes32 oldRoot, bytes32 newRoot);

    /// @return The active allowlist Merkle root; `bytes32(0)` means deny-all (§2).
    function allowlistRoot() external view returns (bytes32);

    /// @return Domain separator used in leaf hashing (§8); matches `keccak256(abi.encodePacked(...))` on-chain.
    function domainSeparator() external view returns (bytes32);

    /// @notice Sets the active Merkle root. Access control is implementation-defined (§2).
    function setAllowlistRoot(bytes32 newRoot) external;

    /// @notice Returns whether `(sender, to, value, data)` is allowed under `input` for the active root (§10).
    /// @dev `sender` is the logical call sender from the integrator, not `msg.sender` of this call (§1).
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        CallVerificationInput calldata input
    ) external view returns (bool);
}
