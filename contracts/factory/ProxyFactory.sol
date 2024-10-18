// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CREATE3} from "solmate/src/utils/CREATE3.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract ProxyFactory {
    function createTransparentProxy(
        address implementation,
        address admin,
        bytes memory data,
        bytes32 salt
    ) public returns (address) {
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
