// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev https://go.chainalysis.com/chainalysis-oracle-docs.html
interface ISanctionList {
    function isSanctioned(address addr) external view returns (bool);
}
