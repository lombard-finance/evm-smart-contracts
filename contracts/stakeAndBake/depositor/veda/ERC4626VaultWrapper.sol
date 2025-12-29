// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IDepositor} from "../IDepositor.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ITeller} from "./ITeller.sol";

/**
 * @title DeFi Vault Token Wrapper.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol. Its purpose is to wrap LBTCv tokens minted by Veda vault
 *         so that users will receive this wrapper's tokens instead of LBTCv when they do deposit or use StakeAndBake feature.
 *         This contract uses ERC20 pause function. That means all functions that presume any kind of token transfer (deposit,
 *         withdraw, mint, redeem, transfer etc.) will revert when this contract is paused.
 * @custom:security-contact legal@lombard.finance
 */
contract ERC4626VaultWrapper is
    IDepositor,
    ERC4626Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlDefaultAdminRulesUpgradeable
{
    using SafeERC20 for IERC20;

    /// @dev error thrown when the passed address is zero
    error ZeroAddress();
    /// @dev error thrown when function called from not authorized account
    error UnauthorizedAccount(address account);
    /// @dev error thrown the number of shares minted is less than threshold given
    error MinimumMintNotMet(uint256 minimumMint, uint256 shares);
    /// @dev error thrown if new teller points to a different vault
    error VaultCannotBeChanged();
    /// @dev error thrown if rescueERC20 is called to transfer asser and amopunt is too big
    error RescueAssetAmountTooBig();
    /// @dev error thrown if total shares supply is not equal to total asset supply
    error UnexpectedAssetBalance(
        uint256 totalSharesSupply,
        uint256 assetBalance
    );

    event NameAndSymbolChanged(string name, string symbol);
    event StakeAndBakeAdded(address stakeAndBake, address token);
    event StakeAndBakeRemoved(address stakeAndBake);
    event TellerChanged(ITeller indexed prevVal, ITeller indexed newVal);

    /// @custom:storage-location erc7201:lombardfinance.storage.ERC4626VaultWrapper
    struct ERC4626VaultWrapperStorage {
        ITeller teller;
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

        ERC4626VaultWrapperStorage storage $ = _getERC4626VaultWrapperStorage();
        $.teller = teller_;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
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
    ) external returns (bytes memory) {
        IERC20 assetToken = _getERC4626VaultWrapperStorage().sabAsset[
            _msgSender()
        ];
        if (address(assetToken) == address(0))
            revert UnauthorizedAccount(msg.sender);
        uint256 minimumMint = abi.decode(depositPayload, (uint256));

        uint256 shares = _depositCustom(
            assetToken,
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
        address receiver,
        uint256 minShareAmount
    ) external returns (uint256 shares) {
        return
            _depositCustom(
                token,
                _msgSender(),
                receiver,
                assets,
                minShareAmount
            );
    }

    /**
     * @notice Changes teller address.
     * @param teller_ The address of the teller
     */
    function changeTeller(
        ITeller teller_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(teller_) == address(0)) revert ZeroAddress();
        ITeller oldTeller = _getERC4626VaultWrapperStorage().teller;
        if (teller_.vault() != oldTeller.vault()) revert VaultCannotBeChanged();
        emit TellerChanged(oldTeller, teller_);
        _getERC4626VaultWrapperStorage().teller = teller_;
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

    function teller() public view returns (ITeller) {
        return _getERC4626VaultWrapperStorage().teller;
    }

    /**
     * @dev Override of the decimals function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function decimals()
        public
        view
        override(ERC4626Upgradeable, ERC20Upgradeable)
        returns (uint8)
    {
        return
            IERC20Metadata(_getERC4626VaultWrapperStorage().teller.vault())
                .decimals();
    }

    /**
     * @notice Rescue ERC20 tokens locked up in this contract.
     * @dev When not paused. Only DEFAULT_ADMIN_ROLE
     * @param tokenContract ERC20 token contract address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function rescueERC20(
        IERC20 tokenContract,
        address to,
        uint256 amount
    ) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        ERC4626VaultWrapperStorage storage $ = _getERC4626VaultWrapperStorage();
        IERC20 asset = IERC20($.teller.vault());
        if (tokenContract != asset) {
            SafeERC20.safeTransfer(tokenContract, to, amount);
        } else if (
            amount + _convertToAssets(totalSupply(), Math.Rounding.Ceil) <=
            tokenContract.balanceOf(address(this))
        ) {
            SafeERC20.safeTransfer(tokenContract, to, amount);
        } else {
            revert RescueAssetAmountTooBig();
        }
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
        token.safeIncreaseAllowance($.teller.vault(), depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = $.teller.deposit(token, depositAmount, minimumMint);

        _mint(receiver, shares);

        emit Deposit(caller, receiver, depositAmount, shares);

        _checkAssetTotalBalance();

        return shares;
    }

    /**
     * @dev Internal conversion function (from assets to shares), strictly 1 to 1
     */
    function _convertToShares(
        uint256 assets,
        Math.Rounding
    ) internal pure override returns (uint256) {
        return assets;
    }

    /**
     * @dev Internal conversion function (from shares to assets), strictly 1 to 1
     */
    function _convertToAssets(
        uint256 shares,
        Math.Rounding
    ) internal pure override returns (uint256) {
        return shares;
    }

    function _checkAssetTotalBalance() internal view {
        uint256 assetBalance = totalAssets();
        if (totalSupply() > assetBalance) {
            revert UnexpectedAssetBalance(totalSupply(), assetBalance);
        }
    }

    /**
     * @dev Deposit/mint common workflow.
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        super._deposit(caller, receiver, assets, shares);
        _checkAssetTotalBalance();
    }

    /**
     * @dev Withdraw/redeem common workflow.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        super._withdraw(caller, receiver, owner, assets, shares);
        _checkAssetTotalBalance();
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
