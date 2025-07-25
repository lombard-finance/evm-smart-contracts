// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Redeem {
    // bytes4(keccak256("payload(uint256,uint256,bytes32,bytes)")
    bytes4 internal constant REQUEST_SELECTOR = 0xf86c9e7b;

    function encodeRequest(
        uint256 amount,
        uint256 nonce,
        bytes calldata script
    ) internal view returns (bytes memory) {
        // amount and script already checked during fee calculation
        return
            abi.encodeWithSelector(
                REQUEST_SELECTOR,
                amount,
                nonce,
                bytes32(block.chainid),
                script
            );
    }
}
