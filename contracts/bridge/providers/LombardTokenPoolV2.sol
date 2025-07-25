// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITypeAndVersion} from "@chainlink/contracts/src/v0.8/shared/interfaces/ITypeAndVersion.sol";

import {Pool} from "@chainlink/contracts-ccip/contracts/libraries/Pool.sol";
import {TokenPool} from "@chainlink/contracts-ccip/contracts/pools/TokenPool.sol";

import {IERC20Metadata, IERC20} from "@chainlink/contracts/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@chainlink/contracts/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBridgeV2} from "../IBridgeV2.sol";
import {IMailbox} from "../../gmp/IMailbox.sol";

/// TokenPool compatible with BridgeV2 and CCIP 1.6
contract LombardTokenPoolV2 is TokenPool, ITypeAndVersion {
    using SafeERC20 for IERC20Metadata;

    error ZeroBridge();
    error ZeroLombardChainId();
    error PathNotExist(uint64 remoteChainSelector);
    error ExecutionError();
    error HashMismatch();
    error InvalidReceiver(bytes);
    error InvalidMessageVersion(uint8 expected, uint8 actual);
    error InvalidAllowedCaller(bytes);
    error ChainNotSupported();

    event PathSet(
        uint64 indexed remoteChainSelector,
        bytes32 indexed lChainId,
        bytes32 allowedCaller
    );
    event PathRemoved(
        uint64 indexed remoteChainSelector,
        bytes32 indexed lChainId,
        bytes32 allowedCaller
    );

    struct Path {
        bytes32 allowedCaller;
        bytes32 lChainId;
    }

    uint8 internal constant SUPPORTED_BRIDGE_MSG_VERSION = 1;
    string public constant typeAndVersion = "LombardTokenPool 1.6.0";

    IBridgeV2 public immutable bridge;
    mapping(uint64 chainSelector => Path path) internal chainSelectorToPath;

    constructor(
        IBridgeV2 bridge_,
        IERC20Metadata token_,
        address[] memory allowlist,
        address rmnProxy,
        address router
    ) TokenPool(token_, token_.decimals(), allowlist, rmnProxy, router) {
        if (address(bridge_) == address(0)) {
            revert ZeroBridge();
        }
        uint8 bridgeMsgVersion = bridge_.MSG_VERSION();
        if (bridgeMsgVersion != SUPPORTED_BRIDGE_MSG_VERSION)
            revert InvalidMessageVersion(
                SUPPORTED_BRIDGE_MSG_VERSION,
                bridgeMsgVersion
            );

        bridge = bridge_;
        // set allowance to max, spend less gas in future
        token_.safeIncreaseAllowance(address(bridge_), type(uint256).max);
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
    ) external virtual override returns (Pool.LockOrBurnOutV1 memory) {
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
            address(i_token),
            lockOrBurnIn.originalSender,
            decodedReceiver,
            lockOrBurnIn.amount,
            path.allowedCaller
        );

        emit Burned(lockOrBurnIn.originalSender, lockOrBurnIn.amount);

        return
            Pool.LockOrBurnOutV1({
                destTokenAddress: getRemoteToken(
                    lockOrBurnIn.remoteChainSelector
                ),
                destPoolData: abi.encode(payloadHash)
            });
    }

    /// @notice Mint tokens from the pool to the recipient
    /// @dev The _validateReleaseOrMint check is an essential security check
    /// @notice Mint tokens from the pool to the recipient
    /// * sourceTokenData is part of the verified message and passed directly from
    /// the offRamp so it is guaranteed to be what the lockOrBurn pool released on the
    /// source chain. It contains (nonce, sourceDomain) which is guaranteed by CCTP
    /// to be unique.
    /// * offchainTokenData is untrusted (can be supplied by manual execution), but we assert
    /// that (nonce, sourceDomain) is equal to the message's (nonce, sourceDomain) and
    /// receiveMessage will assert that Attestation contains a valid attestation signature
    /// for that message, including its (nonce, sourceDomain). This way, the only
    /// non-reverting offchainTokenData that can be supplied is a valid attestation for the
    /// specific message that was sent on source.
    function releaseOrMint(
        Pool.ReleaseOrMintInV1 calldata releaseOrMintIn
    ) external virtual override returns (Pool.ReleaseOrMintOutV1 memory) {
        _validateReleaseOrMint(releaseOrMintIn);

        (bytes memory rawPayload, bytes memory proof) = abi.decode(
            releaseOrMintIn.offchainTokenData,
            (bytes, bytes)
        );

        (bytes32 payloadHash, bool executed, ) = IMailbox(bridge.mailbox())
            .deliverAndHandle(rawPayload, proof);
        if (!executed) {
            revert ExecutionError();
        }
        // we know payload hash returned on source chain
        if (
            payloadHash != abi.decode(releaseOrMintIn.sourcePoolData, (bytes32))
        ) {
            revert HashMismatch();
        }

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

    /// @notice Sets the lChainId and allowed caller for a CCIP chain selector.
    function setPath(
        uint64 remoteChainSelector,
        bytes32 lChainId,
        bytes calldata allowedCaller
    ) external onlyOwner {
        if (!isSupportedChain(remoteChainSelector)) {
            revert ChainNotSupported();
        }

        if (lChainId == bytes32(0)) {
            revert ZeroLombardChainId();
        }

        // only remote pool is expected allowed caller
        if (!isRemotePool(remoteChainSelector, allowedCaller)) {
            revert InvalidRemotePoolForChain(
                remoteChainSelector,
                allowedCaller
            );
        }

        if (allowedCaller.length != 32) {
            revert InvalidAllowedCaller(allowedCaller);
        }
        bytes32 decodedAllowedCaller = abi.decode(allowedCaller, (bytes32));

        chainSelectorToPath[remoteChainSelector] = Path({
            lChainId: lChainId,
            allowedCaller: decodedAllowedCaller
        });

        emit PathSet(remoteChainSelector, lChainId, decodedAllowedCaller);
    }

    function removePath(uint64 remoteChainSelector) external onlyOwner {
        Path memory path = chainSelectorToPath[remoteChainSelector];

        if (path.allowedCaller == bytes32(0)) {
            revert PathNotExist(remoteChainSelector);
        }

        delete chainSelectorToPath[remoteChainSelector];

        emit PathRemoved(
            remoteChainSelector,
            path.lChainId,
            path.allowedCaller
        );
    }
}
