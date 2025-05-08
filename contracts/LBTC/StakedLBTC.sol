// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTCBase} from "./LBTCBase.sol";
import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {FeeUtils} from "../libs/FeeUtils.sol";
import {Consortium} from "../consortium/Consortium.sol";
import {Actions} from "../libs/Actions.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract StakedLBTC is LBTCBase, Ownable2StepUpgradeable {
    using SafeERC20 for IERC20;

    error UnauthorizedAccount(address account);
    error ZeroAmount();

    event PauserRoleTransferred(
        address indexed previousPauser,
        address indexed newPauser
    );
    event OperatorRoleTransferred(
        address indexed previousOperator,
        address indexed newOperator
    );
    event MinterUpdated(address indexed minter, bool isMinter);
    event ClaimerUpdated(address indexed claimer, bool isClaimer);
    event NativeLBTCUpdated(address indexed nativeLBTC);
    event WrapInitiated(address indexed user, bytes32 indexed swapId, uint256 amount);
    event UnwrapInitiated(address indexed user, bytes32 indexed swapId, uint256 amount);

    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        /// @dev is keccak256(payload[4:]) used
        /// @custom:oz-renamed-from usedProofs
        mapping(bytes32 => bool) legacyUsedPayloads;
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
        mapping(bytes32 => uint16) __removed__depositRelativeCommission;
        mapping(bytes32 => uint64) __removed__depositAbsoluteCommission;
        uint64 burnCommission; // absolute commission to charge on burn (unstake)
        uint256 dustFeeRate;
        /// Bascule drawbridge used to confirm deposits before allowing withdrawals
        IBascule bascule;
        address pauser;
        mapping(address => bool) minters;
        mapping(address => bool) claimers;
        /// Maximum fee to apply on mints
        uint256 maximumFee;
        // @dev is sha256(payload) used
        mapping(bytes32 => bool) usedPayloads;
        address operator;
        IERC20 nativeLBTC;
        mapping(address => bytes32[]) pendingSwaps;
        mapping(bytes32 => uint256) swapAmounts;
        mapping(address => uint256) swapNonce;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

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
        address owner_
    ) external initializer {
        __ERC20_init("", "");
        __ERC20Pausable_init();

        __Ownable_init(owner_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        __LBTC_init(
            "Lombard Staked Bitcoin",
            "stLBTC",
            consortium_,
            treasury,
            burnCommission_
        );

        LBTCStorage storage $ = _getLBTCStorage();
        $.dustFeeRate = BitcoinUtils.DEFAULT_DUST_FEE_RATE;
        emit DustFeeRateChanged(0, $.dustFeeRate);
    }

    function reinitialize() external reinitializer(2) {
        __ERC20Permit_init("Lombard Staked Bitcoin");
    }

    /// MODIFIER ///
    /**
     * PAUSE
     */
    modifier onlyPauser() {
        _checkPauser();
        _;
    }

    modifier onlyMinter() {
        if (!_getLBTCStorage().minters[_msgSender()]) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyClaimer() {
        if (!_getLBTCStorage().claimers[_msgSender()]) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyOperator() {
        if (_getLBTCStorage().operator != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// ONLY OWNER FUNCTIONS ///

    function toggleWithdrawals() external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit WithdrawalsEnabled($.isWithdrawalsEnabled);
    }

    function changeNameAndSymbol(
        string calldata name_,
        string calldata symbol_
    ) external onlyOwner {
        _changeNameAndSymbol(name_, symbol_);
    }

    function changeConsortium(address newVal) external onlyOwner {
        _changeConsortium(newVal);
    }

    /**
     * @notice Set the contract current fee for mint
     * @param fee New fee value
     * @dev zero allowed to disable fee
     */
    function setMintFee(uint256 fee) external onlyOperator {
        LBTCStorage storage $ = _getLBTCStorage();
        uint256 oldFee = $.maximumFee;
        $.maximumFee = fee;
        emit FeeChanged(oldFee, fee);
    }

    function changeTreasuryAddress(address newValue) external onlyOwner {
        _changeTreasuryAddress(newValue);
    }

    function changeBurnCommission(uint64 newValue) external onlyOwner {
        _changeBurnCommission(newValue);
    }

    function changeNativeLBTC(IERC20 nativeLBTC) external onlyOwner {
        _changeNativeLBTC(nativeLBTC);
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function addMinter(address newMinter) external onlyOwner {
        _updateMinter(newMinter, true);
    }

    function removeMinter(address oldMinter) external onlyOwner {
        _updateMinter(oldMinter, false);
    }

    function addClaimer(address newClaimer) external onlyOwner {
        _updateClaimer(newClaimer, true);
    }

    function removeClaimer(address oldClaimer) external onlyOwner {
        _updateClaimer(oldClaimer, false);
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

    function transferPauserRole(address newPauser) external onlyOwner {
        if (newPauser == address(0)) {
            revert ZeroAddress();
        }
        _transferPauserRole(newPauser);
    }

    function transferOperatorRole(address newOperator) external onlyOwner {
        if (newOperator == address(0)) {
            revert ZeroAddress();
        }
        _transferOperatorRole(newOperator);
    }

    /// GETTERS ///

    /**
     * @notice Returns the current maximum mint fee
     */
    function getMintFee() external view returns (uint256) {
        return _getLBTCStorage().maximumFee;
    }

    /// @notice Calculate the amount that will be unstaked and check if it's above the dust limit
    /// @dev This function can be used by front-ends to verify burn amounts before submitting a transaction
    /// @param scriptPubkey The Bitcoin script public key as a byte array
    /// @param amount The amount of stLBTC to be burned
    /// @return amountAfterFee The amount that will be unstaked (after deducting the burn commission)
    /// @return isAboveDust Whether the amountAfterFee is equal to or above the dust limit
    function calcUnstakeRequestAmount(
        bytes calldata scriptPubkey,
        uint256 amount
    ) external view returns (uint256 amountAfterFee, bool isAboveDust) {
        LBTCStorage storage $ = _getLBTCStorage();
        (amountAfterFee, , , isAboveDust) = _calcFeeAndDustLimit(
            scriptPubkey,
            amount,
            $.burnCommission,
            $.dustFeeRate
        );
        return (amountAfterFee, isAboveDust);
    }

    function consortium() external view virtual returns (address) {
        return _getLBTCStorage().consortium;
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

    function pauser() public view returns (address) {
        return _getLBTCStorage().pauser;
    }

    function operator() external view returns (address) {
        return _getLBTCStorage().operator;
    }

    function isMinter(address minter) external view returns (bool) {
        return _getLBTCStorage().minters[minter];
    }

    function isClaimer(address claimer) external view returns (bool) {
        return _getLBTCStorage().claimers[claimer];
    }

    /// USER ACTIONS ///

    /**
     * @notice Mint stLBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of stLBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function mint(address to, uint256 amount) external override onlyMinter {
        _mint(to, amount);
    }

    /**
     * @notice Mint stLBTC in batches
     * @param to The addresses to mint to
     * @param amount The amounts of stLBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyMinter {
        if (to.length != amount.length) {
            revert InvalidInputLength();
        }

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    /**
     * @notice Mint stLBTC in batches by proving stake actions happened
     * @param payload The messages with the stake data
     * @param proof Signatures of the consortium approving the mints
     */
    function batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external {
        if (payload.length != proof.length) {
            revert InvalidInputLength();
        }

        for (uint256 i; i < payload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(payload[i]);
            bytes32 legacyPayloadHash = keccak256(payload[i][4:]);
            if (isPayloadUsed(payloadHash, legacyPayloadHash)) {
                emit BatchMintSkipped(payloadHash, payload[i]);
                continue;
            }

            mint(payload[i], proof[i]);
        }
    }

    /**
     * @notice Mint stLBTC applying a commission to the amount
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
    ) external onlyClaimer {
        LBTCStorage storage $ = _getLBTCStorage();
        _mintWithFee(
            mintPayload,
            proof,
            feePayload,
            userSignature,
            $.maximumFee,
            $.treasury
        );
    }

    /**
     * @notice Mint stLBTC in batches proving stake actions happened
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
    ) external onlyClaimer {
        uint256 length = mintPayload.length;
        if (
            length != proof.length ||
            length != feePayload.length ||
            length != userSignature.length
        ) {
            revert InvalidInputLength();
        }

        LBTCStorage storage $ = _getLBTCStorage();
        for (uint256 i; i < mintPayload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(mintPayload[i]);
            bytes32 legacyPayloadHash = keccak256(mintPayload[i][4:]);
            if (isPayloadUsed(payloadHash, legacyPayloadHash)) {
                emit BatchMintSkipped(payloadHash, mintPayload[i]);
                continue;
            }

            _mintWithFee(
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i],
                $.maximumFee,
                $.treasury
            );
        }
    }

    /**
     * @dev Burns stLBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of stLBTC to burn
     */
    function redeem(bytes calldata scriptPubkey, uint256 amount) external {
        LBTCStorage storage $ = _getLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        uint64 fee = $.burnCommission;
        (
            uint256 amountAfterFee,
            bool isAboveFee,
            uint256 dustLimit,
            bool isAboveDust
        ) = _calcFeeAndDustLimit(scriptPubkey, amount, fee, $.dustFeeRate);
        if (!isAboveFee) {
            revert AmountLessThanCommission(fee);
        }
        if (!isAboveDust) {
            revert AmountBelowDustLimit(dustLimit);
        }

        address fromAddress = address(_msgSender());
        _transfer(fromAddress, getTreasury(), fee);
        _burn(fromAddress, amountAfterFee);

        emit UnstakeRequest(fromAddress, scriptPubkey, amountAfterFee);
    }

    /**
     * @dev Allows minters to burn stLBTC
     *
     * @param amount Amount of stLBTC to burn
     */
    function burn(address from, uint256 amount) external override onlyMinter {
        _burn(from, amount);
    }

    /**
     * @dev Initiates a wrap, converting LBTC to stLBTC
     * @param amount Amount of LBTC to wrap
     */
    function initiateWrap(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        LBTCStorage storage $ = _getLBTCStorage();
        uint256 nonce = $.swapNonce[_msgSender()];
        bytes32 swapId = sha256(abi.encode(_msgSender(), nonce));
        $.swapNonce[_msgSender()] += 1;
        $.swapAmounts[swapId] = amount;
        $.nativeLBTC.safeTransferFrom(_msgSender(), address(this), amount);

        emit WrapInitiated(_msgSender(), swapId, amount);
    }

    /**
     * @dev Finishes a wrap operation
     * @param payload The wrap payload
     */
    function finishWrap(bytes payload) external nonReentrant {
    }

    /**
     * @dev Initiates an unwrap, converting stLBTC to LBTC
     * @param amount Amount of stLBTC to unwrap
     */
    function initiateUnwrap(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        LBTCStorage storage $ = _getLBTCStorage();
        uint256 nonce = $.swapNonce[_msgSender()];
        bytes32 swapId = sha256(abi.encode(_msgSender(), nonce));
        $.swapNonce[_msgSender()] += 1;
        $.swapAmounts[swapId] = amount;
        IERC20(this).safeTransferFrom(_msgSender(), address(this), amount);

        emit UnwrapInitiated(_msgSender(), swapId, amount);
    }

    /**
     * @dev Finishes an unwrap operation
     * @param payload The unwrap payload
     */
    function finishUnwrap(bytes payload) external nonReentrant {
    }

    /**
     * @dev Returns whether a minting payload has been used already
     *
     * @param payloadHash The minting payload hash
     * @param legacyPayloadHash The legacy minting payload hash
     */
    function isPayloadUsed(
        bytes32 payloadHash,
        bytes32 legacyPayloadHash
    ) public view returns (bool) {
        LBTCStorage storage $ = _getLBTCStorage();
        return
            $.usedPayloads[payloadHash] ||
            $.legacyUsedPayloads[legacyPayloadHash];
    }

    /// PRIVATE FUNCTIONS ///

    function __LBTC_init(
        string memory name_,
        string memory symbol_,
        address consortium_,
        address treasury,
        uint64 burnCommission_
    ) internal onlyInitializing {
        _changeNameAndSymbol(name_, symbol_);
        _changeConsortium(consortium_);
        _changeTreasuryAddress(treasury);
        _changeBurnCommission(burnCommission_);
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _changeConsortium(address newVal) internal {
        if (newVal == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        emit ConsortiumChanged($.consortium, newVal);
        $.consortium = newVal;
    }

    function _validateAndMint(
        address recipient,
        uint256 amountToMint,
        uint256 depositAmount,
        bytes calldata payload,
        bytes calldata proof
    ) internal override {
        LBTCStorage storage $ = _getLBTCStorage();

        if (amountToMint > depositAmount) revert InvalidMintAmount();

        /// make sure that hash of payload not used before
        /// need to check new sha256 hash and legacy keccak256 from payload without selector
        /// 2 checks made to prevent migration of contract state
        bytes32 payloadHash = sha256(payload);
        bytes32 legacyHash = keccak256(payload[4:]);
        if ($.usedPayloads[payloadHash] || $.legacyUsedPayloads[legacyHash]) {
            revert PayloadAlreadyUsed();
        }
        Consortium($.consortium).checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        // Confirm deposit against Bascule
        _confirmDeposit($.bascule, legacyHash, depositAmount);

        // Actually mint
        _mint(recipient, amountToMint);

        emit MintProofConsumed(recipient, payloadHash, payload);
    }

    function _changeBurnCommission(uint64 newValue) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        uint64 prevValue = $.burnCommission;
        $.burnCommission = newValue;
        emit BurnCommissionChanged(prevValue, newValue);
    }

    function _changeNativeLBTC(IERC20 nativeLBTC_) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $.nativeLBTC = nativeLBTC_;
        emit NativeLBTCUpdated(address(nativeLBTC_));
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

    function _transferPauserRole(address newPauser) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        address oldPauser = $.pauser;
        $.pauser = newPauser;
        emit PauserRoleTransferred(oldPauser, newPauser);
    }

    function _transferOperatorRole(address newOperator) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        address oldOperator = $.operator;
        $.operator = newOperator;
        emit OperatorRoleTransferred(oldOperator, newOperator);
    }

    function _checkPauser() internal view {
        if (pauser() != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
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

    function _changeTreasuryAddress(address newValue) internal {
        if (newValue == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }

    function _decodeMintPayload(
        bytes calldata payload
    ) internal view override returns (DecodedPayload memory) {
        if (
            bytes4(payload) != Actions.DEPOSIT_BTC_ACTION_V0 &&
            bytes4(payload) != Actions.DEPOSIT_BTC_ACTION_V1
        ) {
            revert UnexpectedAction(bytes4(payload));
        }

        address recipient;
        uint256 amount;
        if (bytes4(payload) == Actions.DEPOSIT_BTC_ACTION_V1) {
            Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
                payload[4:]
            );

            recipient = action.recipient;
            amount = action.amount;
            if (action.tokenAddress != address(this)) {
                revert WrongTokenAddress(action.tokenAddress);
            }
        } else if (bytes4(payload) == Actions.DEPOSIT_BTC_ACTION_V0) {
            Actions.DepositBtcActionV0 memory action = Actions.depositBtcV0(
                payload[4:]
            );

            recipient = action.recipient;
            amount = action.amount;
        }

        return DecodedPayload(recipient, amount);
    }

    function _getLBTCStorage() private pure returns (LBTCStorage storage $) {
        assembly {
            $.slot := LBTC_STORAGE_LOCATION
        }
    }
}
