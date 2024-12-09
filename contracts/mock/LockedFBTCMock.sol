// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {FBTCPartnerVault} from "../fbtc/PartnerVault.sol";

/**
 * @title Mock implementation of LockedFBTC contract
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract LockedFBTCMock {
    IERC20 public immutable fbtc;

    constructor(address fbtc_) {
        fbtc = IERC20(fbtc_);
    }

    function mintLockedFbtcRequest(uint256 amount) external returns (uint256) {
        fbtc.transferFrom(msg.sender, address(this), amount);
        return amount;
    }

    function redeemFbtcRequest(
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) external pure returns (bytes32, FBTCPartnerVault.Request memory) {
        FBTCPartnerVault.Request memory request = FBTCPartnerVault.Request({
            op: FBTCPartnerVault.Operation.Nop,
            status: FBTCPartnerVault.Status.Unused,
            nonce: 0,
            srcChain: bytes32("test"),
            srcAddress: bytes("test"),
            dstChain: bytes32("test"),
            dstAddress: bytes("test"),
            amount: amount,
            fee: 0,
            extra: bytes("extra")
        });

        return (bytes32("test"), request);
    }

    function confirmRedeemFbtc(uint256 amount) external {
        fbtc.transfer(msg.sender, amount);
    }
}
