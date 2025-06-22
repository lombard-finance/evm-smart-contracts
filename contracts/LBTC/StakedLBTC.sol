// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {IStaking} from "./interfaces/IStaking.sol";
import {IAssetRouter} from "./interfaces/IAssetRouter.sol";
import {Actions} from "../libs/Actions.sol";
import {IStakedLBTC} from "./interfaces/IStakedLBTC.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Assert} from "./libraries/Assert.sol";
import {Validation} from "./libraries/Validation.sol";
import {Redeem} from "./libraries/Redeem.sol";
import {BaseLBTC} from "./BaseLBTC.sol";

/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract StakedLBTC is
    IStakedLBTC,
    IStaking,
    BaseLBTC,
    Ownable2StepUpgradeable
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
        /// @custom:oz-renamed-from burnCommission
        uint64 __removed__burnCommission; // absolute commission to charge on burn (unstake)
        uint256 dustFeeRate;
        /// Bascule drawbridge used to confirm deposits before allowing withdrawals
        IBascule bascule;
        address pauser;
        mapping(address => bool) minters;
        mapping(address => bool) claimers;
        /// Maximum fee to apply on mints
        /// @custom:oz-renamed-from maximumFee
        uint256 __removed__maximumFee;
        /// @custom:oz-renamed-from usedPayloads
        mapping(bytes32 => bool) __removed__usedPayloads; // sha256(rawPayload) => used
        address operator;
        IAssetRouter assetRouter;
        uint256 redeemFee;
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

    function reinitialize() external reinitializer(2) {}

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

    function toggleRedeemsForBtc() external onlyOwner {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit RedeemsForBtcEnabled($.isWithdrawalsEnabled);
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

    function changeTreasuryAddress(address newValue) external onlyOwner {
        _changeTreasury(newValue);
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

    function changeAssetRouter(address newVal) external onlyOwner {
        _changeAssetRouter(newVal);
    }

    function changeRedeemFee(uint256 newVal) external onlyOwner {
        _changeRedeemFee(newVal);
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
        return $.assetRouter.calcUnstakeRequestAmount(address(this), scriptPubkey, amount);
    }

    function consortium() external view virtual returns (INotaryConsortium) {
        return _getStakedLBTCStorage().consortium;
    }

    function getAssetRouter() external view override returns (address) {
        return address(_getStakedLBTCStorage().assetRouter);
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
        return _getStakedLBTCStorage().assetRouter.toNativeCommission();
    }

    /// @notice Get the current dust fee rate
    /// @return The current dust fee rate (in satoshis per 1000 bytes)
    function getDustFeeRate() public view returns (uint256) {
        return _getStakedLBTCStorage().dustFeeRate;
    }

    function getRedeemFee() public view returns (uint256) {
        return _getStakedLBTCStorage().redeemFee;
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

    function isNative() public pure returns (bool) {
        return false;
    }

    function isRedeemsEnabled() public view override returns (bool) {
        return _getStakedLBTCStorage().isWithdrawalsEnabled;
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
        _batchMint(to, amount);
    }

    /**
     * @notice Mint StakedLBTC by proving a stake action happened
     * @param rawPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant returns (address recipient) {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        return $.assetRouter.mint(rawPayload, proof);
    }

    /**
     * @notice Mint StakedLBTC in batches by DepositV1 payloads
     * @param payload The messages with the stake data
     * @param proof Signatures of the consortium approving the mints
     */
    function batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external nonReentrant {
        if (paused()) {
            revert EnforcedPause();
        }
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.batchMint(payload, proof);
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
    ) external onlyClaimer {
        _mintWithFee(mintPayload, proof, feePayload, userSignature);
    }

    /**
     * @notice Mint Staked LBTC in batches proving stake actions happened
     * @param mintPayload DepositV1 payloads
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
        if (paused()) {
            revert EnforcedPause();
        }
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.batchMintWithFee(mintPayload, proof, feePayload, userSignature);
    }

    /**
     * @dev Burns StakedLBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     *
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of StakedLBTC to burn
     */
    function redeemForBtc(
        bytes calldata scriptPubkey,
        uint256 amount
    ) external {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.redeemForBtc(
            address(_msgSender()),
            address(this),
            scriptPubkey,
            amount
        );
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

    /**
     * @dev Allows minters to transfer LBTC
     *
     * @param amount Amount of LBTC to transfer
     */
    function transfer(
        address from,
        address to,
        uint256 amount
    ) external override onlyMinter {
        _transfer(from, to, amount);
    }

    function redeem(uint256 amount) external nonReentrant {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.redeem(_msgSender(), address(this), amount);
    }

    function deposit(uint256 amount) external nonReentrant {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.deposit(_msgSender(), address(this), amount);
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

    function _mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal override {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        $.assetRouter.mint(rawPayload, proof);
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal override {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.mintWithFee(
            mintPayload,
            proof,
            feePayload,
            userSignature
        );
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
    function _changeAssetRouter(address newVal) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        address prevValue = address($.assetRouter);
        $.assetRouter = IAssetRouter(newVal);
        emit AssetRouterChanged(prevValue, newVal);
    }

    function _changeRedeemFee(uint256 newVal) internal {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        uint256 prevValue = $.redeemFee;
        $.redeemFee = newVal;
        emit RedeemFeeChanged(prevValue, newVal);
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

    function _getMaxFee() internal view virtual override returns (uint256) {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        uint256 ratio = $.assetRouter.ratio(address(this));
        uint256 maxFee = Math.mulDiv(
            $.assetRouter.maxMintCommission(),
            ratio,
            1 ether,
            Math.Rounding.Ceil
        );
        return maxFee;
    }

    function _getTreasury() internal view virtual override returns (address) {
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        return $.treasury;
    }
}
