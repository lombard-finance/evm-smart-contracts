// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Consortium} from "../consortium/Consortium.sol";

contract ConsortiumMock is Consortium {
    /// @dev override proof check to allow any proof
    function _checkProof(
        bytes32 _payloadHash,
        bytes calldata _proof
    ) internal view override {}
}
