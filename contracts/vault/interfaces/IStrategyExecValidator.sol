// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IStrategyExecValidator
/// @notice Minimal policy hook for Strategy / SatelliteStrategy `exec`.
/// @dev Encoding of `validatorArgs` is implementation-defined (e.g. ABI-encoded `CallVerificationInput` for `MerkleAllowlistValidator`).
interface IStrategyExecValidator {
    /// @notice Whether an `exec` call with the given fields is permitted by policy.
    /// @param sender Logical caller passed by the strategy (usually `msg.sender` of `exec`).
    /// @param to Target contract for the external call.
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
