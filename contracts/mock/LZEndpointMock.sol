// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EndpointV2Mock} from "@layerzerolabs/test-devtools-evm-hardhat/contracts/mocks/EndpointV2Mock.sol";

contract LZEndpointMock is EndpointV2Mock {
    constructor(uint32 _eid) EndpointV2Mock(_eid) {}
}
