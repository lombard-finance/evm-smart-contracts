// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils} from "../libs/BitcoinUtils.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
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
contract StakedLBTC is IStakedLBTC, BaseLBTC {
    using SafeERC20 for IERC20;

    /// @dev the storage name differs, because contract was renamed from LBTC
    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct StakedLBTCStorage {
        /// @dev is keccak256(payload[4:]) used
        /// @custom:oz-renamed-from usedProofs
        mapping(bytes32 => bool) legacyUsedPayloads;
        /// @custom:oz-renamed-from name
        string __removed__name;
        /// @custom:oz-renamed-from symbol
        string __removed__symbol;
        /// @custom:oz-renamed-from isWithdrawalsEnabled
        bool __removed__isWithdrawalsEnabled;
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
        /// @custom:oz-renamed-from burnCommission
        uint256 __removed__dustFeeRate;
        /// Bascule drawbridge used to confirm deposits before allowing withdrawals
        /// @custom:oz-renamed-from bascule
        address __removed__bascule;
        /// @custom:deprecated Superseded by `PAUSER_ROLE`; retained for storage layout. Not updated after `migrateToAccessControl`.
        /// @custom:oz-renamed-from pauser
        address __removed__pauser;
        /// @custom:deprecated Superseded by `MINTER_ROLE`; retained for storage layout.
        /// @custom:oz-renamed-from minters
        mapping(address => bool) __removed__minters;
        /// @custom:deprecated Superseded by `CLAIMER_ROLE`; retained for storage layout.
        /// @custom:oz-renamed-from claimers
        mapping(address => bool) __removed__claimers;
        /// Maximum fee to apply on mints
        /// @custom:oz-renamed-from maximumFee
        uint256 __removed__maximumFee;
        /// @custom:oz-renamed-from usedPayloads
        mapping(bytes32 => bool) __removed__usedPayloads; // sha256(rawPayload) => used
        /// @custom:deprecated Superseded by `OPERATOR_ROLE`; retained for storage layout. Not updated after `migrateToAccessControl`.
        /// @custom:oz-renamed-from operator
        address __removed__operator;
        IAssetRouter assetRouter;
    }

    /// @dev the storage location differs, because contract was renamed from LBTC
    /// keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKED_LBTC_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CLAIMER_ROLE = keccak256("CLAIMER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev Matches OpenZeppelin `OwnableUpgradeable` namespace (pre-migration proxies only).
    /// @custom:storage-location erc7201:openzeppelin.storage.Ownable
    struct LegacyOwnableStorage {
        address _owner;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Ownable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LEGACY_OWNABLE_STORAGE_LOCATION =
        0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// INTIALIZERS ///

    function initialize(
        address consortium_,
        address treasury,
        address initialOwner,
        uint48 initialOwnerDelay
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay, initialOwner);

        __ERC20_init("", "");
        __ERC20Pausable_init();

        __ERC20Permit_init("Lombard Staked Bitcoin"); // TODO: set new name

        __ReentrancyGuard_init();

        __StakedLBTC_init(
            "Lombard Staked Bitcoin", // TODO: set new name
            "LBTC", // TODO: set new symbol
            consortium_,
            treasury
        );
    }

    /**
     * @notice One-time migration for proxies deployed before AccessControl (reinitializer version 3).
     * @param initialAdminDelay Default admin delay (see `AccessControlDefaultAdminRulesUpgradeable`).
     * @param initialDefaultAdmin Must match the legacy `Ownable` owner at upgrade time.
     * @param minters_ Addresses that must have been marked minters in legacy storage; each receives `MINTER_ROLE`.
     * @param claimers_ Same for claimers / `CLAIMER_ROLE`.
     */
    function migrateToAccessControl(
        uint48 initialAdminDelay,
        address initialDefaultAdmin,
        address[] calldata minters_,
        address[] calldata claimers_
    ) external reinitializer(3) {
        address legacy = _legacyOwner();
        if (initialDefaultAdmin != legacy) {
            revert UnauthorizedAccount(initialDefaultAdmin);
        }

        __AccessControlDefaultAdminRules_init(
            initialAdminDelay,
            initialDefaultAdmin
        );

        StakedLBTCStorage storage $ = _getStakedLBTCStorage();

        if ($.__removed__pauser != address(0)) {
            _grantRole(PAUSER_ROLE, $.__removed__pauser);
        }
        if ($.__removed__operator != address(0)) {
            _grantRole(OPERATOR_ROLE, $.__removed__operator);
        }

        uint256 i;
        for (i; i < minters_.length; ) {
            address a = minters_[i];
            if (!$.__removed__minters[a]) {
                revert UnauthorizedAccount(a);
            }
            _grantRole(MINTER_ROLE, a);
            unchecked {
                ++i;
            }
        }
        for (i = 0; i < claimers_.length; ) {
            address a = claimers_[i];
            if (!$.__removed__claimers[a]) {
                revert UnauthorizedAccount(a);
            }
            _grantRole(CLAIMER_ROLE, a);
            unchecked {
                ++i;
            }
        }
    }

    /// ONLY DEFAULT ADMIN FUNCTIONS ///

    function toggleRedeemsForBtc() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStakedLBTCStorage().assetRouter.toggleRedeem();
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

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function changeAssetRouter(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeAssetRouter(newVal);
    }

    function changeRedeemFee(
        uint256 newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeRedeemFee(newVal);
    }

    function changeRedeemForBtcMinAmount(
        uint256 newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeRedeemForBtcMinAmount(newVal);
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
        return
            $.assetRouter.calcUnstakeRequestAmount(
                address(this),
                scriptPubkey,
                amount
            );
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

    function getTreasury() public view override returns (address) {
        return _getStakedLBTCStorage().treasury;
    }

    function toNativeCommission() public view returns (uint64) {
        return
            _getStakedLBTCStorage().assetRouter.toNativeCommission(
                address(this)
            );
    }

    function getRedeemFee() public view returns (uint256) {
        (uint256 redeemFee, , ) = _getStakedLBTCStorage()
            .assetRouter
            .tokenConfig(address(this));
        return redeemFee;
    }

    function getRedeemForBtcMinAmount() public view returns (uint256) {
        (, uint256 redeemForBtcMinAmount, ) = _getStakedLBTCStorage()
            .assetRouter
            .tokenConfig(address(this));
        return redeemForBtcMinAmount;
    }

    /**
     * Get Bascule contract.
     */
    function Bascule() external view returns (address) {
        return address(_getStakedLBTCStorage().assetRouter.bascule());
    }

    function isNative() public pure returns (bool) {
        return false;
    }

    function isRedeemsEnabled() public view override returns (bool) {
        (, , bool isRedeemEnabled) = _getStakedLBTCStorage()
            .assetRouter
            .tokenConfig(address(this));
        return isRedeemEnabled;
    }

    function ratio() external view override returns (uint256) {
        return _getStakedLBTCStorage().assetRouter.ratio(address(this));
    }

    function getRate() external view override returns (uint256) {
        return _getStakedLBTCStorage().assetRouter.getRate(address(this));
    }

    /// USER ACTIONS ///

    /**
     * @notice Mint LBTC to the specified address
     * @param to The address to mint to
     * @param amount The amount of LBTC to mint
     * @dev Only callable by accounts with `MINTER_ROLE`
     */
    function mint(
        address to,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) whenMintBurnAllowed {
        _mint(to, amount);
    }

    /**
     * @notice Mint LBTC in batches
     * @param to The addresses to mint to
     * @param amount The amounts of LBTC to mint
     * @dev Only callable by accounts with `MINTER_ROLE`
     */
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyRole(MINTER_ROLE) whenMintBurnAllowed {
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
    ) external nonReentrant whenMintBurnAllowed returns (address recipient) {
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
    ) external nonReentrant whenMintBurnAllowed {
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
    ) external onlyRole(CLAIMER_ROLE) whenMintBurnAllowed {
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
    ) external onlyRole(CLAIMER_ROLE) whenMintBurnAllowed {
        if (paused()) {
            revert EnforcedPause();
        }
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        if (address($.assetRouter) == address(0)) {
            revert AssetRouterNotSet();
        }
        $.assetRouter.batchMintWithFee(
            mintPayload,
            proof,
            feePayload,
            userSignature
        );
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
    function burn(uint256 amount) external whenMintBurnAllowed {
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
    ) external override onlyRole(MINTER_ROLE) whenMintBurnAllowed {
        _burn(from, amount);
    }

    function redeem(uint256 amount) external nonReentrant whenMintBurnAllowed {
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
        address treasury
    ) internal onlyInitializing {
        _changeNameAndSymbol(name_, symbol_);
        _changeConsortium(consortium_);
        _changeTreasury(treasury);
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal {
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

    function _legacyOwner() private view returns (address) {
        LegacyOwnableStorage storage $ = _getLegacyOwnableStorage();
        return $._owner;
    }

    function _getLegacyOwnableStorage()
        private
        pure
        returns (LegacyOwnableStorage storage $)
    {
        assembly {
            $.slot := LEGACY_OWNABLE_STORAGE_LOCATION
        }
    }

    /// @dev not zero
    function _changeConsortium(address newVal) internal {
        Assert.zeroAddress(newVal);
        StakedLBTCStorage storage $ = _getStakedLBTCStorage();
        emit ConsortiumChanged(address($.consortium), newVal);
        $.consortium = INotaryConsortium(newVal);
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
        _getStakedLBTCStorage().assetRouter.changeRedeemFee(newVal);
    }

    function _changeRedeemForBtcMinAmount(uint256 newVal) internal {
        _getStakedLBTCStorage().assetRouter.changeRedeemForBtcMinAmount(newVal);
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
}
