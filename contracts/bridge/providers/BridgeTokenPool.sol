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
/// @custom:security-contact legal@lombard.finance
contract BridgeTokenPool is LombardTokenPoolV2 {
    using SafeERC20 for IERC20Metadata;

    error ZeroTokenAdapter();

    /// @notice Get token adapter of token
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
        if (tokenAdapter == address(0)) {
            revert ZeroTokenAdapter();
        }
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
    /// @param lockOrBurnIn The bridge arguments from CCIP router.
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

        // verify bridge destination token equal to pool
        bytes32 bridgeDestToken = bridge.getAllowedDestinationToken(
            path.lChainId,
            getTokenAdapter
        );
        bytes32 poolDestToken = abi.decode(
            getRemoteToken(lockOrBurnIn.remoteChainSelector),
            (bytes32)
        );
        if (
            bridgeDestToken != poolDestToken && bridgeDestToken != path.adapter
        ) {
            revert RemoteTokenMismatch(bridgeDestToken, poolDestToken);
        }

        if (lockOrBurnIn.receiver.length != 32) {
            revert InvalidReceiver(lockOrBurnIn.receiver);
        }
        bytes32 decodedReceiver = abi.decode(lockOrBurnIn.receiver, (bytes32));

        (, bytes32 payloadHash) = bridge.deposit(
            path.lChainId,
            getTokenAdapter, // MODIFIED: replace the token with token adapter address
            lockOrBurnIn.originalSender,
            decodedReceiver,
            lockOrBurnIn.amount,
            path.allowedCaller
        );

        emit LockedOrBurned({
            remoteChainSelector: lockOrBurnIn.remoteChainSelector,
            token: address(i_token),
            sender: lockOrBurnIn.originalSender,
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

    function _requireAllowance() internal virtual override returns (bool) {
        return false;
    }
}
