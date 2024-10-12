// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAdapter {
    function getFee(bytes32 _toChain, bytes32 _toContract, bytes32 _toAddress, uint256 _amount, bytes memory _payload) external view returns (uint256);
    function deposit(bytes32 _toChain, bytes32 _toContract, bytes32 _toAddress, uint256 _amount, bytes memory _payload) external payable;
}
