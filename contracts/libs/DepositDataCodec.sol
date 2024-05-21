// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

error WrongDataLength();

struct DepositData {
    uint256 chainId;
    address to;
    uint64 amount;
}


library DepositDataCodec {
    uint256 internal constant DATA_LENGTH = 96;

    function decode(bytes calldata data) internal pure returns (DepositData memory) {
        if (data.length != DATA_LENGTH) {
            revert WrongDataLength();
        }

        (uint256 chainId, address to, uint64 amount) = abi.decode(data, (uint256, address, uint64));
        return DepositData(chainId, to, amount);
    }
}

