// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IOracle {
    function ratio() external view returns (uint256);
    function getRate() external view returns (uint256);
    function token() external view returns (address);
    function denomHash() external view returns (bytes32);
}
