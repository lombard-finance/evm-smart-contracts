// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Mock implementation of BoringVault
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract BoringVaultMock is ERC20Upgradeable {
    function deposit(address tokenAddress, uint256 amount, uint256 minimumMint) external {
        tokenAddress.safeTransferFrom(tokenAddress, _msgSender(), address(this), amount);
        _mint(to, amount);
    }
}
