// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { BurnMintTokenPool } from "@chainlink/contracts-ccip/src/v0.8/ccip/pools/BurnMintTokenPool.sol";
import { Pool } from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {IBurnMintERC20} from "@chainlink/contracts-ccip/src/v0.8/shared/token/ERC20/IBurnMintERC20.sol";
import {IAdapter} from "./IAdapter.sol";
import {Bridge} from "../Bridge.sol";

interface IPayloadStore {
    function latestPayloadHashSent() external returns (bytes32);
}

contract TokenPool is BurnMintTokenPool {
    address adapter;

    /// @notice Error emitted when the proof is malformed
    error MalformedProof();

    constructor(
        address adapter_, 
        IBurnMintERC20 token,
        address[] memory allowlist,
        address rmnProxy,
        address router
    ) BurnMintTokenPool(token, allowlist, rmnProxy, router) {
        adapter = adapter_;
    }

    /// @notice Burn the token in the pool
    /// @dev The _validateLockOrBurn check is an essential security check
    function lockOrBurn(
        Pool.LockOrBurnInV1 calldata lockOrBurnIn
    ) external virtual override returns (Pool.LockOrBurnOutV1 memory) {
        _validateLockOrBurn(lockOrBurnIn);

        uint256 amountWithoutFee;
        bytes32 payloadHash;
        bytes memory payload;
        if(lockOrBurnIn.originalSender == adapter) {
            payloadHash = IPayloadStore(adapter).latestPayloadHashSent();
            // fee was deducted already in the bridge
            amountWithoutFee = lockOrBurnIn.amount;
        }
        else {
            (amountWithoutFee, payload) = _bridge().deposit(
                bytes32(uint256(lockOrBurnIn.remoteChainSelector)), 
                bytes32(lockOrBurnIn.receiver), 
                uint64(lockOrBurnIn.amount)
            );
            payloadHash = sha256(payload);
        }
        _burn(lockOrBurnIn.amount);

        emit Burned(msg.sender, lockOrBurnIn.amount);

        return Pool.LockOrBurnOutV1({
            destTokenAddress: getRemoteToken(lockOrBurnIn.remoteChainSelector), 
            destPoolData: abi.encodePacked(payloadHash)
        });
    }

    /// @notice Mint tokens from the pool to the recipient
    /// @dev The _validateReleaseOrMint check is an essential security check
    function releaseOrMint(
        Pool.ReleaseOrMintInV1 calldata releaseOrMintIn
    ) external virtual override returns (Pool.ReleaseOrMintOutV1 memory) {
        _validateReleaseOrMint(releaseOrMintIn);

        bytes32 payloadHash = bytes32(releaseOrMintIn.sourcePoolData);
        (bytes memory payload, bytes memory proof) = abi.decode(releaseOrMintIn.offchainTokenData, (bytes, bytes));

        if(sha256(payload) != payloadHash) {
            revert MalformedProof();
        }

        _bridge().withdraw(payload, proof);

        emit Minted(msg.sender, releaseOrMintIn.receiver, releaseOrMintIn.amount);

        return Pool.ReleaseOrMintOutV1({destinationAmount: releaseOrMintIn.amount});
    }

    function _bridge() internal view returns (Bridge) {
        return Bridge(IAdapter(adapter).bridge());
    }
}
