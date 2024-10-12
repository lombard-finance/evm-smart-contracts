// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AbstractAdapter} from "./AbstractAdapter.sol";

contract DefaultAdapter is AbstractAdapter {
    constructor(address lbtc_, address owner_) AbstractAdapter(lbtc_, owner_) {}

    /**
     * @notice Returns fee associated to this adapter
     * @dev Fixed to 0 as there is not provider involved
     */
    function getFee(bytes32, bytes32, bytes32, uint256, bytes memory) external pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice Handle the deposit to the bridge
     * @dev Must handle the burn, assets deposited must be sent to this adapter in advance
     * @param _amount Amount of assets deposited after deducting fees
     */
    function deposit(bytes32, bytes32, bytes32, uint256 _amount, bytes memory) external payable override onlyBridge {
        // burn received assets
        lbtc.burn(_amount);
    }
}
