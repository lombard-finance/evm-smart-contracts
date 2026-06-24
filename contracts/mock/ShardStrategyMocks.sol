// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../strategy/interfaces/IStrategy.sol";

/// @dev Minimal strategy stub for Shard tests: transfers tokens to caller on requestFunding.
contract MockStrategyForShard is IStrategy {
    using SafeERC20 for IERC20;

    function version() external pure override returns (string memory) {
        return "mock";
    }

    function requestFunding(IERC20 token, uint256 amount) external override {
        token.safeTransfer(msg.sender, amount);
    }
}
