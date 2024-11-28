// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title Partner Vault implementation for integration with FBTC
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract PartnerVault is Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
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
        IERC20 lbtc;
        address lockedFbtc;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.PartnerVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PARTNER_VAULT_STORAGE_LOCATION =
        0xf2032fbd6c6daf0509f7b47277c23d318b85e97f8401e745afc792c2709cec00;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address fbtc,
        address lbtc
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.fbtc = IERC20(fbtc);
        $.lbtc = IERC20(lbtc);
    }

    /**
     * @notice Functionality to swap FBTC into LBTC. This function assumes that the sender has already
     * approved at least `amount` of satoshis of FBTC to this vault.
     * @param amount The amount of satoshis of FBTC to be locked
     * @return The amount of satoshis that are locked after the LockedFBTC contract takes a fee
     */
    function initiateMint(
        uint256 amount
    ) public nonReentrant returns (uint256) {
        // First, we take the FBTC from the sender.
        _takeFBTC(amount);

        // Then, we need to approve `amount` of satoshis to the LockedFBTC contract.
        _approveToLockedFBTC(amount);

        // Now we can make the mintLockedFbtcRequest.
        uint256 amountLocked = _makeMintLockedFbtcRequest(amount);

        // At this point we have our FBTC minted to us, and we need to then give the user his LBTC.
        _sendLBTC(amountLocked);

        return amountLocked;
    }

    /**
     * @notice Functionality to swap LBTC into FBTC. This function assumes that the sender has already
     * approved at least `amount` of satoshis of LBTC to this vault. This function needs to be followed
     * up with `finalizeBurn` once the FBTC TSS nodes finalize the signing of the burn request.
     * @param amount The amount of satoshis of FBTC to be released
     */
    function initializeBurn(
        uint256 amount,
        bytes32 depositTxId,
        uint256 outputIndex
    ) public returns (bytes32, Request memory) {
        // We only make a call to set the redeeming up first. We can only start moving tokens later
        // when all correct steps have been taken.
        _makeRedeemFbtcRequest(amount, depositTxId, outputIndex);
    }

    function finalizeBurn(uint256 amount) public nonReentrant {
        // First, take the LBTC back.
        _takeLBTC(amount);

        // Next, we finalize the redeeming flow.
        _confirmRedeemFbtc(amount);
    }

    function _takeFBTC(uint256 amount) internal {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.fbtc.transferFrom(msg.sender, address(this), amount);
    }

    function _takeLBTC(uint256 amount) internal {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.lbtc.transferFrom(msg.sender, address(this), amount);
    }

    function _approveToLockedFBTC(uint256 amount) internal {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        $.fbtc.approve($.lockedFbtc, amount);
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

    function _sendLBTC(uint256 amount) internal {
        PartnerVaultStorage storage $ = _getPartnerVaultStorage();
        // XXX: do we mint from lbtc or do we keep this in the vault?
        $.lbtc.transfer(msg.sender, amount);
    }

    function _getPartnerVaultStorage()
        internal
        returns (PartnerVaultStorage storage $)
    {
        assembly {
            $.slot := PARTNER_VAULT_STORAGE_LOCATION
        }
    }
}
