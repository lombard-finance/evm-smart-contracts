// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILBTC} from "../LBTC/ILBTC.sol";
import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface LockedFBTC {
    function mintLockedFbtcRequest(uint256 amount) external returns (uint256);
    function redeemFbtcRequest(
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) external returns (bytes32, FBTCPartnerVault.Request memory);
    function confirmRedeemFbtc(uint256 amount) external;
}

/**
 * @title Partner Vault implementation for integration with FBTC
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract FBTCPartnerVault is
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    AccessControlUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeERC20 for ILBTC;

    enum Operation {
        Nop, // starts from 1.
        Mint,
        Burn,
        CrosschainRequest,
        CrosschainConfirm
    }

    enum Status {
        Unused,
        Pending,
        Confirmed,
        Rejected
    }

    struct Request {
        Operation op;
        Status status;
        uint128 nonce;
        bytes32 srcChain;
        bytes srcAddress;
        bytes32 dstChain;
        bytes dstAddress;
        uint256 amount;
        uint256 fee;
        bytes extra;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.PartnerVault
    struct PartnerVaultStorage {
        IERC20 fbtc;
        ILBTC lbtc;
        LockedFBTC lockedFbtc;
        uint256 stakeLimit;
        uint256 totalStake;
        bool allowMintLbtc;
        mapping(bytes32 => Request) pendingWithdrawals;
    }

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.PartnerVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PARTNER_VAULT_STORAGE_LOCATION =
        0xf2032fbd6c6daf0509f7b47277c23d318b85e97f8401e745afc792c2709cec00;

    error StakeLimitExceeded();
    error ZeroAmount();
    error InsufficientFunds();
    error WithdrawalInProgress();
    error NoWithdrawalInitiated();
    error NoUnsetLockedFBTC();
    error NoResetLockedFBTC();
    event StakeLimitSet(uint256 newStakeLimit);
    event LockedFBTCSet(address lockedFbtc);
    event MintLBTCSet(bool shouldMint);
    event FBTCLocked(
        address indexed recipient,
        uint256 amountLocked,
        bool indexed lbtcMinted
    );
    event WithdrawalDeleted(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed depositTxId,
        uint256 indexed outputIndex
    );
    event BurnInitiated(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed depositTxId,
        uint256 indexed outputIndex
    );
    event BurnFinalized(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed depositTxId,
        uint256 indexed outputIndex
    );

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address fbtc_,
        address lbtc_,
        uint256 stakeLimit_
    ) external initializer {
        __Pausable_init();
        __ReentrancyGuard_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.fbtc = IERC20(fbtc_);
        $.lbtc = ILBTC(lbtc_);
        $.stakeLimit = stakeLimit_;
    }

    /**
     * @notice Sets the address of the `lockedFbtc` contract, since this needs to be done after
     * deployment of the partner vault.
     * @param lockedFbtc_ The address at which the `lockedFbtc` contract lives
     */
    function setLockedFbtc(
        address lockedFbtc_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lockedFbtc_ == address(0)) revert NoUnsetLockedFBTC();
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if (address($.lockedFbtc) != address(0)) revert NoResetLockedFBTC();
        $.lockedFbtc = LockedFBTC(lockedFbtc_);
        emit LockedFBTCSet(lockedFbtc_);
    }

    /**
     * @notice Sets the LBTC minting functionality.
     * @param shouldMint Boolean value if we should mint or not
     */
    function setAllowMintLbtc(
        bool shouldMint
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.allowMintLbtc = shouldMint;
        emit MintLBTCSet(shouldMint);
    }

    /**
     * @notice Sets the stake limit for the partner vault.
     * @param newStakeLimit The stake limit to use going forward
     */
    function setStakeLimit(
        uint256 newStakeLimit
    ) external onlyRole(OPERATOR_ROLE) {
        _getPartnerVaultStorage().stakeLimit = newStakeLimit;
        emit StakeLimitSet(newStakeLimit);
    }

    /**
     * @notice Functionality to swap FBTC into LBTC. This function assumes that the sender has already
     * approved at least `amount` of satoshis of FBTC to this vault.
     * @param amount The amount of satoshis of FBTC to be locked
     * @return The amount of satoshis that are locked after the LockedFBTC contract takes a fee
     */
    function mint(
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();

        // First, we take the FBTC from the sender.
        $.fbtc.safeTransferFrom(_msgSender(), address(this), amount);

        // Then, we need to approve `amount` of satoshis to the LockedFBTC contract.
        $.fbtc.approve(address($.lockedFbtc), amount);

        // Now we can make the mintLockedFbtcRequest.
        uint256 amountLocked = $.lockedFbtc.mintLockedFbtcRequest(amount);
        if ($.totalStake + amountLocked > $.stakeLimit)
            revert StakeLimitExceeded();
        $.totalStake += amountLocked;

        // At this point we have our locked FBTC minted to us. If the `allowMintLbtc` variable is
        // set to true, we also give the user some LBTC. Otherwise, this is done manually afterwards.
        if ($.allowMintLbtc) $.lbtc.mint(_msgSender(), amountLocked);
        emit FBTCLocked(_msgSender(), amountLocked, $.allowMintLbtc);
        return amountLocked;
    }

    /**
     * @notice Functionality to initiate a swap for LBTC into FBTC. This only initiates the withdrawal
     * request and needs to be finalized by `finalizeBurn` later on, once all the off-chain bookkeeping
     * is finalized as well.
     * @param recipient The recipient of the FBTC to be released
     * @param amount The amount of satoshis of FBTC to be released
     * @param depositTxId The transaction ID of the BTC deposit on the bitcoin network
     * @param amount The transaction output index to user's deposit address
     */
    function initializeBurn(
        address recipient,
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    )
        external
        nonReentrant
        whenNotPaused
        onlyRole(OPERATOR_ROLE)
        returns (bytes32, Request memory)
    {
        if (amount == 0) revert ZeroAmount();
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if (amount > $.totalStake) revert InsufficientFunds();
        bytes32 key = keccak256(
            abi.encode(recipient, amount, depositTxId, outputIndex)
        );
        if ($.pendingWithdrawals[key].amount != 0)
            revert WithdrawalInProgress();

        // We only make a call to set the redeeming up first. We can only start moving tokens later
        // when all correct steps have been taken.
        (bytes32 hash, Request memory request) = $.lockedFbtc.redeemFbtcRequest(
            amount,
            depositTxId,
            outputIndex
        );

        // Ensure that this caller can redeem for `amount` later when
        // all bookkeeping off-chain is done.
        $.pendingWithdrawals[key] = request;
        emit BurnInitiated(recipient, amount, depositTxId, outputIndex);
        return (hash, request);
    }

    /**
     * @notice Finalizes the withdrawal of LBTC back into FBTC.
     * @param recipient The recipient of the FBTC to be released
     * @param amount The amount of satoshis of FBTC to be released
     * @param depositTxId The transaction ID of the BTC deposit on the bitcoin network
     * @param amount The transaction output index to user's deposit address
     */
    function finalizeBurn(
        address recipient,
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) external nonReentrant whenNotPaused onlyRole(OPERATOR_ROLE) {
        bytes32 key = keccak256(
            abi.encode(recipient, amount, depositTxId, outputIndex)
        );
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if ($.pendingWithdrawals[key].amount != amount)
            revert NoWithdrawalInitiated();
        if (amount > $.totalStake) revert InsufficientFunds();
        $.totalStake -= amount;
        delete $.pendingWithdrawals[key];

        // First, take the LBTC back if the `allowMintLbtc` variable is set. If not, this burn will
        // be performed manually by the LBTC team or consortium.
        if ($.allowMintLbtc) $.lbtc.burn(recipient, amount);

        // Next, we finalize the redeeming flow.
        $.lockedFbtc.confirmRedeemFbtc(amount);

        // Finally, we need to send the received FBTC back to the caller.
        $.fbtc.safeTransfer(recipient, amount);
        emit BurnFinalized(recipient, amount, depositTxId, outputIndex);
    }

    /**
     * @notice Allows an operator to remove a pending withdrawal request manually, in case it has been
     * rejected by the FBTC team.
     * @param recipient The recipient of the FBTC to be released
     * @param amount The amount of satoshis of FBTC to be released
     * @param depositTxId The transaction ID of the BTC deposit on the bitcoin network
     * @param amount The transaction output index to user's deposit address
     */
    function removeWithdrawalRequest(
        address recipient,
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) external whenNotPaused onlyRole(OPERATOR_ROLE) {
        bytes32 key = keccak256(
            abi.encode(recipient, amount, depositTxId, outputIndex)
        );
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        delete $.pendingWithdrawals[key];
        emit WithdrawalDeleted(recipient, amount, depositTxId, outputIndex);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function stakeLimit() external view returns (uint256) {
        return _getPartnerVaultStorage().stakeLimit;
    }

    function allowMintLbtc() external view returns (bool) {
        return _getPartnerVaultStorage().allowMintLbtc;
    }

    function remainingStake() external view returns (uint256) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if ($.totalStake > $.stakeLimit) return 0;
        return $.stakeLimit - $.totalStake;
    }

    function fbtc() external view returns (address) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        return address($.fbtc);
    }

    function lockedFbtc() external view returns (address) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        return address($.lockedFbtc);
    }

    function _getPartnerVaultStorage()
        internal
        pure
        returns (PartnerVaultStorage storage $)
    {
        assembly {
            $.slot := PARTNER_VAULT_STORAGE_LOCATION
        }
    }
}
