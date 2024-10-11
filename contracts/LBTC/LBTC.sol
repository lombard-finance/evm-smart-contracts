// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from
    "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {ILBTC} from "./ILBTC.sol";
import {OutputCodec} from "../libs/OutputCodec.sol";
import {BridgeDepositCodec} from "../libs/BridgeDepositCodec.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";
import {LombardConsortium} from "../consortium/LombardConsortium.sol";
import {OutputWithPayload, OutputCodec} from "../libs/OutputCodec.sol";
import {BridgeDepositPayload, BridgeDepositCodec} from "../libs/BridgeDepositCodec.sol";
import {Actions} from "../libs/Actions.sol";
/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */

contract LBTC is ILBTC, ERC20PausableUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        /// @custom:oz-renamed-from usedProofs
        mapping(bytes32 => bool) __removed_usedProofs;
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
        mapping(bytes32 => bytes32) destinations;
        mapping(bytes32 => uint16) depositRelativeCommission; // relative to amount commission to charge on bridge deposit
        mapping(bytes32 => uint64) depositAbsoluteCommission; // absolute commission to charge on bridge deposit
        uint64 burnCommission; // absolute commission to charge on burn (unstake)
        uint256 dustFeeRate;
        // Bascule drawbridge used to confirm deposits before allowing withdrawals
        IBascule bascule;
        address pauser;
        // Increments with each cross chain operation and should be part of the payload
        uint256 crossChainOperationsNonce;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION = 0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;
    uint16 public constant MAX_COMMISSION = 10000; // 100.00%

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

    function initialize(address consortium_, uint64 burnCommission_) external initializer {
        __ERC20_init("LBTC", "LBTC");
        __ERC20Pausable_init();

        __Ownable_init(_msgSender());
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        __LBTC_init("Lombard Staked Bitcoin", "LBTC", consortium_, burnCommission_);

        LBTCStorage storage $ = _getLBTCStorage();
        $.dustFeeRate = 3000; // Default value - 3 satoshis per byte
        emit DustFeeRateChanged(0, $.dustFeeRate);
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

    function mint(bytes calldata payload, bytes calldata proof) external nonReentrant {
        LBTCStorage storage $ = _getLBTCStorage();

        // payload validation
        if (bytes4(payload) != Actions.MINT_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.MintAction memory action = Actions.mint(payload[4:]);

        // check proof validity
        LombardConsortium($.consortium).checkProof(sha256(payload), proof);

        bytes32 proofHash = sha256(proof);

        // Confirm deposit against Bascule
        _confirmDeposit($, proofHash, action.amount);

        // Actually mint
        _mint(action.recipient, action.amount);

        emit MintProofConsumed(action.recipient, action.amount, proofHash);
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

    // --- Bridge ---

    function depositToBridge(bytes32 toChain, bytes32 toAddress, uint64 amount) external nonReentrant {
        bytes32 toContract = getDestination(toChain);

        if (toContract == bytes32(0)) {
            revert UnknownDestination();
        }

        if (toAddress == bytes32(0)) {
            revert ZeroAddress();
        }

        _deposit(toChain, toContract, toAddress, amount);
    }

    /**
     * @dev LBTC on source and destination chains are linked with independent supplies.
     * Burns tokens on source chain (to later mint on destination chain).
     * @param toChain one of many destination chain ID.
     * @param toAddress claimer of 'amount' on destination chain.
     * @param amount amount of tokens to be bridged.
     */
    function _deposit(bytes32 toChain, bytes32 toContract, bytes32 toAddress, uint64 amount) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        // relative fee
        uint16 relativeComs = $.depositRelativeCommission[toChain];
        if (amount < relativeComs) {
            revert AmountTooSmallToPayRelativeFee();
        }

        uint256 fee = _calcRelativeFee(amount, relativeComs);

        // absolute fee
        fee += $.depositAbsoluteCommission[toChain];

        if (fee >= amount) {
            revert AmountLessThanCommission(fee);
        }

        address fromAddress = _msgSender();
        _transfer(fromAddress, $.treasury, fee);
        uint256 amountWithoutFee = amount - fee;
        _burn(fromAddress, amountWithoutFee);

        // prepare burn payload
        bytes memory extraData = abi.encode($.crossChainOperationsNonce++);
        bytes memory payload = abi.encodeWithSelector(
            Actions.BURN_ACTION, block.chainid, address(this), toChain, toContract, toAddress, amountWithoutFee, extraData
        );

        emit DepositToBridge(fromAddress, toAddress, toContract, toChain, uint64(amountWithoutFee), sha256(payload));
    }

    function _calcRelativeFee(uint64 amount, uint16 commission) internal pure returns (uint256 fee) {
        return Math.mulDiv(amount, commission, MAX_COMMISSION, Math.Rounding.Ceil);
    }

    function withdrawFromBridge(bytes calldata payload, bytes calldata proof) external nonReentrant {
        _withdraw(payload, proof);
    }

    function _withdraw(bytes calldata payload, bytes calldata proof) internal {
        LBTCStorage storage $ = _getLBTCStorage();

        // payload validation
        if (bytes4(payload) != Actions.BURN_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.BurnAction memory action = Actions.burn(payload[4:]);

        if ($.destinations[bytes32(action.fromChain)] != bytes32(uint256(uint160(action.fromContract)))) {
            revert UnknownOriginContract(action.toChain, action.toContract);
        }

        // proof validation
        LombardConsortium($.consortium).checkProof(sha256(payload), proof);

        bytes32 proofHash = sha256(proof);

        // Confirm deposit against Bascule
        _confirmDeposit($, proofHash, action.amount);

        // Actually mint
        _mint(action.recipient, action.amount);

        emit WithdrawFromBridge(action.recipient, action.amount, proofHash);
    }

    function addDestination(bytes32 toChain, bytes32 toContract, uint16 relCommission, uint64 absCommission)
        external
        onlyOwner
    {
        if (toContract == bytes32(0)) {
            revert ZeroContractHash();
        }
        if (toChain == bytes32(0)) {
            revert ZeroChainId();
        }

        if (getDestination(toChain) != bytes32(0)) {
            revert KnownDestination();
        }
        // do not allow 100% commission or higher values
        if (relCommission >= MAX_COMMISSION) {
            revert BadCommission();
        }

        LBTCStorage storage $ = _getLBTCStorage();
        $.destinations[toChain] = toContract;
        $.depositRelativeCommission[toChain] = relCommission;
        $.depositAbsoluteCommission[toChain] = absCommission;

        emit DepositAbsoluteCommissionChanged(absCommission, toChain);
        emit DepositRelativeCommissionChanged(relCommission, toChain);
        emit BridgeDestinationAdded(toChain, toContract);
    }

    function removeDestination(bytes32 toChain) external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        bytes32 toContract = $.destinations[toChain];
        if (toContract == bytes32(0)) {
            revert ZeroContractHash();
        }
        delete $.destinations[toChain];
        delete $.depositRelativeCommission[toChain];
        delete $.depositAbsoluteCommission[toChain];

        emit DepositAbsoluteCommissionChanged(0, toChain);
        emit DepositRelativeCommissionChanged(0, toChain);
        emit BridgeDestinationRemoved(toChain, toContract);
    }

    /**
     * @dev Get destination contract for chain id
     * @param chainId Chain id of the destination chain
     */
    function getDestination(bytes32 chainId) public view returns (bytes32) {
        return _getLBTCStorage().destinations[chainId];
    }

    function getTreasury() public view returns (address) {
        return _getLBTCStorage().treasury;
    }

    function getDepositAbsoluteCommission(bytes32 toChain) public view returns (uint64) {
        return _getLBTCStorage().depositAbsoluteCommission[toChain];
    }

    function getDepositRelativeCommission(bytes32 toChain) public view returns (uint16) {
        return _getLBTCStorage().depositRelativeCommission[toChain];
    }

    function getBurnCommission() public view returns (uint64) {
        return _getLBTCStorage().burnCommission;
    }

    function changeDepositAbsoluteCommission(uint64 newValue, bytes32 chain) external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        $.depositAbsoluteCommission[chain] = newValue;
        emit DepositAbsoluteCommissionChanged(newValue, chain);
    }

    function changeDepositRelativeCommission(uint16 newValue, bytes32 chain) external onlyOwner {
        // do not allow 100% commission
        if (newValue >= MAX_COMMISSION) {
            revert BadCommission();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        $.depositRelativeCommission[chain] = newValue;
        emit DepositRelativeCommissionChanged(newValue, chain);
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
}
