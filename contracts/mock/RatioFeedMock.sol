// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {IOracle} from "../LBTC/interfaces/IOracle.sol";

contract RatioFeedMock is IOracle {
    uint256 private _ratio;

    constructor() {
        _ratio = 1e18;
    }

    function setRatio(uint256 ratio) external {
        require(ratio <= 1e18, "Ratio must be lte 1e18");
        require(ratio > 0, "Ratio must be gt 0");
        _ratio = ratio;
    }

    function ratio() external view returns (uint256) {
        return _ratio;
    }

    function getRate() external view returns (uint256) {
        return 1e36 / _ratio;
    }

    function token() external view returns (address) {
        return address(0);
    }

    function denomHash() external view returns (bytes32) {
        return bytes32(0);
    }
}
