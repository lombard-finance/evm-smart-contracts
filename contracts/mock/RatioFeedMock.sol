// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracle} from "../LBTC/interfaces/IOracle.sol";

contract RatioFeedMock is IOracle {
    uint256 private _ratio;
    uint256 private _updatedAt;

    constructor() {
        _ratio = 1e18;
        _updatedAt = block.timestamp;
    }

    function setRatio(uint256 newRatio) external {
        require(newRatio <= 1e18, "Ratio must be lte 1e18");
        require(newRatio > 0, "Ratio must be gt 0");
        _ratio = newRatio;
        _updatedAt = block.timestamp;
    }

    function ratio() external view returns (uint256) {
        return _ratio;
    }

    function getRate() external view returns (uint256) {
        return Math.mulDiv(1 ether, 1 ether, _ratio, Math.Rounding.Ceil);
    }

    function token() external view returns (address) {
        return address(0);
    }

    function denomHash() external view returns (bytes32) {
        return bytes32(0);
    }

    /// @dev Chainlink-compatible rate feed (18 decimals), matching `StakedLBTCOracle.getRate()`.
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        uint256 rate = Math.mulDiv(
            1 ether,
            1 ether,
            _ratio,
            Math.Rounding.Ceil
        );
        return (uint80(1), int256(rate), _updatedAt, _updatedAt, uint80(1));
    }
}
