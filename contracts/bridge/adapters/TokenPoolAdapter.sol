// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from "./IAdapter.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LBTC} from "../../LBTC/LBTC.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {AbstractAdapter} from "./AbstractAdapter.sol";

contract TokenPoolAdapter is AbstractAdapter {
    IRouterClient ccipRouter;
    address tokenPool;
    uint256 gasLimit;
    bytes32 public latestPayloadHashSent;

    /// @notice Emitted when gas limit is changed
    event GasLimitChanged(uint256 oldLimit, uint256 newLimit);

    constructor(
        address ccipRouter_,
        address lbtc_,
        address owner_
    ) AbstractAdapter(lbtc_, owner_) {
        ccipRouter = IRouterClient(ccipRouter_);
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
            ccipRouter.getFee(
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
        if (fromAddress == tokenPool) {
            return;
        }

        Client.EVM2AnyMessage memory message = _buildCCIPMessage(
            _toAddress,
            _amount
        );

        uint256 fee = ccipRouter.getFee(uint64(uint256(_toChain)), message);

        if (msg.value < fee) {
            revert NotEnoughToPayFee(fee);
        }

        latestPayloadHashSent = sha256(_message);

        lbtc.approve(address(ccipRouter), _amount);
        ccipRouter.ccipSend(uint64(uint256(_toChain)), message);
    }

    /// ONLY OWNER FUNCTIONS ///

    function setTokenPool(address tokenPool_) external onlyOwner {
        tokenPool = tokenPool_;
    }

    function setGasLimit(uint256 limit) external onlyOwner {
        uint256 oldLimit = gasLimit;
        gasLimit = limit;
        emit GasLimitChanged(oldLimit, limit);
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
            token: address(lbtc),
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
}
