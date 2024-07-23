// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;



struct OutputWithPayload {
    uint256 chainId;
    address to;
    uint64 amount;
    bytes32 txId;
    uint32 index;
}


library OutputCodec {
    error WrongDataLength();
    error WrongChainIdEncoding();
    error WrongAddressEncoding();
    error WrongTxIdEncoding();
    error ZeroAmount();

    uint256 internal constant DATA_LENGTH = 32 * 5;

    function decode(bytes calldata data) internal pure returns (OutputWithPayload memory) {
        if (data.length != DATA_LENGTH) {
            revert WrongDataLength();
        }

        (uint256 chainId, address to, uint64 amount, bytes32 txId, uint32 index) = abi.decode(data, (uint256, address, uint64, bytes32, uint32));
        if (chainId == 0) {
            revert WrongChainIdEncoding();
        }
        if (to == address(0)) {
            revert WrongAddressEncoding();
        }
        if (txId == bytes32(0)) {
            revert WrongTxIdEncoding();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        return OutputWithPayload(chainId, to, amount, txId, index);
    }
}

