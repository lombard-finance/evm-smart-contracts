// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVault} from "../vault/interfaces/IVault.sol";

/// @dev Test ERC-20 for `MockVaultForStrategy`.
contract MockVaultToken is ERC20 {
    constructor() ERC20("VaultTok", "VTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal vault stub for Strategy tests: transfers tokens to caller on requestFunding.
contract MockVaultForStrategy is IVault {
    using SafeERC20 for IERC20;

    function version() external pure override returns (string memory) {
        return "mock";
    }

    function requestFunding(IERC20 token, uint256 amount) external override {
        token.safeTransfer(msg.sender, amount);
    }
}
