// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Pool} from "@chainlink/contracts-ccip/contracts/libraries/Pool.sol";
import {TokenPool} from "@chainlink/contracts-ccip/contracts/pools/TokenPool.sol";

import {IERC20Metadata} from "@chainlink/contracts/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@chainlink/contracts/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBridgeV2} from "../IBridgeV2.sol";
import {LombardTokenPoolV2} from "./LombardTokenPoolV2.sol";

/// @notice TokenPool compatible with BridgeV2, CCIP 1.6 and Bridge Token (Avalanche BTC.b).
/// @dev Contract modified, because BridgeV2 accepts adapter contract as address of token.
contract BridgeTokenPool is LombardTokenPoolV2 {
    using SafeERC20 for IERC20Metadata;

    address public getTokenAdapter;

    /// @dev default decimals is zero, since adapter used only for BTC.b
    constructor(
        IBridgeV2 bridge_,
        IERC20Metadata token_,
        address tokenAdapter,
        address[] memory allowlist,
        address rmnProxy,
        address router
    ) LombardTokenPoolV2(bridge_, token_, allowlist, rmnProxy, router, 0) {
        getTokenAdapter = tokenAdapter;
        token_.safeIncreaseAllowance(tokenAdapter, type(uint256).max);
    }

    /// @notice Burn the token in the pool
    /// @dev The _validateLockOrBurn check is an essential security check
    /// @notice Burn tokens from the pool to initiate cross-chain transfer.
    /// @notice Outgoing messages (burn operations) are routed via `i_tokenMessenger.depositForBurnWithCaller`.
    /// The allowedCaller is preconfigured per destination domain and token pool version refer Domain struct.
    /// @dev Emits ITokenMessenger.DepositForBurn event.
    /// @dev Assumes caller has validated the destinationReceiver.
    function lockOrBurn(
        Pool.LockOrBurnInV1 calldata lockOrBurnIn
    ) public virtual override returns (Pool.LockOrBurnOutV1 memory) {
        _validateLockOrBurn(lockOrBurnIn);

        Path memory path = chainSelectorToPath[
            lockOrBurnIn.remoteChainSelector
        ];
        if (path.allowedCaller == bytes32(0)) {
            revert PathNotExist(lockOrBurnIn.remoteChainSelector);
        }

        if (lockOrBurnIn.receiver.length != 32) {
            revert InvalidReceiver(lockOrBurnIn.receiver);
        }
        bytes32 decodedReceiver = abi.decode(lockOrBurnIn.receiver, (bytes32));

        (, bytes32 payloadHash) = bridge.deposit(
            path.lChainId,
            address(getTokenAdapter), // MODIFIED: replace the token with token adapter address
            lockOrBurnIn.originalSender,
            decodedReceiver,
            lockOrBurnIn.amount,
            path.allowedCaller
        );

        emit LockedOrBurned({
            remoteChainSelector: lockOrBurnIn.remoteChainSelector,
            token: address(i_token),
            sender: msg.sender,
            amount: lockOrBurnIn.amount
        });

        return
            Pool.LockOrBurnOutV1({
                destTokenAddress: getRemoteToken(
                    lockOrBurnIn.remoteChainSelector
                ),
                destPoolData: abi.encode(payloadHash)
            });
    }
}
