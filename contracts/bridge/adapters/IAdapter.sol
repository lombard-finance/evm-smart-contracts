// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAdapter {
    /// @notice Thrown when msg.value is not enough to pay CCIP fee.
    error NotEnoughToPayFee(uint256 fee);

    function bridge() external view returns (address);
    function getFee(
        bytes32 _toChain,
        bytes32 _toContract,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) external view returns (uint256);
    function deposit(
        address _fromAddress,
        bytes32 _toChain,
        bytes32 _toContract,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) external payable;
}
