// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IMinteable {
    function mint(address to, uint256 amount) external;
}

contract BTCBPMM is PausableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    struct PMMStorage {
        uint256 stakeLimit;
        uint256 totalStake;
        address withdrawAddress;
    }

    IERC20 public immutable btcb;
    IMinteable public immutable lbtc;
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BTCBPMM")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PMM_STORAGE_LOCATION = 0x75814abe757fd1afd999e293d51fa6528839552b73d81c6cc151470e3106f500;

    error StakeLimitExceeded();
    error UnauthorizedAccount(address account);

    event StakeLimitSet(uint256 newStakeLimit);
    event WithdrawalAddressSet(address newWithdrawAddress);

    constructor(address _lbtc, address _btcb) {
        _disableInitializers();

        lbtc = IMinteable(_lbtc);
        btcb = IERC20(_btcb);
    }

    modifier onlyAdminOrTimelock() {
        _onlyAdminOrTimelock(_msgSender());
        _;
    }

    function __BTCBPMM_init(uint256 _stakeLimit, address withdrawAddress) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _getPMMStorage().stakeLimit = _stakeLimit;
        _getPMMStorage().withdrawAddress = withdrawAddress;
    }

    function initialize(uint256 _stakeLimit, address withdrawAddress) external initializer {
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __BTCBPMM_init(_stakeLimit, withdrawAddress);
    }

    function swapBTCBToLBTC(uint256 amount) external whenNotPaused {
        if (_getPMMStorage().totalStake + amount > _getPMMStorage().stakeLimit) revert StakeLimitExceeded();

        _getPMMStorage().totalStake += amount;
        btcb.transferFrom(_msgSender(), address(this), amount);
        lbtc.mint(_msgSender(), amount);
    }

    function withdrawBTCB(uint256 amount) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        _getPMMStorage().totalStake -= amount;

        btcb.transfer(_getPMMStorage().withdrawAddress, amount);
    }

    function setWithdrawalAddress(address newWithdrawAddress) external onlyRole(TIMELOCK_ROLE) {
        _getPMMStorage().withdrawAddress = newWithdrawAddress;
        emit WithdrawalAddressSet(newWithdrawAddress);
    }

    function setStakeLimit(uint256 newStakeLimit) external onlyRole(TIMELOCK_ROLE) {
        _getPMMStorage().stakeLimit = newStakeLimit;
        emit StakeLimitSet(newStakeLimit);
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

    function remainingStake() external view returns (uint256) {
        PMMStorage storage $ = _getPMMStorage();
        return $.stakeLimit - $.totalStake;
    }

    function withdrawalAddress() external view returns (address) {
        return _getPMMStorage().withdrawAddress;
    }

    function _onlyAdminOrTimelock(address account) internal view {
        if (!hasRole(DEFAULT_ADMIN_ROLE, account) && !hasRole(TIMELOCK_ROLE, account)) 
            revert UnauthorizedAccount(account);
    }

    function _getPMMStorage() private pure returns (PMMStorage storage $) {
        assembly {
            $.slot := PMM_STORAGE_LOCATION
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(TIMELOCK_ROLE) {}  
}
