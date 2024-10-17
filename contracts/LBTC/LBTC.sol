// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {ILBTC} from "./ILBTC.sol";
import { FeeUtils } from "../libs/FeeUtils.sol";
import {Consortium} from "../consortium/Consortium.sol";
import {Actions} from "../libs/Actions.sol";
/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LBTC is ILBTC, ERC20PausableUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, ERC20PermitUpgradeable {
    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        mapping(bytes32 => bool) usedProofs;
        string name;
        string symbol;
        bool isWithdrawalsEnabled;
        address consortium;
        bool isWBTCEnabled;
        IERC20 wbtc;
        address treasury;
        /// @custom:oz-renamed-from destinations
        mapping(uint256 => address) __removed_destinations;
        /// @custom:oz-renamed-from depositCommission
        mapping(uint256 => uint16) __removed_depositCommission;
        /// @custom:oz-renamed-from usedBridgeProofs
        mapping(bytes32 => bool) __removed_usedBridgeProofs;
        /// @custom:oz-renamed-from globalNonce
        uint256 __removed_globalNonce;
        mapping(bytes32 => bytes32) __removed__destinations;
        mapping(bytes32 => uint16) __removed__depositRelativeCommission; // relative to amount commission to charge on bridge deposit
        mapping(bytes32 => uint64) __removed__depositAbsoluteCommission; // absolute commission to charge on bridge deposit
        uint64 burnCommission; // absolute commission to charge on burn (unstake)
        uint256 dustFeeRate;
        // Bascule drawbridge used to confirm deposits before allowing withdrawals
        IBascule bascule;
        address pauser;

        mapping(address => bool) minters;

        address bridge;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION = 0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    function _getLBTCStorage() private pure returns (LBTCStorage storage $) {
        assembly {
            $.slot := LBTC_STORAGE_LOCATION
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __LBTC_init(string memory name_, string memory symbol_, address consortium_, uint64 burnCommission_)
        internal
        onlyInitializing
    {
        _changeNameAndSymbol(name_, symbol_);
        _changeConsortium(consortium_);
        _changeBurnCommission(burnCommission_);
    }

    function initialize(address consortium_, uint64 burnCommission_, address owner_) external initializer {
        __ERC20_init("LBTC", "LBTC");
        __ERC20Pausable_init();

        __Ownable_init(owner_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        __LBTC_init("Lombard Staked Bitcoin", "LBTC", consortium_, burnCommission_);

        LBTCStorage storage $ = _getLBTCStorage();
        $.dustFeeRate = 3000; // Default value - 3 satoshis per byte
        emit DustFeeRateChanged(0, $.dustFeeRate);
    }

    function reinitialize() external reinitializer(2) {
        __ERC20Permit_init("Lombard Staked Bitcoin");
    }

    function toggleWithdrawals() external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit WithdrawalsEnabled($.isWithdrawalsEnabled);
    }

    function changeNameAndSymbol(string calldata name_, string calldata symbol_) external onlyOwner {
        _changeNameAndSymbol(name_, symbol_);
    }

    function _changeNameAndSymbol(string memory name_, string memory symbol_) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function changeConsortium(address newVal) external onlyOwner {
        _changeConsortium(newVal);
    }

    function _changeConsortium(address newVal) internal {
        if (newVal == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        emit ConsortiumChanged($.consortium, newVal);
        $.consortium = newVal;
    }

    /// @notice Mint LBTC to the specified address
    /// @param amount The amount of LBTC to mint    
    /// @dev Only callable by whitelisted minters
    function mint(address to, uint256 amount) external {
        if(!_getLBTCStorage().minters[_msgSender()]) {
            revert UnauthorizedAccount(_msgSender());
        }
        _mint(to, amount);
    }

    /// @notice Mint LBTC using notary consortium proof
    /// @param payload selector || ABI-encoded message
    function mint(
        bytes calldata payload,
        bytes calldata proof
    ) external nonReentrant {
        LBTCStorage storage $ = _getLBTCStorage();

        // payload validation
        if (bytes4(payload) != Actions.DEPOSIT_BTC_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.DepositBtcAction memory action = Actions.depositBtc(payload[4:]);

        // check proof validity
        bytes32 payloadHash = sha256(payload);
        if ($.usedProofs[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        Consortium($.consortium).checkProof(payloadHash, proof);
        $.usedProofs[payloadHash] = true;

        // Confirm deposit against Bascule
        _confirmDeposit($, payloadHash, action.amount);

        // Actually mint
        _mint(action.recipient, action.amount);

        emit MintProofConsumed(action.recipient, payloadHash, payload);
    }

    function withdraw(Actions.DepositBridgeAction memory action, bytes32 payloadHash, bytes calldata proof) external nonReentrant {        
        LBTCStorage storage $ = _getLBTCStorage();
        if(_msgSender() != $.bridge) {
            revert UnauthorizedAccount(_msgSender());
        }

        // proof validation
        if ($.usedProofs[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        $.usedProofs[payloadHash] = true;
        Consortium($.consortium).checkProof(payloadHash, proof);

        // Actually mint
        _mint(action.recipient, action.amount);
    }

    /**
     * @dev Burns LBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of LBTC to burn
     */
    function redeem(bytes calldata scriptPubkey, uint256 amount) external {
        OutputType outType = BitcoinUtils.getOutputType(scriptPubkey);

        if (outType == OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        LBTCStorage storage $ = _getLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        uint64 fee = $.burnCommission;
        if (amount <= fee) {
            revert AmountLessThanCommission(fee);
        }

        uint256 amountAfterFee = amount - fee;
        uint256 dustLimit = BitcoinUtils.getDustLimitForOutput(outType, scriptPubkey, $.dustFeeRate);

        if (amountAfterFee < dustLimit) {
            revert AmountBelowDustLimit(dustLimit);
        }

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

    /// @notice Calculate the amount that will be unstaked and check if it's above the dust limit
    /// @dev This function can be used by front-ends to verify burn amounts before submitting a transaction
    /// @param scriptPubkey The Bitcoin script public key as a byte array
    /// @param amount The amount of LBTC to be burned
    /// @return amountAfterFee The amount that will be unstaked (after deducting the burn commission)
    /// @return isAboveDust Whether the amountAfterFee is above the dust limit
    function calcUnstakeRequestAmount(bytes calldata scriptPubkey, uint256 amount)
        public
        view
        returns (uint256 amountAfterFee, bool isAboveDust)
    {
        OutputType outType = BitcoinUtils.getOutputType(scriptPubkey);
        if (outType == OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        LBTCStorage storage $ = _getLBTCStorage();

        uint64 fee = $.burnCommission;
        if (amount <= fee) {
            return (0, false);
        }

        amountAfterFee = amount - fee;
        uint256 dustLimit = BitcoinUtils.getDustLimitForOutput(outType, scriptPubkey, $.dustFeeRate);

        isAboveDust = amountAfterFee >= dustLimit;

        return (amountAfterFee, isAboveDust);
    }

    function consortium() external view virtual returns (address) {
        return _getLBTCStorage().consortium;
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
        return _getLBTCStorage().name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _getLBTCStorage().symbol;
    }

    function getTreasury() public view returns (address) {
        return _getLBTCStorage().treasury;
    }

    function getBurnCommission() public view returns (uint64) {
        return _getLBTCStorage().burnCommission;
    }

    function changeTreasuryAddress(address newValue) external onlyOwner {
        if (newValue == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }

    function changeBurnCommission(uint64 newValue) external onlyOwner {
        _changeBurnCommission(newValue);
    }

    function _changeBurnCommission(uint64 newValue) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        uint64 prevValue = $.burnCommission;
        $.burnCommission = newValue;
        emit BurnCommissionChanged(prevValue, newValue);
    }

    /// @notice Change the dust fee rate used for dust limit calculations
    /// @dev Only the contract owner can call this function. The new rate must be positive.
    /// @param newRate The new dust fee rate (in satoshis per 1000 bytes)
    function changeDustFeeRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert InvalidDustFeeRate();
        LBTCStorage storage $ = _getLBTCStorage();
        uint256 oldRate = $.dustFeeRate;
        $.dustFeeRate = newRate;
        emit DustFeeRateChanged(oldRate, newRate);
    }

    /// @notice Get the current dust fee rate
    /// @return The current dust fee rate (in satoshis per 1000 bytes)
    function getDustFeeRate() public view returns (uint256) {
        return _getLBTCStorage().dustFeeRate;
    }

    /**
     * Get Bascule contract.
     */
    function Bascule() external view returns (IBascule) {
        return _getLBTCStorage().bascule;
    }

    /**
     * Change the address of the Bascule drawbridge contract.
     * Setting the address to 0 disables the Bascule check.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function changeBascule(address newVal) external onlyOwner {
        _changeBascule(newVal);
    }

    /**
     * Change the address of the Bascule drawbridge contract.
     * @param newVal The new address.
     *
     * Emits a {BasculeChanged} event.
     */
    function _changeBascule(address newVal) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        emit BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param self LBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(LBTCStorage storage self, bytes32 depositID, uint256 amount) internal {
        IBascule bascule = self.bascule;
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
        }
    }

    /**
     * PAUSE
     */
    modifier onlyPauser() {
        _checkPauser();
        _;
    }

    function pauser() public view returns (address) {
        return _getLBTCStorage().pauser;
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function _checkPauser() internal view {
        if (pauser() != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
    }

    function transferPauserRole(address newPauser) external onlyOwner {
        if (newPauser == address(0)) {
            revert ZeroAddress();
        }
        _transferPauserRole(newPauser);
    }

    function _transferPauserRole(address newPauser) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        address oldPauser = $.pauser;
        $.pauser = newPauser;
        emit PauserRoleTransferred(oldPauser, newPauser);
    }

    function addMinter(address newMinter) external onlyOwner {
        _updateMinter(newMinter, true);
    }

    function removeMinter(address oldMinter) external onlyOwner {
        _updateMinter(oldMinter, false);
    }

    function isMinter(address minter) external view returns (bool) {
        return _getLBTCStorage().minters[minter];
    }

    function _updateMinter(address minter, bool _isMinter) internal {
        if (minter == address(0)) {
            revert ZeroAddress();
        }
        _getLBTCStorage().minters[minter] = _isMinter;
        emit MinterUpdated(minter, _isMinter);
    }

    function changeBridge(address newBridge) external onlyOwner {
        if(newBridge == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        address oldBridge = $.bridge;
        $.bridge = newBridge;
        emit BridgeChanged(oldBridge, newBridge);
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function _update(address from, address to, uint256 value) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
