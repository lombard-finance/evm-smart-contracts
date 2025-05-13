// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library LChainId {
    function get() internal view returns (bytes32) {
        // Ensure first byte is zero by masking the highest byte
        return
            bytes32(
                block.chainid &
                    0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
            );
    }
}
