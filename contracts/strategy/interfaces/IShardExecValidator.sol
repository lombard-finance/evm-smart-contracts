// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IShardExecValidator
/// @notice Minimal policy hook for Shard / RemoteShard `exec`.
/// @dev Encoding of `validatorArgs` is implementation-defined (e.g. ABI-encoded `CallVerificationInput` for `MerkleAllowlistValidator`).
interface IShardExecValidator {
    /// @notice Whether an `exec` call with the given fields is permitted by policy.
    /// @param sender Logical caller passed by the shard (usually `msg.sender` of `exec`).
    /// @param to Target for the external call; may equal the calling shard’s address so calldata runs on this contract
    ///           (e.g. role grants). Validators should treat that self-target case as explicit policy, not an accident.
    /// @param value ETH forwarded with the call.
    /// @param data Calldata sent to `to`.
    /// @param validatorArgs Validator-specific encoding (e.g. ABI-encoded Merkle proof payload).
    /// @return allowed True if the call is allowed.
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external view returns (bool);
}
