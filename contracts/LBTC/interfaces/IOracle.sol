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
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
