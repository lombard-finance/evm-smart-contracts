// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {Actions} from "../libs/Actions.sol";
import {Assert} from "./libraries/Assert.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";

contract StakedLBTCOracle is
    IOracle,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    error WrongRatioSwitchTime();
    error RatioInitializedAlready();
    error TooBigRatioChange();
    error WrongToken();

    event Oracle_ConsortiumChanged(
        address indexed prevVal,
        address indexed newVal
    );
    event Oracle_TokenDetailsSet(address indexed token, bytes32 indexed denom);
    event Oracle_MaxAheadIntervalChanged(
        uint256 indexed prevVal,
        uint256 indexed newVal
    );
    event RatioThresholdUpdated(
        uint256 indexed prevVal,
        uint256 indexed newVal
    );

    /// @dev max ratio threshold (100% with 6 significant digits)
    uint32 private constant MAX_RATIO_THRESHOLD = uint32(100_000000);
    uint32 private constant RATIO_DEFAULT_SWITCH_INTERVAL = uint32(86400); // 60*60*24 (1 day)

    struct TokenDetails {
        bytes32 denomHash;
        address token;
    }

    struct StakedLBTCOracleStorage {
        INotaryConsortium consortium;
        TokenDetails tokenDetails;
        uint256 prevRatio;
        uint256 currRatio;
        uint256 switchTime;
        uint256 maxAheadInterval;
        /// @dev diff between current and new ratio in percent, measured to 6 signs (0.000001% ... 100%)
        uint32 ratioThreshold;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakedLBTCOracle")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKED_LBTC_ORACLE_STORAGE_LOCATION =
        0x773f82ddc38c293e7e76f6867b0d8bb7a6d27067018d4afff38772df98594200;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    function initialize(
        address owner_,
        address consortium_,
        address token_,
        bytes32 denomHash_,
        uint256 ratio_,
        uint256 switchTime_,
        uint256 maxAheadInterval_
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __StakedLBTCOracle_init(
            consortium_,
            token_,
            denomHash_,
            ratio_,
            switchTime_,
            maxAheadInterval_
        );
    }

    function __StakedLBTCOracle_init(
        address consortium_,
        address token_,
        bytes32 denomHash_,
        uint256 ratio_,
        uint256 switchTime_,
        uint256 maxAheadInterval_
    ) internal onlyInitializing {
        _changeConsortium(consortium_);
        _setTokenDetails(token_, denomHash_);
        _initRatio(ratio_, switchTime_);
        _changeMaxAheadInterval(maxAheadInterval_);
    }

    function changeConsortium(address newVal) external onlyOwner {
        _changeConsortium(newVal);
    }

    function consortium() external view returns (INotaryConsortium) {
        return _getStakedLBTCOracleStorage().consortium;
    }

    function changeMaxAheadInterval(uint256 newVal) external onlyOwner {
        _changeMaxAheadInterval(newVal);
    }

    function maxAheadInterval() external view returns (uint256) {
        return _getStakedLBTCOracleStorage().maxAheadInterval;
    }

    function token() external view override returns (address) {
        return _getStakedLBTCOracleStorage().tokenDetails.token;
    }

    function denomHash() external view override returns (bytes32) {
        return _getStakedLBTCOracleStorage().tokenDetails.denomHash;
    }

    function updateRatioThreshold(uint32 newThreshold) external onlyOwner {
        require(
            newThreshold < MAX_RATIO_THRESHOLD && newThreshold > 0,
            "new ratio threshold out of range"
        );
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        emit RatioThresholdUpdated($.ratioThreshold, newThreshold);
        $.ratioThreshold = newThreshold;
    }

    function publishNewRatio(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external {
        return _publishNewRatio(rawPayload, proof);
    }

    function ratioThreshold() external view returns (uint256) {
        return _getStakedLBTCOracleStorage().ratioThreshold;
    }

    function ratio() external view override returns (uint256) {
        return _ratio();
    }

    function nextRatio() external view returns (uint256, uint256) {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        return ($.currRatio, $.switchTime);
    }

    function getRate() external view override returns (uint256) {
        return Math.mulDiv(1 ether, 1 ether, _ratio(), Math.Rounding.Ceil);
    }

    function _publishNewRatio(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal {
        Assert.selector(rawPayload, Actions.RATIO_UPDATE);
        Actions.RatioUpdate memory action = Actions.ratioUpdate(rawPayload[4:]);
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        _validateRatio($, action.ratio, action.switchTime, action.denom);
        bytes32 payloadHash = sha256(rawPayload);
        $.consortium.checkProof(payloadHash, proof);
        _setNewRatio(action.ratio, action.switchTime);
    }

    function _initRatio(uint256 ratio_, uint256 switchTime_) internal {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        $.ratioThreshold = uint32(100000); // 0.1% by default
        if ($.currRatio != 0 || $.prevRatio != 0 || $.switchTime != 0) {
            revert RatioInitializedAlready();
        }
        $.currRatio = 1 ether;
        _setNewRatio(ratio_, switchTime_);
    }

    function _setNewRatio(uint256 ratio_, uint256 switchTime_) internal {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        if (block.timestamp >= $.switchTime) {
            $.prevRatio = $.currRatio;
        }
        $.currRatio = ratio_;
        $.switchTime = switchTime_;
        emit Oracle_RatioChanged($.prevRatio, $.currRatio, $.switchTime);
    }

    function _validateRatio(
        StakedLBTCOracleStorage storage $,
        uint256 ratio_,
        uint256 switchTime_,
        bytes32 denomHash_
    ) internal view {
        if (denomHash_ != $.tokenDetails.denomHash) {
            revert WrongToken();
        }
        if (
            $.switchTime >= switchTime_ ||
            switchTime_ > (block.timestamp + $.maxAheadInterval)
        ) {
            revert WrongRatioSwitchTime();
        }
        uint256 interval = switchTime_ - $.switchTime;
        uint256 threshold = Math.mulDiv(
            $.currRatio,
            interval * $.ratioThreshold,
            uint256(RATIO_DEFAULT_SWITCH_INTERVAL) *
                uint256(MAX_RATIO_THRESHOLD)
        );
        if (
            (($.currRatio > ratio_) && ($.currRatio - ratio_) > threshold) ||
            ((ratio_ > $.currRatio) && (ratio_ - $.currRatio) > threshold)
        ) {
            revert TooBigRatioChange();
        }
    }

    function _ratio() internal view returns (uint256) {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        if (block.timestamp >= $.switchTime) {
            return $.currRatio;
        }
        return $.prevRatio;
    }

    /// @dev not zero
    function _changeConsortium(address newVal) internal {
        Assert.zeroAddress(newVal);
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        emit Oracle_ConsortiumChanged(address($.consortium), newVal);
        $.consortium = INotaryConsortium(newVal);
    }

    /// @dev not zero
    function _setTokenDetails(address token_, bytes32 denomHash_) internal {
        Assert.zeroAddress(token_);
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        emit Oracle_TokenDetailsSet(token_, denomHash_);
        $.tokenDetails = TokenDetails({token: token_, denomHash: denomHash_});
    }

    function _changeMaxAheadInterval(uint256 newVal) internal {
        StakedLBTCOracleStorage storage $ = _getStakedLBTCOracleStorage();
        emit Oracle_MaxAheadIntervalChanged($.maxAheadInterval, newVal);
        $.maxAheadInterval = newVal;
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
