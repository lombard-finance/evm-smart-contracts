// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title Mock implementation of WBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract WBTCMock is ERC20Upgradeable {
    uint8 _decimals;
    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __ERC20_init("Wrapped BTC Mock", "WBTCMOCK");
        _decimals = 8;
    }

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public override view virtual returns (uint8) {
        return _decimals;
    }
}
