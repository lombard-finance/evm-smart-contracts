// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from"./IAdapter.sol";
import {LBTC} from "../../LBTC/LBTC.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract DefaultAdapter is IAdapter, Ownable2Step {
    LBTC lbtc;
    address bridge;

    error ZeroAddress();

    error NotBridge();

    event BridgeChanged(address indexed oldBridge, address indexed newBridge);

    modifier onlyBridge() {
        _onlyBridge();
        _;
    }

    constructor(address lbtc_, address owner_) Ownable(owner_) {
        lbtc = LBTC(lbtc_);
    }

    /**
     * @notice Change the bridge address
     * @param bridge_ New bridge address
     */
    function changeBridge(address bridge_) external onlyOwner {
        if(bridge_ == address(0)) {
            revert ZeroAddress();
        }
        address oldBridge = bridge;
        bridge = bridge_;
        emit BridgeChanged(oldBridge, bridge_);
    }

    /**
     * @notice Returns fee associated to this adapter
     * @dev Fixed to 0 as there is not provider involved
     */
    function getFee(bytes32, bytes32, bytes memory) external pure override returns (uint256) {
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

    /**
     * @notice Handle the withdrawal from the bridge
     * @dev This adapter needs to be registered as minter in LBTC
     * @param _recipient Address entitled to receive the withdrawal
     * @param _amount Amount of assets to withdraw
     */
    function withdraw(address _recipient, uint256 _amount, bytes memory) external override onlyBridge {
        // mint received assets
        lbtc.mint(_recipient, _amount);
    }

    function _onlyBridge() internal view {
        if(msg.sender != bridge) {
            revert NotBridge();
        }
    }
}
