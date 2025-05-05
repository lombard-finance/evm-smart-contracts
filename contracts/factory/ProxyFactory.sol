// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CREATE3} from "solmate/src/utils/CREATE3.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract ProxyFactory is AccessControl {
    error ProxyFactory_ZeroAddress();

    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    constructor(address admin, address deployer) {
        if (admin == address(0) || deployer == address(0)) {
            revert ProxyFactory_ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEPLOYER_ROLE, deployer);
    }

    function createTransparentProxy(
        address implementation,
        address admin,
        bytes memory data,
        bytes32 salt
    ) public onlyRole(DEPLOYER_ROLE) returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(TransparentUpgradeableProxy).creationCode,
            abi.encode(implementation, admin, data)
        );

        address proxy = CREATE3.deploy(salt, bytecode, 0);
        return proxy;
    }

    function getDeployed(bytes32 salt) public view returns (address) {
        return CREATE3.getDeployed(salt);
    }
}
