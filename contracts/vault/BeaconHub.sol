// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

import {IBeaconHub} from "./interfaces/IBeaconHub.sol";

/// @title BeaconHub
/// @notice Upgradeable beacon registry and BeaconProxy factory.
/// @dev One hub can serve multiple vaults and deployers.
///      Beacon admins register UpgradeableBeacon addresses under arbitrary bytes32 ids.
///      Deployers call `deploy(id, initData)` to create new BeaconProxy instances.
contract BeaconHub is IBeaconHub, AccessControlDefaultAdminRulesUpgradeable {
    bytes32 public constant BEACON_ADMIN_ROLE = keccak256("BEACON_ADMIN_ROLE");
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.BeaconHub
    struct BeaconHubStorage {
        mapping(bytes32 id => address beacon) beacons;
        mapping(address proxy => bool) isDeployed;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BeaconHub")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BEACON_HUB_STORAGE_LOCATION =
        0x8848268cb0a9760555c426c1cb606566800a4fcee255ebce7ed6d56858cfeb00;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes access control for the hub (`DEFAULT_ADMIN_ROLE` only until admins grant beacon/deployer roles).
    /// @param initialDefaultAdminDelay_ Delay parameter for `AccessControlDefaultAdminRules`.
    /// @param defaultAdmin_ Initial default admin address.
    function initialize(
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_
    ) external initializer {
        if (defaultAdmin_ == address(0)) revert BeaconHub_ZeroAddress();
        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
    }

    /// @notice Returns the registered UpgradeableBeacon for `id`, or zero if unset.
    function beacon(bytes32 id) external view returns (address) {
        return _getBeaconHubStorage().beacons[id];
    }

    /// @notice Whether `proxy` was deployed through this hub (`deploy` / `deployCreate2`).
    function isDeployed(address proxy) external view returns (bool) {
        return _getBeaconHubStorage().isDeployed[proxy];
    }

    /// @notice Register or update the UpgradeableBeacon for `id`.
    /// @dev Pass address(0) to clear an id (disables deploy for that id).
    function setBeacon(
        bytes32 id,
        address beacon_
    ) external onlyRole(BEACON_ADMIN_ROLE) {
        if (beacon_ != address(0) && beacon_.code.length == 0)
            revert BeaconHub_NotAContract(beacon_);
        _getBeaconHubStorage().beacons[id] = beacon_;
        emit BeaconSet(id, beacon_);
    }

    /// @notice Deploy a BeaconProxy backed by the beacon registered for `id` and track it.
    function deploy(
        bytes32 id,
        bytes calldata initData
    ) external onlyRole(DEPLOYER_ROLE) returns (address proxy) {
        BeaconHubStorage storage $ = _getBeaconHubStorage();
        address beacon_ = $.beacons[id];
        if (beacon_ == address(0)) revert BeaconHub_BeaconNotSet(id);
        proxy = address(new BeaconProxy(beacon_, initData));
        $.isDeployed[proxy] = true;
        emit Deployed(id, proxy, _msgSender());
    }

    /// @notice Deploy a BeaconProxy at a deterministic CREATE2 address.
    /// @param salt Caller-chosen salt; controls the deployed address.
    /// @dev Use `keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode)))` off-chain to predict the proxy address.
    function deployCreate2(
        bytes32 id,
        bytes32 salt,
        bytes calldata initData
    ) external onlyRole(DEPLOYER_ROLE) returns (address proxy) {
        BeaconHubStorage storage $ = _getBeaconHubStorage();
        address beacon_ = $.beacons[id];
        if (beacon_ == address(0)) revert BeaconHub_BeaconNotSet(id);
        proxy = address(new BeaconProxy{salt: salt}(beacon_, initData));
        $.isDeployed[proxy] = true;
        emit Deployed(id, proxy, _msgSender());
    }

    function _getBeaconHubStorage()
        internal
        pure
        returns (BeaconHubStorage storage $)
    {
        assembly {
            $.slot := BEACON_HUB_STORAGE_LOCATION
        }
    }
}
