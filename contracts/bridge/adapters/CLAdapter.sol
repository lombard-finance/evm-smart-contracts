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
    error CLPayloadMismatch();
    error CLWrongPayloadHashLength();

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

    modifier onlyTokenPool() {
        if (address(tokenPool) != _msgSender()) {
            revert CLUnauthorizedTokenPool(_msgSender());
        }
        _;
    }

    /// @notice msg.sender gets the ownership of the contract given
    /// token pool implementation
    constructor(
        IBridge bridge_,
        uint128 executionGasLimit_,
        //
        address ccipRouter_,
        address[] memory allowlist_,
        address rmnProxy_
    ) AbstractAdapter(bridge_) Ownable(_msgSender()) {
        _setExecutionGasLimit(executionGasLimit_);

        tokenPool = new LombardTokenPool(
            IERC20(address(bridge_.lbtc())),
            ccipRouter_,
            allowlist_,
            rmnProxy_,
            CLAdapter(this)
        );
        tokenPool.transferOwnership(_msgSender());
        emit CLTokenPoolDeployed(address(tokenPool));
    }

    /// USER ACTIONS ///

    function withdrawRefund() external nonReentrant {
        uint256 refundAm = refunds[_msgSender()];
        refunds[_msgSender()] = 0;
        (bool success, ) = payable(_msgSender()).call{value: refundAm}("");
        if (!success) {
            revert CLRefundFailed(_msgSender(), refundAm);
        }
    }

    /**
     * @notice Calculate the fee to be paid for CCIP message routing.
     * @dev Ignores _toContract and _payload, because they're not a part of CCIP message.
     * @param _toChain Chain id of destination chain.
     * @param _toAddress Recipient address.
     * @param _amount The amount of LBTC to bridge.
     * @return The fee in native currency for CCIP message routing.
     */
    function getFee(
        bytes32 _toChain,
        bytes32 /* _toContract, */,
        bytes32 _toAddress,
        uint256 _amount,
        bytes memory /* _payload */
    ) public view override returns (uint256) {
        return
            IRouterClient(tokenPool.getRouter()).getFee(
                getRemoteChainSelector[_toChain],
                _buildCCIPMessage(abi.encodePacked(_toAddress), _amount)
            );
    }

    function initiateDeposit(
        uint64 remoteChainSelector,
        bytes calldata receiver,
        uint256 amount
    )
        external
        onlyTokenPool
        returns (uint256 lastBurnedAmount, bytes memory lastPayload)
    {
        SafeERC20.safeTransferFrom(
            OZIERC20(address(lbtc())),
            _msgSender(),
            address(this),
            amount
        );

        if (_lastPayload.length > 0) {
            // just return if already initiated
            lastBurnedAmount = _lastBurnedAmount;
            lastPayload = _lastPayload;
            _lastPayload = new bytes(0);
            _lastBurnedAmount = 0;
        } else {
            if (receiver.length > 32) revert ReceiverTooBig();
            if (amount >= 2 ** 64) revert AmountOverflow();
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
            _amount
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
    ) external onlyTokenPool returns (uint64) {
        _receive(getChain[remoteSelector], onChainData);
        return bridge.withdraw(onChainData);
    }

    function initiateWithdrawal(
        uint64 remoteSelector,
        bytes calldata payloadHash,
        bytes calldata offchainData
    ) external onlyTokenPool returns (uint64) {
        if (payloadHash.length != 32) {
            revert CLWrongPayloadHashLength();
        }

        (bytes memory payload, bytes memory proof) = abi.decode(
            offchainData,
            (bytes, bytes)
        );

        /// verify hash, because payload from offchainData is untrusted
        /// and would be replaced during manual execution.
        /// Bypass other payload checks against CCIP message
        /// because payload can only be generated in deposit transaction
        if (bytes32(payloadHash[:32]) != sha256(payload)) {
            revert CLPayloadMismatch();
        }

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
