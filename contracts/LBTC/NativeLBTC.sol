// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {INativeLBTC} from "./interfaces/INativeLBTC.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {Actions} from "../libs/Actions.sol";
import {Assert} from "./libraries/Assert.sol";
import {Validation} from "./libraries/Validation.sol";
import {Staking} from "./libraries/Staking.sol";
import {Redeem} from "./libraries/Redeem.sol";
import {BaseLBTC} from "./BaseLBTC.sol";

/**
 * @title ERC20 representation of Liquid Bitcoin
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract NativeLBTC is
    INativeLBTC,
    BaseLBTC,
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
        /// @custom:oz-renamed-from maximumFee
        uint256 __removed__maximumFee;
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
        uint256 redeemNonce;
        IStakingRouter stakingRouter;
    }

    // TODO: recalculate
    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.NativeLBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NATIVE_LBTC_STORAGE_LOCATION =
        0xb773c428c0cecc1b857b133b10e11481edd580cedc90e62754fff20b7c0d6000;

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

    function changeStakingRouter(address newVal) external  onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeStakingRouter(newVal);
    }

    /// GETTERS ///

    /**
     * @notice Returns the current maximum mint fee
     */
    function getMintFee() external view returns (uint256) {
        return _getNativeLBTCStorage().stakingRouter.getMintFee();
    }

    /// @notice Calculate the amount that will be unstaked and check if it's above the dust limit
    /// @dev This function can be used by front-ends to verify burn amounts before submitting a transaction
    /// @param scriptPubkey The Bitcoin script public key as a byte array
    /// @param amount The amount of NativeLBTC to be burned
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
     * Because NativeLBTC repsents BTC we use the same decimals.
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
     * @notice Mint NativeLBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of NativeLBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function mint(
        address to,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @notice Mint NativeLBTC in batches
     * @param to The addresses to mint to
     * @param amount The amounts of NativeLBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyRole(MINTER_ROLE) {
        _batchMint(to, amount);
    }

    /**
     * @notice Mint NativeLBTC by proving DepositV1 payload
     * @param rawPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mintV1(
        bytes calldata rawPayload,
        bytes calldata proof
    ) public nonReentrant {
        _mint(rawPayload, proof);
    }

    /**
     * @notice Mint NativeLBTC in batches by DepositV1 payloads
     * @param payload The messages with the stake data
     * @param proof Signatures of the consortium approving the mints
     */
    function batchMintV1(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external nonReentrant {
        _batchMint(payload, proof);
    }

    /**
     * @notice Mint NativeLBTC applying a commission to the amount
     * @dev Payload should be same as mint to avoid reusing them with and without fee
     * @param mintPayload DepositV1 payload
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function mintV1WithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external onlyRole(CLAIMER_ROLE) {
        _mintWithFee(mintPayload, proof, feePayload, userSignature);
    }

    /**
     * @notice Mint NativeLBTC in batches proving stake actions happened
     * @param mintPayload DepositV1 payloads
     * @param proof Signatures of the consortium approving the mints
     * @param feePayload Contents of the fee approvals signed by the user
     * @param userSignature Signatures of the user to allow Fees
     */
    function batchMintV1WithFee(
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external onlyRole(CLAIMER_ROLE) {
        _batchMintWithFee(mintPayload, proof, feePayload, userSignature);
    }

    /**
     * @dev Burns NativeLBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of NativeLBTC to burn
     */
    function redeem(bytes calldata scriptPubkey, uint256 amount) external {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            // TODO: rename to redeem
            revert RedeemsDisabled();
        }

        uint256 nonce = $.redeemNonce++;

        uint64 fee = $.burnCommission;
        uint256 amountAfterFee = Validation.redeemFee(
            scriptPubkey,
            $.dustFeeRate,
            amount,
            fee
        );
        bytes memory rawPayload = Redeem.encodeRequest(
            amountAfterFee,
            nonce,
            scriptPubkey
        );
        address fromAddress = address(_msgSender());

        if (fee > 0) {
            _transfer(fromAddress, $.treasury, fee);
        }
        _burn(fromAddress, amountAfterFee);

        emit RedeemRequest(fromAddress, nonce, amount, fee, rawPayload);
    }

    /**
     * @dev Burns NativeLBTC
     *
     * @param amount Amount of NativeLBTC to burn
     */
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    /**
     * @dev Allows minters to burn NativeLBTC
     *
     * @param amount Amount of NativeLBTC to burn
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
        _getNativeLBTCStorage().redeemNonce = 1; // count from 1
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

    function _mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal override returns (address) {
        Assert.selector(rawPayload, Actions.DEPOSIT_BTC_ACTION_V1);
        Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
            rawPayload[4:]
        );

        _validateAndMint(
            action.recipient,
            action.amount,
            action.amount,
            rawPayload,
            proof
        );
        return action.recipient;
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
     * @param $ NativeLBTC storage.
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

    /// @dev allow zero address to disable Stakings
    function _changeStakingRouter (address newVal) internal {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        address prevValue = address($.stakingRouter);
        $.stakingRouter = IStakingRouter(newVal);
        emit StakingRouterChanged(prevValue, newVal);
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
     * @dev Returns whether a minting payload has been used already
     * @param payloadHash The minting payload hash
     */
    function _isPayloadUsed(
        bytes32 payloadHash
    ) internal view override returns (bool) {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        return
            $.usedPayloads[payloadHash];
    }

    function _getMaxFeeAndTreasury() internal view override returns (uint256, address) {
        NativeLBTCStorage storage $ = _getNativeLBTCStorage();
        return ($.stakingRouter.getMintFee(), $.treasury);
    }
}
