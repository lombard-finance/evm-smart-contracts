// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library MessagePath {
    struct Details {
        bytes32 sourceContract;
        bytes32 sourceChain;
        bytes32 destinationChain;
    }

    function id(Details memory self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    self.sourceContract,
                    self.sourceChain,
                    self.destinationChain
                )
            );
    }
}
