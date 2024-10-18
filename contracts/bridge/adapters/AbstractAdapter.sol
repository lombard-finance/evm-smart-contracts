// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from "./IAdapter.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LBTC} from "../../LBTC/LBTC.sol";

abstract contract AbstractAdapter is IAdapter, Ownable2Step {
    error ZeroAddress();

    error NotBridge();

    event BridgeChanged(address indexed oldBridge, address indexed newBridge);

    LBTC lbtc;
    address public override bridge;

    constructor(address lbtc_, address owner_) Ownable(owner_) {
        _notZero(lbtc_);

        lbtc = LBTC(lbtc_);
    }

    modifier onlyBridge() {
        _onlyBridge();
        _;
    }

    /**
     * @notice Change the bridge address
     * @param bridge_ New bridge address
     */
    function changeBridge(address bridge_) external onlyOwner {
        _notZero(bridge_);

        address oldBridge = bridge;
        bridge = bridge_;
        emit BridgeChanged(oldBridge, bridge_);
    }

    function _onlyBridge() internal view {
        if (msg.sender != bridge) {
            revert NotBridge();
        }
    }

    function _notZero(address addr) internal pure {
        if (addr == address(0)) {
            revert ZeroAddress();
        }
    }
}
