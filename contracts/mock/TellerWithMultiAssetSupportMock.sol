// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Mock implementation of TellerWithMultiAssetSupport
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract TellerWithMultiAssetSupportMock is ERC20 {
    address public immutable vault;

    constructor() ERC20("Staked LBTC", "LBTCv") {
        vault = address(this);
    }

    function decimals() public view override returns (uint8) {
        return 8;
    }

    function deposit(ERC20 depositAsset, uint256 depositAmount, uint256 minimumMint) external returns (uint256) {
        // Transfer assets in
        depositAsset.transferFrom(_msgSender(), address(this), depositAmount);

        // Mint shares. We mock a 50 satoshi premium.
        _mint(msg.sender, depositAmount - 50);
        return depositAmount - 50;
    }
}
