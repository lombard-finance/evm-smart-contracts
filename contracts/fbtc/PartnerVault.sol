// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILBTC} from "../LBTC/ILBTC.sol";
import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title Partner Vault implementation for integration with FBTC
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract PartnerVault is 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable, 
    AccessControlUpgradeable 
{
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
        uint128 nonce; // Those can be packed into one slot in evm storage.
        bytes32 srcChain;
        bytes srcAddress;
        bytes32 dstChain;
        bytes dstAddress;
        uint256 amount; // Transfer value without fee.
        uint256 fee;
        bytes extra;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.PartnerVault
    struct PartnerVaultStorage {
        IERC20 fbtc;
        ILBTC lbtc;
        address lockedFbtc;
        uint256 stakeLimit;
        uint256 totalStake;
        mapping(address => uint256) minted;
        mapping(address => uint256) pendingWithdrawals;
    }
    
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.PartnerVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PARTNER_VAULT_STORAGE_LOCATION =
        0xf2032fbd6c6daf0509f7b47277c23d318b85e97f8401e745afc792c2709cec00;

    error StakeLimitExceeded();
    error ZeroAmount();
    error InsufficientFunds();
    event StakeLimitSet(uint256 newStakeLimit);

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address fbtc,
        address lbtc,
        uint256 stakeLimit_
    ) external initializer {
        __Pausable_init();
        __ReentrancyGuard_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.fbtc = IERC20(fbtc);
        $.lbtc = ILBTC(lbtc);
        $.stakeLimit = stakeLimit_;
    }

    /**
     * @notice Sets the address of the `lockedFbtc` contract, since this needs to be done after
     * deployment of the partner vault.
     * @param lockedFbtc_ The address at which the `lockedFbtc` contract lives
     */
    function setLockedFbtc(address lockedFbtc_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.lockedFbtc = lockedFbtc_;
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
    function initiateMint(
        uint256 amount
    ) public nonReentrant whenNotPaused returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if ($.totalStake + amount > $.stakeLimit) revert StakeLimitExceeded();
        $.totalStake += amount;
        $.minted[msg.sender] += amount;

        // First, we take the FBTC from the sender.
        $.fbtc.transferFrom(msg.sender, address(this), amount);

        // Then, we need to approve `amount` of satoshis to the LockedFBTC contract.
        $.fbtc.approve($.lockedFbtc, amount);

        // Now we can make the mintLockedFbtcRequest.
        uint256 amountLocked = _makeMintLockedFbtcRequest(amount);

        // At this point we have our FBTC minted to us, and we need to then give the user his LBTC.
        $.lbtc.mint(msg.sender, amount);
        return amountLocked;
    }

    /**
     * @notice Functionality to initiate a swap for LBTC into FBTC. This only initiates the withdrawal
     * request and needs to be finalized by `finalizeBurn` later on, once all the off-chain bookkeeping
     * is finalized as well.
     * @param amount The amount of satoshis of FBTC to be released
     * @param depositTxId The transaction ID of the BTC deposit on the bitcoin network
     * @param amount The transaction output index to user's deposit address
     */
    function initializeBurn(
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) public nonReentrant whenNotPaused returns (bytes32, Request memory) {
        if (amount == 0) revert ZeroAmount();
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if ($.minted[msg.sender] < amount) revert InsufficientFunds();

        // We only make a call to set the redeeming up first. We can only start moving tokens later
        // when all correct steps have been taken.
        _makeRedeemFbtcRequest(amount, depositTxId, outputIndex);

        // Ensure that this caller can redeem for `amount` later when all bookkeeping off-chain is done.
        $.pendingWithdrawals[msg.sender] = amount;
    }

    /**
     * @notice Finalizes the withdrawal of LBTC back into FBTC.
     */
    function finalizeBurn() public nonReentrant whenNotPaused {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        uint256 amount = $.pendingWithdrawals[msg.sender];
        $.pendingWithdrawals[msg.sender] = 0;
        $.totalStake -= amount;
        $.minted[msg.sender] -= amount;

        // First, take the LBTC back.
        $.lbtc.burn(msg.sender, amount);

        // Next, we finalize the redeeming flow.
        _confirmRedeemFbtc(amount);

        // Finally, we need to send the received FBTC back to the caller.
        $.fbtc.transfer(msg.sender, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function stakeLimit() external returns (uint256) {
        return _getPartnerVaultStorage().stakeLimit;
    }

    function remainingStake() external view returns (uint256) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        if ($.totalStake > $.stakeLimit) return 0;
        return $.stakeLimit - $.totalStake;
    }

    function _makeMintLockedFbtcRequest(
        uint256 amount
    ) internal returns (uint256) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        bytes4 selector = bytes4(
            keccak256(bytes("mintLockedFbtcRequest(uint256)"))
        );
        (bool success, bytes memory result) = $.lockedFbtc.call(
            abi.encodeWithSelector(selector, amount)
        );
        require(success);
        return abi.decode(result, (uint256));
    }

    function _makeRedeemFbtcRequest(
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) internal returns (bytes32, Request memory) {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        bytes4 selector = bytes4(
            keccak256(bytes("redeemFbtcRequest(uint256,bytes32,uint256)"))
        );
        (bool success, bytes memory result) = $.lockedFbtc.call(
            abi.encodeWithSelector(selector, amount, depositTxId, outputIndex)
        );
        require(success);
        return abi.decode(result, (bytes32, Request));
    }

    function _confirmRedeemFbtc(uint256 amount) internal {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        bytes4 selector = bytes4(
            keccak256(bytes("confirmRedeemFbtc(uint256)"))
        );
        (bool success, ) = $.lockedFbtc.call(
            abi.encodeWithSelector(selector, amount)
        );
        require(success);
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
