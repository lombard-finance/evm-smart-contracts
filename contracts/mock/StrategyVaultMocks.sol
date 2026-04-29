// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVault} from "../vault/interfaces/IVault.sol";
import {IStrategyExecValidator} from "../vault/interfaces/IStrategyExecValidator.sol";

/// @dev Test ERC-20 for `MockVaultForStrategy`.
contract MockVaultToken is ERC20 {
    constructor() ERC20("VaultTok", "VTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
