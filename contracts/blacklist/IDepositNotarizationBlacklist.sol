// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDepositNotarizationBlacklist {
    event Blacklisted(bytes32 txId, uint32 vout);

    function isBlacklisted(bytes32 txId, uint32 vout) external returns (bool);
    function addToBlacklist(bytes32 txId, uint32[] calldata vouts) external;
}
