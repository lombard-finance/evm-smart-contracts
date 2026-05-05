// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IOracle {
    event Oracle_RatioChanged(
        uint256 prevVal,
        uint256 newVal,
        uint256 switchTime
    );

    /// @notice Staking conversion ratio (1e18-scaled); MUST be strictly greater than zero for any oracle
    ///         used where this value divides another amount (e.g. strategy converters). Governance/ops MUST
    ///         keep updates within that invariant; implementations SHOULD revert on invalid ratios.
    function ratio() external view returns (uint256);
    function getRate() external view returns (uint256);
    function token() external view returns (address);
    function denomHash() external view returns (bytes32);
}
