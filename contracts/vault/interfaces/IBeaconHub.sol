// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IBeaconHub
/// @notice Beacon registry and BeaconProxy factory.
interface IBeaconHub {
    event BeaconSet(bytes32 indexed id, address indexed beacon);
    event Deployed(bytes32 indexed id, address indexed proxy, address caller);

    error BeaconNotSet(bytes32 id);
    error NotAContract(address addr);
    error ZeroAddress();

    /// @notice Deploy a BeaconProxy backed by the beacon registered for `id`.
    /// @param initData ABI-encoded initializer calldata forwarded to the proxy. Pass "" to skip.
    /// @return proxy  Address of the newly deployed BeaconProxy.
    function deploy(
        bytes32 id,
        bytes calldata initData
    ) external returns (address proxy);

    /// @notice Deploy a BeaconProxy at a deterministic CREATE2 address.
    /// @param salt Caller-chosen salt for CREATE2.
    /// @return proxy Deterministic address of the newly deployed BeaconProxy.
    function deployCreate2(
        bytes32 id,
        bytes32 salt,
        bytes calldata initData
    ) external returns (address proxy);
}
