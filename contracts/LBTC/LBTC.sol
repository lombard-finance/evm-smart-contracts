// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {ILBTC} from "./ILBTC.sol";
import { FeeUtils } from "../libs/FeeUtils.sol";
import {Consortium} from "../consortium/Consortium.sol";
import {Actions} from "../libs/Actions.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";
/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LBTC is 
    ILBTC,  
    ERC20PausableUpgradeable, 
    Ownable2StepUpgradeable, 
    ReentrancyGuardUpgradeable, 
    EIP712Upgradeable,
    ERC20PermitUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        /// @custom:oz-renamed-from usedPayloads
        mapping(bytes32 => bool) usedPayloads;
        
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

        mapping(address => bool) minters;
        mapping(address => bool) claimers;

        // Increments with each cross chain operation and should be part of the payload
        uint256 crossChainOperationsNonce;
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

    function reinitializeV3(string memory name_, string memory version_) external reinitializer(3) {
        __EIP712_init(name_, version_);
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

    /** 
     * @notice Mint LBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of LBTC to mint    
     * @dev Only callable by whitelisted minters
     */ 
    function mint(address to, uint256 amount) external {
        _onlyMinter(_msgSender());

        _mint(to, amount);
    }

    /** 
     * @notice Mint LBTC in batches
     * @param to The addresses to mint to
     * @param amount The amounts of LBTC to mint    
     * @dev Only callable by whitelisted minters
     */ 
    function batchMint(address[] calldata to, uint256[] calldata amount) external {
        _onlyMinter(_msgSender());

        if(to.length != amount.length) {
            revert InvalidInputLength();
        }

        for(uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    /**
     * @notice Mint LBTC by proving a stake action happened
     * @param payload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mint(
        bytes calldata payload,
        bytes calldata proof
    ) public nonReentrant {
        // payload validation
        if (bytes4(payload) != Actions.DEPOSIT_BTC_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.DepositBtcAction memory action = Actions.depositBtc(payload[4:]);

        _validateAndMint(action.recipient, action.amount, action.amount, payload, proof);
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
        if(payload.length != proof.length) {
            revert InvalidInputLength();
        }

        for(uint256 i; i < payload.length; ++i) {
            mint(payload[i], proof[i]);
        }
    }

    /**
     * @notice Mint LBTC applying a commission to the amount
     * @dev Payload should be same as mint to avoid reusing them with and without fee
     * @dev Payload used in proof should be abi.encode(mintPayload, userSignature) 
     * to make sure the signature use is approved by consortium as well
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
    ) public {
        _onlyClaimer(_msgSender());

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
    ) external {
        _onlyClaimer(_msgSender());

        uint256 length = mintPayload.length;
        if(length != proof.length || length != feePayload.length || length != userSignature.length) {
            revert InvalidInputLength();
        }   

        for(uint256 i; i < mintPayload.length; ++i) {
            _mintWithFee(mintPayload[i], proof[i], feePayload[i], userSignature[i]);
        }
    }

    function _validateAndMint(address recipient, uint256 amountToMint, uint256 stakeAmount, bytes memory payload, bytes calldata proof) internal {
        LBTCStorage storage $ = _getLBTCStorage();
    
        // check proof validity
        bytes32 payloadHash = sha256(payload);
        if ($.usedPayloads[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        Consortium($.consortium).checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        // Confirm deposit against Bascule
        _confirmDeposit($, payloadHash, stakeAmount);

        // Actually mint
        _mint(recipient, amountToMint);

        emit MintProofConsumed(recipient, payloadHash, payload);
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
        uint256 fee = FeeUtils.getRelativeFee(amount, getDepositRelativeCommission(toChain));
        // absolute fee
        fee += $.depositAbsoluteCommission[toChain];

        if (fee >= amount) {
            revert AmountLessThanCommission(fee);
        }

        address fromAddress = _msgSender();
        _transfer(fromAddress, $.treasury, fee);
        uint256 amountWithoutFee = amount - fee;
        _burn(fromAddress, amountWithoutFee);

        // prepare deposit payload
        bytes32 uniqueActionData = bytes32($.crossChainOperationsNonce++);
        bytes memory payload = abi.encodeWithSelector(
            Actions.DEPOSIT_BRIDGE_ACTION, block.chainid, address(this), toChain, toContract, toAddress, amountWithoutFee, uniqueActionData
        );

        emit DepositToBridge(fromAddress, toAddress, sha256(payload), payload);
    }

    function withdrawFromBridge(
        bytes calldata payload,
        bytes calldata proof
    ) external nonReentrant {
        _notUsedPayload(payload);
        _withdraw(payload, proof);
        _storePayload(payload);
    }

    function _withdraw(bytes calldata payload, bytes calldata proof) internal {
        LBTCStorage storage $ = _getLBTCStorage();

        // payload validation
        if (bytes4(payload) != Actions.DEPOSIT_BRIDGE_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.DepositBridgeAction memory action = Actions.depositBridge(payload[4:]);

        if ($.destinations[bytes32(action.fromChain)] != bytes32(uint256(uint160(action.fromContract)))) {
            revert UnknownOriginContract(action.toChain, action.toContract);
        }

        // proof validation
        bytes32 payloadHash = sha256(payload);
        if ($.usedPayloads[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        Consortium($.consortium).checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        // Actually mint
        _mint(action.recipient, action.amount);

        emit WithdrawFromBridge(action.recipient, payloadHash, payload);
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
        FeeUtils.validateCommission(relCommission);

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
        FeeUtils.validateCommission(newValue);
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

    function addMinter(address newMinter) external onlyOwner {
        _updateMinter(newMinter, true);
    }

    function removeMinter(address oldMinter) external onlyOwner {
        _updateMinter(oldMinter, false);
    }

    function isMinter(address minter) external view returns (bool) {
        return _getLBTCStorage().minters[minter];
    }

    function addClaimer(address newClaimer) external onlyOwner {
        _updateClaimer(newClaimer, true);
    }

    function removeClaimer(address oldClaimer) external onlyOwner {
        _updateClaimer(oldClaimer, false);
    }

    function isClaimer(address claimer) external view returns (bool) {
        return _getLBTCStorage().claimers[claimer];
    }

    function _updateMinter(address minter, bool _isMinter) internal {
        if (minter == address(0)) {
            revert ZeroAddress();
        }
        _getLBTCStorage().minters[minter] = _isMinter;
        emit MinterUpdated(minter, _isMinter);
    }

    function _updateClaimer(address claimer, bool _isClaimer) internal {
        if (claimer == address(0)) {
            revert ZeroAddress();
        }
        _getLBTCStorage().claimers[claimer] = _isClaimer;
        emit ClaimerUpdated(claimer, _isClaimer);
    }

    function _notUsedPayload(bytes calldata payload) internal view {
        LBTCStorage storage $ = _getLBTCStorage();
        if($.usedPayloads[keccak256(payload)]) {
            revert PayloadAlreadyUsed(); 
        }
    }

    function _storePayload(bytes calldata payload) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $.usedPayloads[keccak256(payload)] = true;
    }

    function _onlyMinter(address sender) internal view {
        if(!_getLBTCStorage().minters[sender]) {
            revert UnauthorizedAccount(sender);
        }
    }

    function _onlyClaimer(address sender) internal view {
        if(!_getLBTCStorage().claimers[sender]) {
            revert UnauthorizedAccount(sender);
        }
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal nonReentrant {
        // mint payload validation
        if (bytes4(mintPayload) != Actions.DEPOSIT_BTC_ACTION) {
            revert UnexpectedAction(bytes4(mintPayload));
        }
        Actions.DepositBtcAction memory mintAction = Actions.depositBtc(mintPayload[4:]);

        // fee payload validation
        if (bytes4(feePayload) != Actions.FEE_APPROVAL_ACTION) {
            revert UnexpectedAction(bytes4(feePayload));
        }
        Actions.FeeApprovalAction memory feeAction = Actions.feeApproval(feePayload[4:], mintAction.amount);

        // Fee validation
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            Actions.FEE_APPROVAL_EIP712_ACTION,
            block.chainid,
            feeAction.fee,
            feeAction.expiry
        )));

        if(!EIP1271SignatureUtils.checkSignature(mintAction.recipient, digest, userSignature)) {
            revert InvalidUserSignature();
        }

        // modified payload to be signed
        _validateAndMint(mintAction.recipient, feeAction.amount, mintAction.amount, mintPayload, proof);
        
        // mint fee to treasury
        LBTCStorage storage $ = _getLBTCStorage();
        _mint($.treasury, feeAction.fee);
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function _update(address from, address to, uint256 value) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
