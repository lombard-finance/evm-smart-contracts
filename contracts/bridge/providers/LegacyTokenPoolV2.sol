// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenPool} from "@chainlink/contracts-ccip/contracts/pools/TokenPool.sol";

/// @dev USE ONLY FOR SCRIPTS
interface LegacyTokenPoolV2 {
    function setPath(
        uint64 remoteChainSelector,
        bytes32 lChainId,
        bytes calldata allowedCaller
    ) external;

    function applyChainUpdates(
        uint64[] calldata remoteChainSelectorsToRemove,
        TokenPool.ChainUpdate[] calldata chainsToAdd
    ) external;
}
