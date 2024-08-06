// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20Upgradeable, IERC20 } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title Mock implementation of WBTC token
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract WBTCMock is ERC20Upgradeable {

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __ERC20_init("Wrapped BTC Mock", "WBTCMOCK");
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public override view virtual returns (uint8) {
        return 8;
    }
}
