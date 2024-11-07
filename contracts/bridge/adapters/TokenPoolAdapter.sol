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
    error CLZeroChain();
    error CLZeroChanSelector();
    error CLAttemptToOverrideChainSelector();
    error CLAttemptToOverrideChain();
    error CLRefundFailed(address, uint256);

    event CLChainSelectorSet(bytes32, uint64);

    mapping(bytes32 => uint64) public getRemoteChainSelector;
    mapping(uint64 => bytes32) public getChain;
    uint128 public getExecutionGasLimit;

    /// @notice Emitted when gas limit is changed
    event GasLimitChanged(uint256 oldLimit, uint256 newLimit);

    /// @notice Error emitted when the proof is malformed
    error MalformedProof();

    /// @notice msg.sender gets the ownership of the contract given
    /// token pool implementation
    constructor(
        address ccipRouter_,
        address[] memory allowlist_,
        address rmnProxy_,
        IBridge bridge_,
        uint128 executionGasLimit_
    )
        AbstractAdapter(bridge_)
        TokenPool(
            IBurnMintERC20(address(bridge_.lbtc())),
            allowlist_,
            rmnProxy_,
            ccipRouter_
        )
    {
        _setExecutionGasLimit(executionGasLimit_);
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
                getRemoteChainSelector[_toChain],
                _buildCCIPMessage(
                    getRemotePool(getRemoteChainSelector[_toChain]),
                    _amount
                )
            );
    }

    function deposit(
        address fromAddress,
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory
    ) external payable override {
        if (fromAddress == address(this)) {
            return;
        }

        Client.EVM2AnyMessage memory message = _buildCCIPMessage(
            getRemotePool(getRemoteChainSelector[_toChain]),
            _amount
        );

        uint256 fee = IRouterClient(address(s_router)).getFee(
            getRemoteChainSelector[_toChain],
            message
        );

        if (msg.value < fee) {
            revert NotEnoughToPayFee(fee);
        }
        if (msg.value > fee) {
            uint256 refundAm = msg.value - fee;
            (bool success, ) = payable(fromAddress).call{value: refundAm}("");
            if (!success) {
                revert CLRefundFailed(fromAddress, refundAm);
            }
        }

        IERC20(address(bridge.lbtc())).approve(address(s_router), _amount);
        IRouterClient(address(s_router)).ccipSend{value: fee}(
            getRemoteChainSelector[_toChain],
            message
        );
    }

    /// ONLY OWNER FUNCTIONS ///

    function setExecutionGasLimit(uint128 newVal) external onlyOwner {
        _setExecutionGasLimit(newVal);
    }

    /// TOKEN POOL LOGIC ///

    /// @notice Burn the token in the pool
    /// @dev The _validateLockOrBurn check is an essential security check
    function lockOrBurn(
        Pool.LockOrBurnInV1 calldata lockOrBurnIn
    ) external virtual override returns (Pool.LockOrBurnOutV1 memory) {
        _validateLockOrBurn(lockOrBurnIn);

        uint256 burnedAmount;

        if (lockOrBurnIn.originalSender == address(this)) {
            burnedAmount = lockOrBurnIn.amount;
        } else {
            // deposit assets, they will be burned in the proccess
            i_token.approve(address(bridge), lockOrBurnIn.amount);
            (uint256 amountWithoutFee, ) = bridge.deposit(
                getChain[lockOrBurnIn.remoteChainSelector],
                bytes32(lockOrBurnIn.receiver),
                uint64(lockOrBurnIn.amount)
            );
            burnedAmount = amountWithoutFee;
        }

        emit Burned(lockOrBurnIn.originalSender, burnedAmount);

        return
            Pool.LockOrBurnOutV1({
                destTokenAddress: getRemoteToken(
                    lockOrBurnIn.remoteChainSelector
                ),
                destPoolData: ""
            });
    }

    /// @notice Mint tokens from the pool to the recipient
    /// @dev The _validateReleaseOrMint check is an essential security check
    function releaseOrMint(
        Pool.ReleaseOrMintInV1 calldata releaseOrMintIn
    ) external virtual override returns (Pool.ReleaseOrMintOutV1 memory) {
        _validateReleaseOrMint(releaseOrMintIn);

        (bytes memory payload, bytes memory proof) = abi.decode(
            releaseOrMintIn.offchainTokenData,
            (bytes, bytes)
        );

        _receive(getChain[releaseOrMintIn.remoteChainSelector], payload);
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
        bytes memory _receiver,
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
                data: "",
                tokenAmounts: tokenAmounts,
                extraArgs: Client._argsToBytes(
                    Client.EVMExtraArgsV2({
                        gasLimit: getExecutionGasLimit,
                        allowOutOfOrderExecution: true
                    })
                ),
                feeToken: address(0) // let's pay with native tokens
            });
    }

    function _onlyOwner() internal view override onlyOwner {}

    function _setExecutionGasLimit(uint128 newVal) internal {
        emit ExecutionGasLimitSet(getExecutionGasLimit, newVal);
        getExecutionGasLimit = newVal;
    }

    /**
     * @notice Allows owner set chain selector for chain id
     * @param chain ABI encoded chain id
     * @param chainSelector Chain selector of chain id (https://docs.chain.link/ccip/directory/testnet/chain/)
     */
    function setRemoteChainSelector(
        bytes32 chain,
        uint64 chainSelector
    ) external onlyOwner {
        if (chain == bytes32(0)) {
            revert CLZeroChain();
        }
        if (chainSelector == 0) {
            revert CLZeroChain();
        }
        if (getRemoteChainSelector[chain] != 0) {
            revert CLAttemptToOverrideChainSelector();
        }
        if (getChain[chainSelector] != bytes32(0)) {
            revert CLAttemptToOverrideChain();
        }
        getRemoteChainSelector[chain] = chainSelector;
        getChain[chainSelector] = chain;
        emit CLChainSelectorSet(chain, chainSelector);
    }
}
