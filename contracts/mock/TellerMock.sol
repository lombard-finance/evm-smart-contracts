// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Mock implementation of BoringVault
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract TellerMock {
    BoringVaultMock public immutable vault;
    AccountantMock public immutable accountant;

    struct Asset {
        bool allowDeposits;
        bool allowWithdrawals;
        uint16 sharePremium;
    }

    mapping(address => Asset) public assetData;

    constructor(address _vault, address _accountant) {
        vault = BoringVaultMock(_vault);
        accountant = AccountantMock(_accountant);
    }

    function addAsset(address asset, uint16 sharePremium) external {
        Asset memory _assetData = Asset {
            allowDeposits: true,
            allowWithdrawals: true,
            sharePremium: 40
        };

        assetData[asset] = _assetData;
    }

    function deposit(address tokenAddress, uint256 amount, uint256 minimumMint) external {
        tokenAddress.safeTransferFrom(tokenAddress, _msgSender(), address(this), amount);
        _mint(to, amount);
    }
}
