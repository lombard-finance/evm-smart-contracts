// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/// @dev Pulls beacon proxy artifacts into the Hardhat build for tests.
contract BeaconImport {}
