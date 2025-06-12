// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {Actions} from "../libs/Actions.sol";
import {IStakedLBTC} from "./interfaces/IStakedLBTC.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Assert} from "./libraries/Assert.sol";
import {Validation} from "./libraries/Validation.sol";
import {Staking} from "./libraries/Staking.sol";
import {Redeem} from "./libraries/Redeem.sol";
/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract StakedLBTC is
    IStakedLBTC,
    IStaking,
    ERC20PausableUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable
{
    using SafeERC20 for IERC20;

    /// @dev the storage name differs, because contract was renamed from LBTC
    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct StakedLBTCStorage {
        /// @dev is keccak256(payload[4:]) used
        /// @custom:oz-renamed-from usedProofs
        mapping(bytes32 => bool) legacyUsedPayloads;
        string name;
        string symbol;
        bool isWithdrawalsEnabled;
        INotaryConsortium consortium;
        /// @custom:oz-renamed-from isWBTCEnabled
        bool __removed_isWBTCEnabled;
        /// @custom:oz-renamed-from wbtc
        address __removed_wbtc;
        address treasury;
        /// @custom:oz-renamed-from destinations
        mapping(uint256 => address) __removed_destinations;
        /// @custom:oz-renamed-from depositCommission
        mapping(uint256 => uint16) __removed_depositCommission;
        /// @custom:oz-renamed-from usedBridgeProofs
        mapping(bytes32 => bool) __removed_usedBridgeProofs;
        /// @custom:oz-renamed-from globalNonce
        uint256 __removed_globalNonce;
        /// @custom:oz-renamed-from destinations
        mapping(bytes32 => bytes32) __removed__destinations;
        /// @custom:oz-renamed-from depositRelativeCommission
        mapping(bytes32 => uint16) __removed__depositRelativeCommission;
        /// @custom:oz-renamed-from depositAbsoluteCommission
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
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
        address operator;
        IStakingRouter StakingRouter;
        uint256 redeemNonce;
    }

    /// @dev the storage location differs, because contract was renamed from LBTC
    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKED_LBTC_STORAGE_LOCATION =
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
        __ERC20Permit_init("Lombard Staked Bitcoin"); // TODO: set new name

        __ReentrancyGuard_init();

        __StakedLBTC_init(
            "Lombard Staked Bitcoin", // TODO: set new name
            "stLBTC", // TODO: set new symbol
            consortium_,
            treasury,
            burnCommission_
        );

        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        $.dustFeeRate = BitcoinUtils.DEFAULT_DUST_FEE_RATE;
        emit DustFeeRateChanged(0, $.dustFeeRate);
    }

    function reinitialize() external reinitializer(3) {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        // start count nonces from 1
        $.redeemNonce = 1;
    }

    /// MODIFIER ///
    /**
     * PAUSE
     */
    modifier onlyPauser() {
        if (pauser() != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyMinter() {
        if (!_getStakedLBTCStorage().minters[_msgSender()]) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyClaimer() {
        if (!_getStakedLBTCStorage().claimers[_msgSender()]) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyOperator() {
        if (_getStakedLBTCStorage().operator != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// ONLY OWNER FUNCTIONS ///

    function toggleWithdrawals() external onlyOwner {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
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
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        uint256 oldFee = $.maximumFee;
        $.maximumFee = fee;
        emit FeeChanged(oldFee, fee);
    }

    function changeTreasuryAddress(address newValue) external onlyOwner {
        _changeTreasury(newValue);
    }

    function changeBurnCommission(uint64 newValue) external onlyOwner {
        _changeBurnCommission(newValue);
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyOwner {
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

    function changeStakingRouter(address newVal) external onlyOwner {
        _changeStakingRouter(newVal);
    }

    /// @notice Change the dust fee rate used for dust limit calculations
    /// @dev Only the contract owner can call this function. The new rate must be positive.
    /// @param newRate The new dust fee rate (in satoshis per 1000 bytes)
    function changeDustFeeRate(uint256 newRate) external onlyOwner {
        _changeDustFeeRate(newRate);
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

    function changePauser(address newPauser) external onlyOwner {
        _changePauser(newPauser);
    }

    function changeOperator(address newOperator) external onlyOwner {
        _changeOperator(newOperator);
    }

    /// GETTERS ///

    /**
     * @notice Returns the current maximum mint fee
     */
    function getMintFee() external view returns (uint256) {
        return _getStakedLBTCStorage().maximumFee;
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
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();

        (amountAfterFee, , , isAboveDust) = Validation.calcFeeAndDustLimit(
            scriptPubkey,
            $.dustFeeRate,
            amount,
            $.burnCommission
        );
        return (amountAfterFee, isAboveDust);
    }

    function consortium() external view virtual returns (INotaryConsortium) {
        return _getStakedLBTCStorage().consortium;
    }

    function StakingRouter() external view returns (IStakingRouter) {
        return _getStakedLBTCStorage().StakingRouter;
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
        return _getStakedLBTCStorage().name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _getStakedLBTCStorage().symbol;
    }

    function getTreasury() public view override returns (address) {
        return _getStakedLBTCStorage().treasury;
    }

    function getBurnCommission() public view returns (uint64) {
        return _getStakedLBTCStorage().burnCommission;
    }

    /// @notice Get the current dust fee rate
    /// @return The current dust fee rate (in satoshis per 1000 bytes)
    function getDustFeeRate() public view returns (uint256) {
        return _getStakedLBTCStorage().dustFeeRate;
    }

    /**
     * Get Bascule contract.
     */
    function Bascule() external view returns (IBascule) {
        return _getStakedLBTCStorage().bascule;
    }

    function pauser() public view returns (address) {
        return _getStakedLBTCStorage().pauser;
    }

    function operator() external view returns (address) {
        return _getStakedLBTCStorage().operator;
    }

    function isMinter(address minter) external view returns (bool) {
        return _getStakedLBTCStorage().minters[minter];
    }

    function isClaimer(address claimer) external view returns (bool) {
        return _getStakedLBTCStorage().claimers[claimer];
    }

    /// USER ACTIONS ///

    /**
     * @notice Mint LBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of LBTC to mint
     * @dev Only callable by whitelisted minters
     */
    function mint(address to, uint256 amount) external override onlyMinter {
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
    ) external onlyMinter {
        Assert.equalLength(to.length, amount.length);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    /**
     * @notice Mint StakedLBTC by proving a stake action happened
     * @param rawPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant {
        Assert.selector(rawPayload, Actions.DEPOSIT_BTC_ACTION_V0);
        Actions.DepositBtcActionV0 memory action = Actions.depositBtcV0(
            rawPayload[4:]
        );

        _validateAndMint(
            action.recipient,
            action.amount,
            action.amount,
            rawPayload,
            proof
        );
    }

    /**
     * @dev Burns StakedLBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of StakedLBTC to burn
     */
    function redeem(bytes calldata scriptPubkey, uint256 amount) external {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            // TODO: rename to redeem
            revert WithdrawalsDisabled();
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

        emit StakingOperationRequested(fromAddress, scriptPubkey, address(this), amount, rawPayload);
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
    function burn(address from, uint256 amount) external override onlyMinter {
        _burn(from, amount);
    }

    function startUnstake(
        bytes32 tolChainId,
        bytes calldata recipient,
        uint256 amount
    ) external nonReentrant {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        $.StakingRouter.startUnstake(
            tolChainId,
            address(this),
            recipient,
            amount
        );
        _burn(_msgSender(), amount);
    }

    function startStake(
        bytes32 tolChainId,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount 
    ) external nonReentrant {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address nativeToken = $.StakingRouter.startStake(
            tolChainId,
            address(this),
            toToken,
            recipient,
            amount
        );
        IERC20(nativeToken).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );
        IBaseLBTC(nativeToken).burn(amount);
    }

    function finalizeStakingOperation(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        bool success = $.StakingRouter.finalizeStakingOperation(rawPayload, proof);
    }

    /// PRIVATE FUNCTIONS ///

    function __StakedLBTC_init(
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
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param $ LBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(
        StakedLBTCStorage storage $,
        bytes32 depositID,
        uint256 amount
    ) internal {
        IBascule bascule = $.bascule;
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
        }
    }

    /// @dev zero rate not allowed
    function _changeDustFeeRate(uint256 newRate) internal {
        Assert.dustFeeRate(newRate);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        uint256 oldRate = $.dustFeeRate;
        $.dustFeeRate = newRate;
        emit DustFeeRateChanged(oldRate, newRate);
    }

    /// @dev not zero
    function _changeConsortium(address newVal) internal {
        Assert.zeroAddress(newVal);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        emit ConsortiumChanged(address($.consortium), newVal);
        $.consortium = INotaryConsortium(newVal);
    }

    /// @dev allow set to zero
    function _changeBurnCommission(uint64 newValue) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        uint64 prevValue = $.burnCommission;
        $.burnCommission = newValue;
        emit BurnCommissionChanged(prevValue, newValue);
    }

    /// @dev Zero Address allowed to disable bascule check
    function _changeBascule(address newVal) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        emit BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    /// @dev Not zero
    function _changePauser(address newPauser) internal {
        Assert.zeroAddress(newPauser);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address oldPauser = $.pauser;
        $.pauser = newPauser;
        emit PauserRoleTransferred(oldPauser, newPauser);
    }

    /// @dev Not zero
    function _changeOperator(address newOperator) internal {
        Assert.zeroAddress(newOperator);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address oldOperator = $.operator;
        $.operator = newOperator;
        emit OperatorRoleTransferred(oldOperator, newOperator);
    }

    /// @dev `minter` not zero
    function _updateMinter(address minter, bool _isMinter) internal {
        Assert.zeroAddress(minter);
        _getStakedLBTCStorage().minters[minter] = _isMinter;
        emit MinterUpdated(minter, _isMinter);
    }

    /// @dev `claimer` not zero
    function _updateClaimer(address claimer, bool _isClaimer) internal {
        Assert.zeroAddress(claimer);
        _getStakedLBTCStorage().claimers[claimer] = _isClaimer;
        emit ClaimerUpdated(claimer, _isClaimer);
    }

    /// @dev `treasury` not zero
    function _changeTreasury(address newValue) internal {
        Assert.zeroAddress(newValue);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }

    /// @dev allow zero address to disable Stakings
    function _changeStakingRouter (address newVal) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address prevValue = address($.StakingRouter);
        $.StakingRouter = IStakingRouter(newVal);
        emit StakingRouterChanged(prevValue, newVal);
    }

    function _getStakedLBTCStorage()
        private
        pure
        returns (StakedLBTCStorage storage $)
    {
        assembly {
            $.slot := STAKED_LBTC_STORAGE_LOCATION
        }
    }

    function _validateAndMint(
        address recipient,
        uint256 amountToMint,
        uint256 depositAmount,
        bytes calldata payload,
        bytes calldata proof
    ) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();

        if (amountToMint > depositAmount) revert InvalidMintAmount();

        /// make sure that hash of payload not used before
        /// need to check new sha256 hash and legacy keccak256 from payload without selector
        /// 2 checks made to prevent migration of contract state
        bytes32 payloadHash = sha256(payload);
        bytes32 legacyHash = keccak256(payload[4:]);
        if (_isPayloadUsed($, payloadHash, legacyHash)) {
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
     * @dev Returns whether a minting payload has been used already
     * @param payloadHash The minting payload hash
     * @param legacyPayloadHash The legacy minting payload hash
     */
    function _isPayloadUsed(
        StakedLBTCStorage storage $,
        bytes32 payloadHash,
        bytes32 legacyPayloadHash
    ) internal view returns (bool) {
        return
            $.usedPayloads[payloadHash] ||
            $.legacyUsedPayloads[legacyPayloadHash];
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
