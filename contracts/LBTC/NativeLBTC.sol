// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {INativeLBTC} from "./INativeLBTC.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {Actions} from "../libs/Actions.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";
import {Assert} from "./utils/Assert.sol";
import {Validation} from "./utils/Validation.sol";
/**
 * @title ERC20 representation of Liquid Bitcoin
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract NativeLBTC is
    INativeLBTC,
    ERC20PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlDefaultAdminRulesUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.NativeLBTC
    struct NativeLBTCStorage {
        // slot: 20 + 8 + 1 | 29/32
        address consortium;
        uint64 burnCommission; // absolute commission to charge on burn (unstake)
        bool isWithdrawalsEnabled;
        // slot: 20 | 20/32
        address treasury;
        // slot: 20 | 20/32
        IBascule bascule;
        // other slots by 32
        string name;
        string symbol;
        uint256 dustFeeRate;
        uint256 maximumFee;
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
    }

    // TODO: recalculate
    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.NativeLBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NATIVE_LBTC_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CLAIMER_ROLE = keccak256("CLAIMER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// INTIALIZERS ///

    function initialize(
        address consortium_,
        uint64 burnCommission_,
        address treasury,
        address initialOwner,
        uint48 initialOwnerDelay
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay, initialOwner);

        __ERC20_init("", "");
        __ERC20Pausable_init();

        __ReentrancyGuard_init();
        __ERC20Permit_init("Lombard Liquid Bitcoin"); // TODO: set final name

        __NativeLBTC_init(
            "Lombard Liquid Bitcoin", // TODO: set final name
            "XLBTC", // TODO: set final symbol
            consortium_,
            treasury,
            burnCommission_
        );

        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        $.dustFeeRate = BitcoinUtils.DEFAULT_DUST_FEE_RATE;
        emit DustFeeRateChanged(0, $.dustFeeRate);
    }

    /// ONLY OWNER FUNCTIONS ///

    function toggleWithdrawals() external onlyRole(DEFAULT_ADMIN_ROLE) {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit WithdrawalsEnabled($.isWithdrawalsEnabled);
    }

    function changeNameAndSymbol(
        string calldata name_,
        string calldata symbol_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeNameAndSymbol(name_, symbol_);
    }

    function changeConsortium(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeConsortium(newVal);
    }

    /**
     * @notice Set the contract current fee for mint
     * @param fee New fee value
     * @dev zero allowed to disable fee
     */
    function setMintFee(uint256 fee) external onlyRole(OPERATOR_ROLE) {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        uint256 oldFee = $.maximumFee;
        $.maximumFee = fee;
        emit FeeChanged(oldFee, fee);
    }

    function changeTreasuryAddress(
        address newValue
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeTreasury(newValue);
    }

    function changeBurnCommission(
        uint64 newValue
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeBurnCommission(newValue);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Change the dust fee rate used for dust limit calculations
    /// @dev Only the contract owner can call this function. The new rate must be positive.
    /// @param newRate The new dust fee rate (in satoshis per 1000 bytes)
    function changeDustFeeRate(
        uint256 newRate
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeDustFeeRate(newRate);
    }

    /**
     * Change the address of the Bascule drawbridge contract.
     * Setting the address to 0 disables the Bascule check.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function changeBascule(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeBascule(newVal);
    }

    /// GETTERS ///

    /**
     * @notice Returns the current maximum mint fee
     */
    function getMintFee() external view returns (uint256) {
        return _getNativeLBTCStorage().maximumFee;
    }

    /// @notice Calculate the amount that will be unstaked and check if it's above the dust limit
    /// @dev This function can be used by front-ends to verify burn amounts before submitting a transaction
    /// @param scriptPubkey The Bitcoin script public key as a byte array
    /// @param amount The amount of LBTC to be burned
    /// @return amountAfterFee The amount that will be unstaked (after deducting the burn commission)
    /// @return isAboveDust Whether the amountAfterFee is equal to or above the dust limit
    function calcUnstakeRequestAmount(
        bytes calldata scriptPubkey,
        uint256 amount
    ) external view returns (uint256 amountAfterFee, bool isAboveDust) {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();

        (amountAfterFee, , , isAboveDust) = Validation.calcFeeAndDustLimit(
            scriptPubkey,
            $.dustFeeRate,
            amount,
            $.burnCommission
        );
        return (amountAfterFee, isAboveDust);
    }

    function consortium() external view virtual returns (address) {
        return _getNativeLBTCStorage().consortium;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     *
     * Because LBTC repsents BTC we use the same decimals.
     *
     */
    function decimals() public view virtual override returns (uint8) {
        return 8;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return _getNativeLBTCStorage().name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _getNativeLBTCStorage().symbol;
    }

    function getTreasury() public view override returns (address) {
        return _getNativeLBTCStorage().treasury;
    }

    function getBurnCommission() public view returns (uint64) {
        return _getNativeLBTCStorage().burnCommission;
    }

    /// @notice Get the current dust fee rate
    /// @return The current dust fee rate (in satoshis per 1000 bytes)
    function getDustFeeRate() public view returns (uint256) {
        return _getNativeLBTCStorage().dustFeeRate;
    }

    /**
     * Get Bascule contract.
     */
    function Bascule() external view returns (IBascule) {
        return _getNativeLBTCStorage().bascule;
    }

    /// USER ACTIONS ///

    /**
     * @notice Mint LBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of LBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function mint(
        address to,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @notice Mint LBTC in batches
     * @param to The addresses to mint to
     * @param amount The amounts of LBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyRole(MINTER_ROLE) {
        Assert.inputLength(to.length, amount.length);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    /**
     * @notice Mint NativeLBTC by proving a stake action happened
     * @param rawPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) public nonReentrant {
        Assert.selector(rawPayload, Actions.DEPOSIT_BTC_ACTION_V0);

        Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
            rawPayload[4:]
        );
        _assertToken(action.tokenAddress);

        _validateAndMint(
            action.recipient,
            action.amount,
            action.amount,
            rawPayload,
            proof
        );
    }

    /**
     * @notice Mint LBTC in batches by proving stake actions happened
     * @param payload The messages with the stake data
     * @param proof Signatures of the consortium approving the mints
     */
    function batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external {
        Assert.inputLength(payload.length, proof.length);

        for (uint256 i; i < payload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(payload[i]);
            if (_getNativeLBTCStorage().usedPayloads[payloadHash]) {
                emit BatchMintSkipped(payloadHash, payload[i]);
                continue;
            }

            mint(payload[i], proof[i]);
        }
    }

    /**
     * @notice Mint LBTC applying a commission to the amount
     * @dev Payload should be same as mint to avoid reusing them with and without fee
     * @param mintPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external onlyRole(CLAIMER_ROLE) {
        _mintWithFee(mintPayload, proof, feePayload, userSignature);
    }

    /**
     * @notice Mint LBTC in batches proving stake actions happened
     * @param mintPayload The messages with the stake data
     * @param proof Signatures of the consortium approving the mints
     * @param feePayload Contents of the fee approvals signed by the user
     * @param userSignature Signatures of the user to allow Fees
     */
    function batchMintWithFee(
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external onlyRole(CLAIMER_ROLE) {
        Assert.inputLength(mintPayload.length, proof.length);
        Assert.inputLength(mintPayload.length, feePayload.length);
        Assert.inputLength(mintPayload.length, userSignature.length);

        for (uint256 i; i < mintPayload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(mintPayload[i]);
            if (_getNativeLBTCStorage().usedPayloads[payloadHash]) {
                emit BatchMintSkipped(payloadHash, mintPayload[i]);
                continue;
            }

            _mintWithFee(
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i]
            );
        }
    }

    /**
     * @dev Burns LBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of LBTC to burn
     */
    function redeem(bytes calldata scriptPubkey, uint256 amount) external {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        uint64 fee = $.burnCommission;
        uint256 amountAfterFee = Validation.redeemFee(
            scriptPubkey,
            $.dustFeeRate,
            amount,
            fee
        );

        address fromAddress = address(_msgSender());
        _transfer(fromAddress, getTreasury(), fee);
        _burn(fromAddress, amountAfterFee);

        emit UnstakeRequest(fromAddress, scriptPubkey, amountAfterFee);
    }

    /**
     * @dev Burns LBTC
     *
     * @param amount Amount of LBTC to burn
     */
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    /**
     * @dev Allows minters to burn LBTC
     *
     * @param amount Amount of LBTC to burn
     */
    function burn(
        address from,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    /// PRIVATE FUNCTIONS ///

    function __NativeLBTC_init(
        string memory name_,
        string memory symbol_,
        address consortium_,
        address treasury,
        uint64 burnCommission_
    ) internal onlyInitializing {
        _changeNameAndSymbol(name_, symbol_);
        _changeConsortium(consortium_);
        _changeTreasury(treasury);
        _changeBurnCommission(burnCommission_);
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _assertToken(address token) internal view {
        if (token != address(this)) {
            revert InvalidDestinationToken(address(this), token);
        }
    }

    function _validateAndMint(
        address recipient,
        uint256 amountToMint,
        uint256 depositAmount,
        bytes calldata payload,
        bytes calldata proof
    ) internal {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();

        if (amountToMint > depositAmount) revert InvalidMintAmount();

        /// make sure that hash of payload not used before
        /// need to check new sha256 hash and legacy keccak256 from payload without selector
        /// 2 checks made to prevent migration of contract state
        bytes32 payloadHash = sha256(payload);
        bytes32 legacyHash = keccak256(payload[4:]); // TODO: remove when bascule support sha256
        if ($.usedPayloads[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        INotaryConsortium($.consortium).checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        // Confirm deposit against Bascule
        _confirmDeposit($, legacyHash, depositAmount);

        // Actually mint
        _mint(recipient, amountToMint);

        emit MintProofConsumed(recipient, payloadHash, payload);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param $ LBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(
        NativeLBTCStorage storage $,
        bytes32 depositID,
        uint256 amount
    ) internal {
        IBascule bascule = $.bascule;
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
        }
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal nonReentrant {
        Assert.selector(mintPayload, Actions.DEPOSIT_BTC_ACTION_V0);
        Actions.DepositBtcActionV1 memory mintAction = Actions.depositBtcV1(
            mintPayload[4:]
        );
        _assertToken(mintAction.tokenAddress);

        Assert.selector(feePayload, Actions.FEE_APPROVAL_ACTION);
        Actions.FeeApprovalAction memory feeAction = Actions.feeApproval(
            feePayload[4:]
        );

        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        uint256 fee = Math.max($.maximumFee, feeAction.fee);

        if (fee >= mintAction.amount) {
            revert FeeGreaterThanAmount();
        }

        {
            bytes32 digest = _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        Actions.FEE_APPROVAL_EIP712_ACTION,
                        block.chainid,
                        feeAction.fee,
                        feeAction.expiry
                    )
                )
            );

            Assert.feeApproval(digest, mintAction.recipient, userSignature);
        }

        // modified payload to be signed
        _validateAndMint(
            mintAction.recipient,
            mintAction.amount - fee,
            mintAction.amount,
            mintPayload,
            proof
        );

        if (fee > 0) {
            // mint fee to treasury
            _mint($.treasury, fee);
        }

        emit FeeCharged(fee, userSignature);
    }

    function _changeDustFeeRate(uint256 newRate) internal {
        Assert.dustFeeRate(newRate);
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        uint256 oldRate = $.dustFeeRate;
        $.dustFeeRate = newRate;
        emit DustFeeRateChanged(oldRate, newRate);
    }

    /// @dev not zero
    function _changeConsortium(address newVal) internal {
        Assert.zeroAddress(newVal);
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        emit ConsortiumChanged($.consortium, newVal);
        $.consortium = newVal;
    }

    /// @dev allow set to zero
    function _changeBurnCommission(uint64 newValue) internal {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        uint64 prevValue = $.burnCommission;
        $.burnCommission = newValue;
        emit BurnCommissionChanged(prevValue, newValue);
    }

    function _changeBascule(address newVal) internal {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        emit BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    /// @dev `treasury` not zero
    function _changeTreasury(address newValue) internal {
        Assert.zeroAddress(newValue);
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }

    function _getNativeLBTCStorage()
        private
        pure
        returns (NativeLBTCStorage storage $)
    {
        assembly {
            $.slot := NATIVE_LBTC_STORAGE_LOCATION
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
