// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PermitMock is ERC20, ERC20Permit {

    constructor(string memory name, string memory symbol)
    ERC20(name, symbol)
    ERC20Permit(name)
    {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}
