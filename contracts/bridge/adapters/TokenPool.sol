// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenPool} from "@chainlink/contracts-ccip/src/v0.8/ccip/pools/TokenPool.sol";
import {Pool} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {IBurnMintERC20} from "@chainlink/contracts-ccip/src/v0.8/shared/token/ERC20/IBurnMintERC20.sol";
import {TokenPoolAdapter} from "./TokenPoolAdapter.sol";
import {IBridge} from "../IBridge.sol";

contract LBTCTokenPool is TokenPool {
    TokenPoolAdapter adapter;

    /// @notice Error emitted when the proof is malformed
    error MalformedProof();

    constructor(
        address adapter_,
        IBurnMintERC20 token,
        address[] memory allowlist,
        address rmnProxy,
        address router
    ) TokenPool(token, allowlist, rmnProxy, router) {
        adapter = TokenPoolAdapter(adapter_);
    }

    /// TOKEN POOL LOGIC ///

    /// @notice Burn the token in the pool
    /// @dev The _validateLockOrBurn check is an essential security check
    function lockOrBurn(
        Pool.LockOrBurnInV1 calldata lockOrBurnIn
    ) external virtual override returns (Pool.LockOrBurnOutV1 memory) {
        _validateLockOrBurn(lockOrBurnIn);

        uint256 burnedAmount;
        bytes32 payloadHash;
        if (lockOrBurnIn.originalSender == address(adapter)) {
            payloadHash = adapter.latestPayloadHashSent();
            burnedAmount = lockOrBurnIn.amount;
        } else {
            // deposit assets, they will be burned in the proccess
            IBridge bridge = _bridge();
            i_token.approve(address(bridge), lockOrBurnIn.amount);
            (uint256 amountWithoutFee, bytes memory payload) = bridge.deposit(
                bytes32(uint256(lockOrBurnIn.remoteChainSelector)),
                bytes32(lockOrBurnIn.receiver),
                uint64(lockOrBurnIn.amount)
            );
            payloadHash = sha256(payload);
            burnedAmount = amountWithoutFee;
        }

        emit Burned(lockOrBurnIn.originalSender, burnedAmount);

        return
            Pool.LockOrBurnOutV1({
                destTokenAddress: getRemoteToken(
                    lockOrBurnIn.remoteChainSelector
                ),
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
        (bytes memory payload, bytes memory proof) = abi.decode(
            releaseOrMintIn.offchainTokenData,
            (bytes, bytes)
        );

        if (sha256(payload) != payloadHash) {
            revert MalformedProof();
        }

        adapter.receivePayload(
            bytes32(uint256(releaseOrMintIn.remoteChainSelector)),
            payload
        );
        IBridge bridge = _bridge();
        bridge.authNotary(payload, proof);
        bridge.withdraw(payload);

        emit Minted(
            msg.sender,
            releaseOrMintIn.receiver,
            releaseOrMintIn.amount
        );

        return
            Pool.ReleaseOrMintOutV1({
                destinationAmount: releaseOrMintIn.amount
            });
    }

    /// PRIVATE FUNCTIONS ///

    function _bridge() internal view returns (IBridge) {
        return adapter.bridge();
    }
}
