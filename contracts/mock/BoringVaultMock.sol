// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20.sol";

/**
 * @title Mock implementation of BoringVault
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract BoringVaultMock is ERC20Upgradeable {
    // Same decimals as LBTC.
    function decimals() public view override returns (uint8) {
        return 8;
    }

    function enter(address from, ERC20 asset, uint256 assetAmount, address to, uint256 shareAmount) external {
        // Transfer assets in
        if (assetAmount > 0) asset.safeTransferFrom(from, address(this), assetAmount);

        // Mint shares.
        _mint(to, shareAmount);
    }
}
