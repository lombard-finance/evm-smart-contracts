// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IDepositor} from "../IDepositor.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ITeller} from "./ITeller.sol";

/**
 * @title DeFi Vault Token Wrapper.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract ERC4626VaultWrapper is
    IDepositor,
    ERC4626Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlDefaultAdminRulesUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();
    /// @dev error thrown when the passed address is zero
    error ZeroAddress();
    /// @dev error thrown when not implemented function gets called
    error NotImplemented();
    /// @dev error thrown when function called from not authorized account
    error UnauthorizedAccount(address account);
    /// @dev error thrown the number of shares minted is less than threshold given
    error MinimumMintNotMet(uint256 minimumMint, uint256 shares);

    event NameAndSymbolChanged(string name, string symbol);
    event StakeAndBakeAdded(address stakeAndBake, address token);
    event StakeAndBakeRemoved(address stakeAndBake);

    /// @custom:storage-location erc7201:lombardfinance.storage.ERC4626VaultWrapper
    struct ERC4626VaultWrapperStorage {
        ITeller teller;
        IERC20Metadata vault;
        mapping(address => IERC20) sabAsset;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.ERC4626VaultWrapper")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC4626_VAULT_WRAPPER_STORAGE_LOCATION =
        0x072eb778170426cc48e1e3a2b5a9c8132a05efd66817089899462c7e39d25e00;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC20StorageLocation =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.EIP712")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant EIP712StorageLocation =
        0xa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d100;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ------------------------------- EXTERNAL MUTATIVE FUNCTIONS -------------------------------

    /// INTIALIZERS ///

    function initialize(
        address owner_,
        string calldata name_,
        string calldata symbol_,
        uint48 ownerDelay_,
        address pauser_,
        ITeller teller_
    ) external initializer {
        __AccessControlDefaultAdminRules_init(ownerDelay_, owner_);

        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();
        __ERC20Permit_init(name_);

        __ERC4626_init(IERC20(teller_.vault()));

        _grantRole(PAUSER_ROLE, pauser_);

        __ReentrancyGuard_init();

        ERC4626VaultWrapperStorage storage $ = _getERC4626VaultWrapperStorage();
        $.teller = teller_;
        $.vault = IERC20Metadata(teller_.vault());
    }

    /// MODIFIERS ///

    modifier onlyStakeAndBake() {
        if (
            address(_getERC4626VaultWrapperStorage().sabAsset[_msgSender()]) ==
            address(0)
        ) {
            revert UnauthorizedAccount(msg.sender);
        }
        _;
    }

    /**
     * @notice Deposit function.
     * @param owner The address of the user who will receive the shares
     * @param depositAmount The amount of tokens to deposit to the vault
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     * @dev depositPayload encodes the minimumMint for the vault
     */
    function deposit(
        address owner,
        uint256 depositAmount,
        bytes calldata depositPayload
    ) external nonReentrant onlyStakeAndBake returns (bytes memory) {
        uint256 minimumMint = abi.decode(depositPayload, (uint256));

        uint256 shares = _depositCustom(
            _getERC4626VaultWrapperStorage().sabAsset[_msgSender()],
            _msgSender(),
            owner,
            depositAmount,
            minimumMint
        );

        // Ensure minimumMint is reached.
        if (shares < minimumMint) {
            revert MinimumMintNotMet(minimumMint, shares);
        }
        bytes memory ret = abi.encode(shares);
        return ret;
    }

    /**
     * @notice Deposit function.
     * @param assets The amount asset to deposit
     * @param receiver The address of the user who will receive the shares
     */
    function deposit(
        IERC20 token,
        uint256 assets,
        address receiver
    ) external returns (uint256 shares) {
        return _depositCustom(token, _msgSender(), receiver, assets, 0);
    }

    /**
     * @notice Whitelist StakeAndBake contract.
     * @param stakeAndBake The address of StakeAndBake contract
     * @param token The address of the token controlled by StakeAndBake
     */
    function addStakeAndBake(
        address stakeAndBake,
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        _getERC4626VaultWrapperStorage().sabAsset[stakeAndBake] = IERC20(token);
        emit StakeAndBakeAdded(stakeAndBake, token);
    }

    /**
     * @notice Remove StakeAndBake contract.
     * @param stakeAndBake The address of StakeAndBake contract
     */
    function removeStakeAndBake(
        address stakeAndBake
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete _getERC4626VaultWrapperStorage().sabAsset[stakeAndBake];
        emit StakeAndBakeRemoved(stakeAndBake);
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function decimals()
        public
        view
        override(ERC4626Upgradeable, ERC20Upgradeable)
        returns (uint8)
    {
        return _getERC4626VaultWrapperStorage().vault.decimals();
    }

    // ------------------------------- INTERNAL MUTATIVE FUNCTIONS -------------------------------

    /**
     * @dev Deposit/mint common workflow.
     */
    function _depositCustom(
        IERC20 token,
        address caller,
        address receiver,
        uint256 depositAmount,
        uint256 minimumMint
    ) internal returns (uint256) {
        ERC4626VaultWrapperStorage storage $ = _getERC4626VaultWrapperStorage();

        SafeERC20.safeTransferFrom(token, caller, address(this), depositAmount);

        // Give the vault the needed allowance.
        token.safeIncreaseAllowance(address($.vault), depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = $.teller.bulkDeposit(
            token,
            depositAmount,
            minimumMint,
            address(this)
        );

        _mint(receiver, shares);

        emit Deposit(caller, receiver, depositAmount, shares);

        return shares;
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        ERC20Storage storage $ = _getERC20Storage_();
        $._name = name_;
        $._symbol = symbol_;
        EIP712Storage storage $_ = _getEIP712Storage_();
        $_._name = name_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _getERC20Storage_() private pure returns (ERC20Storage storage $) {
        assembly {
            $.slot := ERC20StorageLocation
        }
    }

    function _getEIP712Storage_()
        private
        pure
        returns (EIP712Storage storage $)
    {
        assembly {
            $.slot := EIP712StorageLocation
        }
    }

    function _getERC4626VaultWrapperStorage()
        private
        pure
        returns (ERC4626VaultWrapperStorage storage $)
    {
        assembly {
            $.slot := ERC4626_VAULT_WRAPPER_STORAGE_LOCATION
        }
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
