// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {FeeUtils} from "../../../contracts/libs/FeeUtils.sol";

interface ILBTC {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external;
    function decimals() external view returns (uint256);
}

contract BTCBPMM is PausableUpgradeable, AccessControlUpgradeable {
    using SafeERC20 for IERC20Metadata;

    struct PMMStorage {
        IERC20Metadata btcb;
        ILBTC lbtc;
        uint256 multiplier;
        uint256 divider;

        uint256 stakeLimit;
        uint256 totalStake;
        address withdrawAddress;
        uint16 relativeFee;
    }
    
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BTCBPMM")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PMM_STORAGE_LOCATION = 0x75814abe757fd1afd999e293d51fa6528839552b73d81c6cc151470e3106f500;

    error StakeLimitExceeded();
    error UnauthorizedAccount(address account);
    error ZeroAmount();
    event StakeLimitSet(uint256 newStakeLimit);
    event WithdrawalAddressSet(address newWithdrawAddress);
    event RelativeFeeChanged(uint16 oldRelativeFee, uint16 newRelativeFee);
    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __BTCBPMM_init(address _lbtc, address _btcb, address admin, uint256 _stakeLimit, address withdrawAddress, uint16 _relativeFee) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        FeeUtils.validateCommission(_relativeFee);

        PMMStorage storage $ = _getPMMStorage();
        $.stakeLimit = _stakeLimit;
        $.withdrawAddress = withdrawAddress;
        
        $.lbtc = ILBTC(_lbtc);
        $.btcb = IERC20Metadata(_btcb);
        $.relativeFee = _relativeFee;

        uint256 lbtcDecimals = $.lbtc.decimals();
        uint256 btcbDecimals = $.btcb.decimals();
        if(lbtcDecimals <= btcbDecimals) {
            $.divider = 10 ** (btcbDecimals - lbtcDecimals);
            $.multiplier = 1;
        } else {
            $.multiplier = 10 ** (lbtcDecimals - btcbDecimals);
            $.divider = 1;
        }
    }

    function initialize(address _lbtc, address _btcb, address admin,uint256 _stakeLimit, address withdrawAddress, uint16 _relativeFee) external initializer {
        __Pausable_init();
        __AccessControl_init();
        __BTCBPMM_init(_lbtc, _btcb, admin, _stakeLimit, withdrawAddress, _relativeFee);
    }

    function swapBTCBToLBTC(uint256 amount) external whenNotPaused {
        PMMStorage storage $ = _getPMMStorage();

        ILBTC lbtc = $.lbtc;
        IERC20Metadata btcb = $.btcb;

        uint256 multiplier = $.multiplier;
        uint256 divider = $.divider;
        uint256 amountLBTC = (amount * multiplier / divider);
        uint256 amountBTCB = (amountLBTC * divider / multiplier);
        if(amountLBTC == 0) revert ZeroAmount();

        if ($.totalStake + amountLBTC > $.stakeLimit) revert StakeLimitExceeded();

        // relative fee
        uint256 fee = FeeUtils.getRelativeFee(amountLBTC, $.relativeFee);

        $.totalStake += amountLBTC;
        btcb.safeTransferFrom(_msgSender(), address(this), amountBTCB);
        lbtc.mint(_msgSender(), amountLBTC - fee);
        lbtc.mint(address(this), fee);
    }

    function withdrawBTCB(uint256 amount) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        PMMStorage storage $ = _getPMMStorage();
        $.btcb.transfer($.withdrawAddress, amount); 
    }

    function withdrawLBTC(uint256 amount) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        PMMStorage storage $ = _getPMMStorage();
        $.lbtc.transfer($.withdrawAddress, amount); 
    }

    function setWithdrawalAddress(address newWithdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getPMMStorage().withdrawAddress = newWithdrawAddress;
        emit WithdrawalAddressSet(newWithdrawAddress);
    }

    function setStakeLimit(uint256 newStakeLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getPMMStorage().stakeLimit = newStakeLimit;
        emit StakeLimitSet(newStakeLimit);
    }

    function setRelativeFee(uint16 newRelativeFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        FeeUtils.validateCommission(newRelativeFee);
        PMMStorage storage $ = _getPMMStorage();
        uint16 oldRelativeFee = $.relativeFee;
        $.relativeFee = newRelativeFee;
        emit RelativeFeeChanged(oldRelativeFee, newRelativeFee);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function stakeLimit() external view returns (uint256) {
        return _getPMMStorage().stakeLimit;
    }

    function relativeFee() external view returns (uint16) {
        return _getPMMStorage().relativeFee;
    }

    function remainingStake() external view returns (uint256) {
        PMMStorage storage $ = _getPMMStorage();
        if ($.totalStake > $.stakeLimit) return 0;
        return $.stakeLimit - $.totalStake;
    }

    function withdrawalAddress() external view returns (address) {
        return _getPMMStorage().withdrawAddress;
    }

    function _getPMMStorage() private pure returns (PMMStorage storage $) {
        assembly {
            $.slot := PMM_STORAGE_LOCATION
        }
    }
}
