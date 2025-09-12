// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IBridgeToken is IERC20Metadata {
    function mint(
        address to,
        uint256 amount,
        address feeAddress,
        uint256 feeAmount,
        bytes32 originTxId,
        uint256 originOutputIndex
    ) external;

    function unwrap(uint256 amount, uint256 chainId) external;

    function burn(uint256 value) external;

    function burnFrom(address account, uint256 value) external;
}
