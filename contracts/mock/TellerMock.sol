// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BoringVaultMock} from "./BoringVaultMock.sol";
import {AccountantMock} from "./AccountantMock.sol";

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
        Asset memory _assetData = Asset(
            true,
            true,
            sharePremium
        );

        assetData[asset] = _assetData;
    }
}
