// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FeeUtils} from "../../contracts/libs/FeeUtils.sol";

interface ILBTC is IERC20Metadata {
    function mint(address to, uint256 amount) external;
}

contract CBBTCPMM is PausableUpgradeable, AccessControlUpgradeable {
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for ILBTC;

    struct PMMStorage {
        IERC20Metadata cbbtc;
        ILBTC lbtc;
        uint256 multiplier;
        uint256 divider;

        uint256 stakeLimit;
        uint256 totalStake;
        address withdrawAddress;
        uint16 relativeFee;
    }
    
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.CBBTCPMM")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PMM_STORAGE_LOCATION = 0x41c6bdd99210344dba22372f555bef55094fdfda50b5100d427f58faa7ee0900;

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

    function __CBBTCPMM_init(address _lbtc, address _cbbtc, address admin, uint256 _stakeLimit, address withdrawAddress, uint16 _relativeFee) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        FeeUtils.validateCommission(_relativeFee);

        PMMStorage storage $ = _getPMMStorage();
        $.stakeLimit = _stakeLimit;
        $.withdrawAddress = withdrawAddress;
        
        $.lbtc = ILBTC(_lbtc);
        $.cbbtc = IERC20Metadata(_cbbtc);
        $.relativeFee = _relativeFee;

        uint256 lbtcDecimals = $.lbtc.decimals();
        uint256 cbbtcDecimals = $.cbbtc.decimals();
        if(lbtcDecimals <= cbbtcDecimals) {
            $.divider = 10 ** (cbbtcDecimals - lbtcDecimals);
            $.multiplier = 1;
        } else {
            $.multiplier = 10 ** (lbtcDecimals - cbbtcDecimals);
            $.divider = 1;
        }
    }

    function initialize(address _lbtc, address _cbbtc, address admin,uint256 _stakeLimit, address withdrawAddress, uint16 _relativeFee) external initializer {
        __Pausable_init();
        __AccessControl_init();
        __CBBTCPMM_init(_lbtc, _cbbtc, admin, _stakeLimit, withdrawAddress, _relativeFee);
    }

    function swapCBBTCToLBTC(uint256 amount) external whenNotPaused {
        PMMStorage storage $ = _getPMMStorage();

        ILBTC lbtc = $.lbtc;
        IERC20Metadata cbbtc = $.cbbtc;

        uint256 multiplier = $.multiplier;
        uint256 divider = $.divider;
        uint256 amountLBTC = (amount * multiplier / divider);
        uint256 amountCBBTC = (amountLBTC * divider / multiplier);
        if(amountLBTC == 0) revert ZeroAmount();

        if ($.totalStake + amountLBTC > $.stakeLimit) revert StakeLimitExceeded();

        // relative fee
        uint256 fee = FeeUtils.getRelativeFee(amountLBTC, $.relativeFee);

        $.totalStake += amountLBTC;
        cbbtc.safeTransferFrom(_msgSender(), address(this), amountCBBTC);
        lbtc.mint(_msgSender(), amountLBTC - fee);
        lbtc.mint(address(this), fee);
    }

    function withdrawCBBTC(uint256 amount) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        PMMStorage storage $ = _getPMMStorage();
        $.cbbtc.safeTransfer($.withdrawAddress, amount);
    }

    function withdrawLBTC(uint256 amount) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        PMMStorage storage $ = _getPMMStorage();
        $.lbtc.safeTransfer($.withdrawAddress, amount); 
    }

    function setWithdrawalAddress(address newWithdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getPMMStorage().withdrawAddress = newWithdrawAddress;
        emit WithdrawalAddressSet(newWithdrawAddress);
    }

    function setStakeLimit(uint256 newStakeLimit) external onlyRole(OPERATOR_ROLE) {
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
