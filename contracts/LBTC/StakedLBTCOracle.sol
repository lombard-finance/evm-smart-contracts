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
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700; 

    constructor() {
        _disableInitializers();
    }
    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
    }

    function publishNewRatio(uint256 newVal, uint64 switchTime) external onlyOwner {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        if (block.timestamp >= switchTime && $.switchTime > 0) {
            revert WrongRatioSwitchTime();
        }
        $.prevRatio = $.currRatio;
        $.currRatio = newVal;
        $.switchTime = switchTime;
    }

    function ratio() external view override returns (uint256) {
        return _ratio();
    }

    function getRate() external view override returns (uint256) {
        return Math.mulDiv(1 ether, 1 ether, _ratio(), Math.Rounding.Ceil);
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