// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDepositNotarizationBlacklist {
    event Blacklisted(
        bytes32 indexed txId,
        uint32 indexed vout,
        address indexed operator
    );
    event Cleared(
        bytes32 indexed txId,
        uint32 indexed vout,
        address indexed operator
    );

    error AlreadyCleared(bytes32 txId, uint32 vout);
    error AlreadyBlacklisted(bytes32 txId, uint32 vout);

    function isBlacklisted(
        bytes32 txId,
        uint32 vout
    ) external view returns (bool);
    function addToBlacklist(bytes32 txId, uint32[] calldata vouts) external;
    function removeFromBlacklist(
        bytes32 txId,
        uint32[] calldata vouts
    ) external;
}
