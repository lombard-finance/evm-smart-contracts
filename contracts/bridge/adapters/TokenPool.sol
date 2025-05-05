// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@chainlink/contracts-ccip/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/IERC20.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {IBridge} from "../IBridge.sol";
import {Pool} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {TokenPool} from "@chainlink/contracts-ccip/src/v0.8/ccip/pools/TokenPool.sol";
import {CLAdapter} from "./CLAdapter.sol";

contract LombardTokenPool is TokenPool {
    CLAdapter public adapter;

    /// @notice msg.sender gets the ownership of the contract given
    /// token pool implementation
    constructor(
        IERC20 lbtc_,
        address ccipRouter_,
        address[] memory allowlist_,
        address rmnProxy_,
        CLAdapter adapter_
    ) TokenPool(lbtc_, allowlist_, rmnProxy_, ccipRouter_) {
        adapter = adapter_;
    }

    /// @notice Burn the token in the pool
    /// @dev The _validateLockOrBurn check is an essential security check
    function lockOrBurn(
        Pool.LockOrBurnInV1 calldata lockOrBurnIn
    ) external virtual override returns (Pool.LockOrBurnOutV1 memory) {
        _validateLockOrBurn(lockOrBurnIn);

        // send out to burn
        i_token.approve(address(adapter), lockOrBurnIn.amount);
        (uint256 burnedAmount, bytes memory payload) = adapter.initiateDeposit(
            lockOrBurnIn.remoteChainSelector,
            lockOrBurnIn.receiver,
            lockOrBurnIn.amount
        );

        emit Burned(lockOrBurnIn.originalSender, burnedAmount);

        bytes memory destPoolData = abi.encode(sha256(payload));

        return
            Pool.LockOrBurnOutV1({
                destTokenAddress: getRemoteToken(
                    lockOrBurnIn.remoteChainSelector
                ),
                destPoolData: destPoolData
            });
    }

    /// @notice Mint tokens from the pool to the recipient
    /// @dev The _validateReleaseOrMint check is an essential security check
    function releaseOrMint(
        Pool.ReleaseOrMintInV1 calldata releaseOrMintIn
    ) external virtual override returns (Pool.ReleaseOrMintOutV1 memory) {
        _validateReleaseOrMint(releaseOrMintIn);

        uint64 amount = adapter.initiateWithdrawal(
            releaseOrMintIn.remoteChainSelector,
            releaseOrMintIn.sourcePoolData,
            releaseOrMintIn.offchainTokenData
        );

        emit Minted(msg.sender, releaseOrMintIn.receiver, uint256(amount));

        return Pool.ReleaseOrMintOutV1({destinationAmount: uint256(amount)});
    }
}
