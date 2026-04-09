// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IStrategyExecValidator
/// @notice Minimal policy hook for Strategy / SatelliteStrategy `exec` (`docs/spec/002-strategy.md` §A.2).
/// @dev Encoding of `validatorArgs` is implementation-defined (e.g. ABI-encoded `CallVerificationInput` for `MerkleCallAllowlist`).
interface IStrategyExecValidator {
    /// @notice Whether `(sender, to, value, data)` is allowed under `validatorArgs` for this validator.
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external view returns (bool);
}
