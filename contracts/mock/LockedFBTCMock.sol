// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title Mock implementation of LockedFBTC contract
 * @author Lombard.Finance
 * @notice Use only for testing
 */
contract LockedFBTCMock {
    IERC20 public immutable fbtc;

    enum Operation {
        Nop, // starts from 1.
        Mint,
        Burn,
        CrosschainRequest,
        CrosschainConfirm
    }

    enum Status {
        Unused,
        Pending,
        Confirmed,
        Rejected
    }

    struct Request {
        Operation op;
        Status status;
        uint128 nonce; // Those can be packed into one slot in evm storage.
        bytes32 srcChain;
        bytes srcAddress;
        bytes32 dstChain;
        bytes dstAddress;
        uint256 amount; // Transfer value without fee.
        uint256 fee;
        bytes extra;
    }

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
    ) external pure returns (bytes32, Request memory) {
        Request memory request = Request({
            op: Operation.Nop,
            status: Status.Unused,
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

    function confirmRedeemFbtc(uint256 amount) external {}
}
