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

    event Oracle_ConsortiumChanged(
        address indexed prevVal,
        address indexed newVal
    );
    event Oracle_TokenDetailsSet(address indexed token, bytes32 indexed denom);
    event Oracle_MaxAheadIntervalChanged(
        uint256 indexed prevVal,
        uint256 indexed newVal
    );

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
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakedLBTCOracle")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKED_LBTC_ORACLE_STORAGE_LOCATION =
        0x773f82ddc38c293e7e76f6867b0d8bb7a6d27067018d4afff38772df98594200;

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
        _setNewRatio(ratio_, switchTime_);
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

    function publishNewRatio(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external {
        return _publishNewRatio(rawPayload, proof);
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
        if (
            $.switchTime > action.switchTime ||
            (action.switchTime - block.timestamp) > $.maxAheadInterval
        ) {
            revert WrongRatioSwitchTime();
        }
        bytes32 payloadHash = sha256(rawPayload);
        $.consortium.checkProof(payloadHash, proof);
        _setNewRatio(action.ratio, action.switchTime);
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
