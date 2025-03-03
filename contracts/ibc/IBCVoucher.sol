// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIBCVoucher} from "./IIBCVoucher.sol";
import {ILBTC} from "../LBTC/ILBTC.sol";

/// TODO: IBC like rate limits
/// @title ERC20 intermediary token
/// @author Lombard.Finance
/// @notice The contracts is a part of Lombard.Finace protocol
contract IBCVoucher is
    IIBCVoucher,
    ERC20PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable
{
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:lombardfinance.storage.IBCVoucher
    struct IBCVoucherStorage {
        string name;
        string symbol;
        ILBTC lbtc;
        uint256 fee;
        address treasury;
    }

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.IBCVoucher")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant IBCVOUCHER_STORAGE_LOCATION =
        0xbcdad5fb3ea2d152a63bdfe3b5528166cf47e4744fa97c998b76e45dac6f2800;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        ILBTC _lbtc,
        address admin,
        uint256 _fee,
        address _treasury
    ) external initializer {
        __ERC20_init("", "");
        __ERC20Pausable_init();
        __ReentrancyGuard_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        __IBCVoucher_init("IBC compatible LBTC Voucher", "iLBTCv", _lbtc);

        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        $.fee = _fee;
        $.treasury = _treasury;
    }

    function __IBCVoucher_init(
        string memory _name,
        string memory _symbol,
        ILBTC _lbtc
    ) internal onlyInitializing {
        _changeNameAndSymbol(_name, _symbol);

        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        $.lbtc = _lbtc;
    }

    function wrap(
        uint256 amount
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyRole(RELAYER_ROLE)
        returns (uint256)
    {
        return _wrap(_msgSender(), _msgSender(), amount);
    }

    function wrapTo(
        address recipient,
        uint256 amount
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyRole(RELAYER_ROLE)
        returns (uint256)
    {
        return _wrap(_msgSender(), recipient, amount);
    }

    function _wrap(
        address from,
        address recipient,
        uint256 amount
    ) internal returns (uint256) {
        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        ILBTC _lbtc = $.lbtc;
        uint256 fee = $.fee;

        IERC20(address(_lbtc)).safeTransferFrom(from, address(this), amount);
        if (amount <= fee) {
            revert AmountTooLow();
        }
        uint256 amountAfterFee = amount - fee;

        IERC20(address(_lbtc)).safeTransfer($.treasury, fee);
        _lbtc.burn(amountAfterFee);
        _mint(recipient, amountAfterFee);

        emit VoucherMinted(from, recipient, fee, amountAfterFee);
        return amountAfterFee;
    }

    function spend(
        uint256 amount
    ) external override whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        _spend(_msgSender(), _msgSender(), amount);
    }

    function spendTo(
        address recipient,
        uint256 amount
    ) external override whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        _spend(_msgSender(), recipient, amount);
    }

    function _spend(address from, address recipient, uint256 amount) internal {
        IBCVoucherStorage storage $ = _getIBCVoucherStorage();

        _burn(from, amount);
        $.lbtc.mint(recipient, amount);
        emit VoucherSpent(from, recipient, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setTreasuryAddress(
        address newTreasury
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        $.treasury = newTreasury;
        emit TreasuryUpdated($.treasury);
    }

    function setFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        $.fee = newFee;
        emit FeeUpdated($.fee);
    }

    function getTreasury() external view returns (address) {
        return _getIBCVoucherStorage().treasury;
    }

    function getFee() external view returns (uint256) {
        return _getIBCVoucherStorage().fee;
    }

    function lbtc() external view returns (address) {
        return address(_getIBCVoucherStorage().lbtc);
    }

    /// @dev Returns the name of the token.
    function name() public view virtual override returns (string memory) {
        return _getIBCVoucherStorage().name;
    }

    /// @dev Returns the symbol of the token, usually a shorter version of the name.
    function symbol() public view virtual override returns (string memory) {
        return _getIBCVoucherStorage().symbol;
    }

    /// @dev Returns the number of decimals used to get its user representation.
    /// Because LBTC represents BTC we use the same decimals.
    function decimals() public view virtual override returns (uint8) {
        return 8;
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        IBCVoucherStorage storage $ = _getIBCVoucherStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _getIBCVoucherStorage()
        private
        pure
        returns (IBCVoucherStorage storage $)
    {
        assembly {
            $.slot := IBCVOUCHER_STORAGE_LOCATION
        }
    }

    /// @dev Override of the _update function to satisfy ERC20PausableUpgradeable
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
