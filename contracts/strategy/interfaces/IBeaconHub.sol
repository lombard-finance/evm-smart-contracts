// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IBeaconHub
/// @notice Registry of `UpgradeableBeacon` contracts keyed by `bytes32`, plus BeaconProxy deployment helpers.
/// @dev Implementations typically restrict `setBeacon` and `deploy` / `deployCreate2` via roles.
interface IBeaconHub {
    /// @notice Beacon implementation address for `id` was set or cleared.
    event BeaconSet(bytes32 indexed id, address indexed beacon);

    /// @notice A new BeaconProxy was created and tracked by the hub.
    event Deployed(
        bytes32 indexed id,
        address indexed proxy,
        address indexed caller
    );

    /// @dev No beacon registered for `id`, or beacon address is zero when deploy was attempted.
    error BeaconHub_BeaconNotSet(bytes32 id);

    /// @dev `setBeacon` rejected a non-contract address when a non-zero beacon was required.
    error BeaconHub_NotAContract(address addr);

    /// @dev Required address parameter was zero.
    error BeaconHub_ZeroAddress();

    /// @notice Deploy an EIP-1967 BeaconProxy using the beacon registered for `id`.
    /// @param id Beacon registry key (e.g. hash of implementation name/version).
    /// @param initData ABI-encoded initializer forwarded to the proxy; use empty bytes to skip initialization.
    /// @return proxy Address of the deployed BeaconProxy.
    function deploy(
        bytes32 id,
        bytes calldata initData
    ) external returns (address proxy);

    /// @notice Deploy a BeaconProxy at a deterministic CREATE2 address.
    /// @param id Beacon registry key.
    /// @param salt Caller-chosen CREATE2 salt (must yield a free address).
    /// @param initData ABI-encoded initializer forwarded to the proxy.
    /// @return proxy Address of the deployed BeaconProxy.
    function deployCreate2(
        bytes32 id,
        bytes32 salt,
        bytes calldata initData
    ) external returns (address proxy);
}
