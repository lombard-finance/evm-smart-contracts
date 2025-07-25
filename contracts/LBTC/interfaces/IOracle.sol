// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IOracle {
    event Oracle_RatioChanged(
        uint256 prevVal,
        uint256 newVal,
        uint256 switchTime
    );

    function ratio() external view returns (uint256);
    function getRate() external view returns (uint256);
    function token() external view returns (address);
    function denomHash() external view returns (bytes32);
}
