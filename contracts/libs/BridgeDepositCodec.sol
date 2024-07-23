// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct BridgeDepositPayload {

    bytes32 fromContract; // validate event issuer
    bytes32 fromChainId; // validate sender chain id
    

    address toContract; // must be this contract (converted from bytes32)
    uint256 toChainId; // destination chain id (converted from bytes32)
    address toAddress; // recipient address (converted from bytes32)

    uint64 amount;

    bytes32 txHash; // hash of deposit tx
    uint32 eventIndex; // index of event (log)
}


library BridgeDepositCodec {
    uint256 internal constant DATA_LENGTH = 32 * 8;
    error WrongDataLength();
    error ZeroTxHash();
    error ZeroChainId();
    error ZeroAddress();
    error ZeroAmount();

    function create(
        bytes calldata data
    ) internal pure returns (BridgeDepositPayload memory) {
        if (data.length != DATA_LENGTH) {
            revert WrongDataLength();
        }

        (bytes32 fromContract, bytes32 fromChainId, bytes32 toContract, bytes32 toChainId, bytes32 toAddressBytes, uint64 amount, bytes32 txHash, uint32 eventIndex) = abi.decode(data, (bytes32,bytes32,bytes32,bytes32,bytes32,uint64,bytes32,uint32));

        if (fromChainId == bytes32(0)) {
            revert ZeroChainId();
        }

        if (txHash == bytes32(0)) {
            revert ZeroTxHash();
        }

        address toAddress = address(uint160(uint256(toAddressBytes)));
        if (toAddress == address(0)) {
            revert ZeroAddress();
        }

        if (amount == 0) {
            revert ZeroAmount();
        }

        return BridgeDepositPayload(fromContract, fromChainId, address(uint160(uint256(toContract))), uint256(toChainId), toAddress, amount, txHash, eventIndex);
    } 
}

