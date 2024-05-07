// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

error WrongDataLength();

struct OutputWithPayload {
    uint256 chainId;
    address to;
    uint64 amount;
    bytes32 txId;
    uint32 index;
}


library OutputCodec {
    uint256 internal constant DATA_LENGTH = 32 * 5;

    function decode(bytes calldata data) internal pure returns (OutputWithPayload memory) {
        if (data.length != DATA_LENGTH) {
            revert WrongDataLength();
        }

        (uint256 chainId, address to, uint64 amount, bytes32 txId, uint32 index) = abi.decode(data, (uint256, address, uint64, bytes32, uint32));
        return OutputWithPayload(chainId, to, amount, txId, index);
    }
}

