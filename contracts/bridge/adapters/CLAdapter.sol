// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@chainlink/contracts-ccip/src/v0.8/vendor/openzeppelin-solidity/v4.8.3/contracts/token/ERC20/IERC20.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {AbstractAdapter} from "./AbstractAdapter.sol";
import {IBridge} from "../IBridge.sol";
import {Pool} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {LombardTokenPool} from "./TokenPool.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20 as OZIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CCIP bridge adapter
 * @author Lombard.finance
 * @notice CLAdapter present an intermediary to enforce TokenPool compatibility
 */
contract CLAdapter is AbstractAdapter, Ownable, ReentrancyGuard {
    error CLZeroChain();
    error CLZeroChanSelector();
    error CLAttemptToOverrideChainSelector();
    error CLAttemptToOverrideChain();
    error CLRefundFailed(address, uint256);
    error CLUnauthorizedTokenPool(address);
    error ZeroPayload();
    error ReceiverTooBig();
    error AmountOverflow();

    event CLChainSelectorSet(bytes32, uint64);
    event CLTokenPoolDeployed(address);

    mapping(bytes32 => uint64) public getRemoteChainSelector;
    mapping(uint64 => bytes32) public getChain;
    uint128 public getExecutionGasLimit;
    LombardTokenPool public tokenPool; // 1-to-1 with adapter

    // store last state
    uint256 internal _lastBurnedAmount;
    bytes internal _lastPayload;

    mapping(address => uint256) public refunds;

    /// @notice msg.sender gets the ownership of the contract given
    /// token pool implementation
    constructor(
        IBridge bridge_,
        uint128 executionGasLimit_,
        //
        address ccipRouter_,
        address[] memory allowlist_,
        address rmnProxy_,
        bool attestationEnable_
    ) AbstractAdapter(bridge_) Ownable(_msgSender()) {
        _setExecutionGasLimit(executionGasLimit_);

        tokenPool = new LombardTokenPool(
            IERC20(address(bridge_.lbtc())),
            ccipRouter_,
            allowlist_,
            rmnProxy_,
            CLAdapter(this),
            attestationEnable_
        );
        tokenPool.transferOwnership(_msgSender());
        emit CLTokenPoolDeployed(address(tokenPool));
    }

    /// USER ACTIONS ///

    function withdrawRefund() external nonReentrant {
        uint256 refundAm = refunds[_msgSender()];
        refunds[_msgSender()] = 0;
        payable(_msgSender()).transfer(refundAm);
    }

    function getFee(
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) public view override returns (uint256) {
        return
            IRouterClient(tokenPool.getRouter()).getFee(
                getRemoteChainSelector[_toChain],
                _buildCCIPMessage(
                    abi.encodePacked(_toAddress),
                    _amount,
                    _payload
                )
            );
    }

    function initiateDeposit(
        uint64 remoteChainSelector,
        bytes calldata receiver,
        uint256 amount
    ) external returns (uint256 lastBurnedAmount, bytes memory lastPayload) {
        _onlyTokenPool();

        if (_lastPayload.length > 0) {
            // just return if already initiated
            lastBurnedAmount = _lastBurnedAmount;
            lastPayload = _lastPayload;
            _lastPayload = new bytes(0);
            _lastBurnedAmount = 0;
        } else {
            if (receiver.length > 32) revert ReceiverTooBig();
            if (amount >= 2 ** 64) revert AmountOverflow();
            SafeERC20.safeTransferFrom(
                OZIERC20(address(lbtc())),
                _msgSender(),
                address(this),
                amount
            );
            IERC20(address(lbtc())).approve(address(bridge), amount);
            (lastBurnedAmount, lastPayload) = bridge.deposit(
                getChain[remoteChainSelector],
                bytes32(receiver),
                uint64(amount)
            );
        }

        bridge.lbtc().burn(lastBurnedAmount);
    }

    function deposit(
        address fromAddress,
        bytes32 _toChain,
        bytes32,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory _payload
    ) external payable virtual override {
        _onlyBridge();

        // transfer assets from bridge
        SafeERC20.safeTransferFrom(
            OZIERC20(address(lbtc())),
            _msgSender(),
            address(this),
            _amount
        );

        // if deposit was initiated by adapter do nothing
        if (fromAddress == address(this)) {
            return;
        }

        _lastBurnedAmount = _amount;
        _lastPayload = _payload;

        uint64 chainSelector = getRemoteChainSelector[_toChain];

        Client.EVM2AnyMessage memory message = _buildCCIPMessage(
            abi.encodePacked(_toAddress),
            _amount,
            _payload
        );

        address router = tokenPool.getRouter();

        uint256 fee = IRouterClient(router).getFee(chainSelector, message);

        if (msg.value < fee) {
            revert NotEnoughToPayFee(fee);
        }
        if (msg.value > fee) {
            uint256 refundAm = msg.value - fee;
            refunds[fromAddress] += refundAm;
        }

        IERC20(address(lbtc())).approve(router, _amount);
        IRouterClient(router).ccipSend{value: fee}(chainSelector, message);
    }

    /// @dev same as `initiateWithdrawal` but without signatures opted in data
    function initWithdrawalNoSignatures(
        uint64 remoteSelector,
        bytes calldata onChainData
    ) external returns (uint64) {
        _onlyTokenPool();

        _receive(getChain[remoteSelector], onChainData);
        return bridge.withdraw(onChainData);
    }

    function initiateWithdrawal(
        uint64 remoteSelector,
        bytes calldata offChainData
    ) external returns (uint64) {
        _onlyTokenPool();

        (bytes memory payload, bytes memory proof) = abi.decode(
            offChainData,
            (bytes, bytes)
        );

        _receive(getChain[remoteSelector], payload);
        bridge.authNotary(payload, proof);
        return bridge.withdraw(payload);
    }

    /// ONLY OWNER FUNCTIONS ///

    function setExecutionGasLimit(uint128 newVal) external onlyOwner {
        _setExecutionGasLimit(newVal);
    }

    /// PRIVATE FUNCTIONS ///

    function _buildCCIPMessage(
        bytes memory _receiver,
        uint256 _amount,
        bytes memory _payload
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
                receiver: _receiver,
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

    function _onlyTokenPool() internal view {
        if (address(tokenPool) != _msgSender()) {
            revert CLUnauthorizedTokenPool(_msgSender());
        }
    }

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
