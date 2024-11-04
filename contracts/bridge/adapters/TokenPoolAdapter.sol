// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../../LBTC/LBTC.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {AbstractAdapter} from "./AbstractAdapter.sol";
import {IBridge} from "../IBridge.sol";
import {Pool} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {IBurnMintERC20} from "@chainlink/contracts-ccip/src/v0.8/shared/token/ERC20/IBurnMintERC20.sol";
import {TokenPool} from "@chainlink/contracts-ccip/src/v0.8/ccip/pools/TokenPool.sol";

contract TokenPoolAdapter is AbstractAdapter, TokenPool {
    uint256 gasLimit;
    bytes32 latestPayloadHashSent;

    /// @notice Emitted when gas limit is changed
    event GasLimitChanged(uint256 oldLimit, uint256 newLimit);

    /// @notice Error emitted when the proof is malformed
    error MalformedProof();

    /// @notice msg.sender gets the ownership of the contract given
    /// token pool implementation
    constructor(
        address ccipRouter_,
        IBurnMintERC20 token_,
        address[] memory allowlist_,
        address rmnProxy_,
        IBridge bridge_
    )
        AbstractAdapter(bridge_)
        TokenPool(token_, allowlist_, rmnProxy_, ccipRouter_)
    {
        gasLimit = 200_000;
    }

    /// USER ACTIONS ///

    function getFee(
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory
    ) external view returns (uint256) {
        return
            IRouterClient(address(s_router)).getFee(
                uint64(uint256(_toChain)),
                _buildCCIPMessage(_toAddress, _amount)
            );
    }

    function deposit(
        address fromAddress,
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _message
    ) external payable override {
        if (fromAddress == address(this)) {
            return;
        }

        Client.EVM2AnyMessage memory message = _buildCCIPMessage(
            _toAddress,
            _amount
        );

        uint256 fee = IRouterClient(address(s_router)).getFee(
            uint64(uint256(_toChain)),
            message
        );

        if (msg.value < fee) {
            revert NotEnoughToPayFee(fee);
        }

        latestPayloadHashSent = sha256(_message);

        IERC20(address(bridge.lbtc())).approve(address(s_router), _amount);
        IRouterClient(address(s_router)).ccipSend(
            uint64(uint256(_toChain)),
            message
        );
    }

    /// ONLY OWNER FUNCTIONS ///

    function setGasLimit(uint256 limit) external onlyOwner {
        uint256 oldLimit = gasLimit;
        gasLimit = limit;
        emit GasLimitChanged(oldLimit, limit);
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
        if (lockOrBurnIn.originalSender == address(this)) {
            payloadHash = latestPayloadHashSent;
            burnedAmount = lockOrBurnIn.amount;
        } else {
            // deposit assets, they will be burned in the proccess
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

        _receive(
            bytes32(uint256(releaseOrMintIn.remoteChainSelector)),
            payload
        );
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

    function _buildCCIPMessage(
        bytes32 _receiver,
        uint256 _amount
    ) private view returns (Client.EVM2AnyMessage memory) {
        // Set the token amounts
        Client.EVMTokenAmount[]
            memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({
            token: address(bridge.lbtc()),
            amount: _amount
        });

        return
            Client.EVM2AnyMessage({
                receiver: abi.encodePacked(_receiver),
                data: "", // No data
                tokenAmounts: tokenAmounts,
                extraArgs: Client._argsToBytes(
                    Client.EVMExtraArgsV2({
                        gasLimit: gasLimit,
                        allowOutOfOrderExecution: true
                    })
                ),
                feeToken: address(0) // let's pay with native tokens
            });
    }

    function _onlyOwner() internal view override onlyOwner {}
}
