// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IOracle} from "./interfaces/IOracle.sol";

contract StakedLBTCOracle is
    IOracle,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    error WrongRatioSwitchTime();

    struct StakedLBTCOracleStorage {
        uint256 prevRatio;
        uint256 currRatio;
        uint64 switchTime;
    }
    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakedLBTCOracle")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKED_LBTC_ORACLE_STORAGE_LOCATION =
        0x773f82ddc38c293e7e76f6867b0d8bb7a6d27067018d4afff38772df98594200;

    constructor() {
        _disableInitializers();
    }
    function initialize(
        address owner_,
        uint256 ratio_,
        uint64 switchTime_
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __StakedLBTCOracle_init(ratio_, switchTime_);
    }

    function __StakedLBTCOracle_init(
        uint256 ratio_,
        uint64 switchTime_
    ) internal onlyInitializing {
        _publishNewRatio(ratio_, switchTime_);
    }

    function publishNewRatio(
        uint256 newVal,
        uint64 switchTime
    ) external onlyOwner {
        return _publishNewRatio(newVal, switchTime);
    }

    function ratio() external view override returns (uint256) {
        return _ratio();
    }

    function getRate() external view override returns (uint256) {
        return Math.mulDiv(1 ether, 1 ether, _ratio(), Math.Rounding.Ceil);
    }

    function _publishNewRatio(uint256 newVal, uint64 switchTime) internal {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        if (block.timestamp >= switchTime && $.switchTime > 0) {
            revert WrongRatioSwitchTime();
        }
        $.prevRatio = $.currRatio;
        $.currRatio = newVal;
        $.switchTime = switchTime;
    }

    function _ratio() internal view returns (uint256) {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        if (block.timestamp <= $.switchTime) {
            return $.currRatio;
        }
        return $.prevRatio;
    }

    function _getStakedLBTCOracleStorage()
        private
        pure
        returns (StakedLBTCOracleStorage storage $)
    {
        assembly {
            $.slot := STAKED_LBTC_ORACLE_STORAGE_LOCATION
        }
    }
}
