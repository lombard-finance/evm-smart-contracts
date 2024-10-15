// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Client } from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {IBurnMintERC20} from "@chainlink/contracts-ccip/src/v0.8/shared/token/ERC20/IBurnMintERC20.sol";
import { IPoolV1 } from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IPool.sol";
import { Pool } from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Pool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITokenPool {
    function getToken() external view returns (IERC20);
}

contract CCIPRouterMock {
    address tokenPool;
    /// @dev direct communication with this router so the call can get to the destination
    address destinationRouter;
    /// @dev injected offchain data
    bytes payloadAndProof;
    /// @dev fee to charge
    uint256 fee;

    function setTokenPool(address pool) external {
        tokenPool = pool;
    }

    function setOffchainData(bytes calldata payload, bytes calldata proof) external {
        payloadAndProof = abi.encode(payload, proof);
    }

    function setFee(uint256 fee_) external {
        fee = fee_;
    }

    function setDestinationRouter(address router) external {
        destinationRouter = router;
    }

    function getFee(
        uint64,
        Client.EVM2AnyMessage memory
    ) external view returns (uint256) {
        return fee;
    }

    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage memory message
    ) external payable returns (bytes32) {
        /// take the amount of assets from the sender and send it to 
        /// the token pool on the destination chain.
        /// @dev this mocks will use only the first token in the message
        /// which should be the only one included on it
        require(message.tokenAmounts.length == 1, "Misused mock: only one token is supported");

        // transfer the assets from the sender to the token pool
        uint256 amount = message.tokenAmounts[0].amount;
        IBurnMintERC20(message.tokenAmounts[0].token).transferFrom(msg.sender, tokenPool, amount);
        
        /// call the source token pool
        Pool.LockOrBurnOutV1 memory out = IPoolV1(tokenPool).lockOrBurn(
            Pool.LockOrBurnInV1({
                receiver: message.receiver,
                remoteChainSelector: destinationChainSelector,
                originalSender: msg.sender,
                amount: amount,
                localToken: message.tokenAmounts[0].token
            })
        );

        CCIPRouterMock(destinationRouter).receiveMessage(
            Pool.ReleaseOrMintInV1({
                originalSender: abi.encode(msg.sender),
                remoteChainSelector: uint64(block.chainid),
                receiver: abi.decode(message.receiver, (address)),
                amount: amount,
                localToken: address(0), // to be filled by destination router
                sourcePoolAddress: abi.encode(tokenPool),
                sourcePoolData: out.destPoolData,
                offchainTokenData: payloadAndProof
            })
        );

        /// identifier for it
        return keccak256(abi.encode(destinationChainSelector, message));
    }

    function receiveMessage(Pool.ReleaseOrMintInV1 memory data) external {
        data.localToken = address(ITokenPool(tokenPool).getToken());
        IPoolV1(tokenPool).releaseOrMint(data);
    }   

    function getOnRamp(uint64) external view returns (address) {
        // let the be the onRamp contract as well
        return address(this);
    }

    function isOffRamp(uint64, address onRamp) external view returns (bool) {
        // router is onRamp in every chain
        return onRamp == address(this);
    }

    /// @dev IRMN functions
    function isCursed(bytes16) external pure returns (bool) {
        /// never cursed 
        return false;
    }
}
