// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {INativeLBTC} from "./interfaces/INativeLBTC.sol";
import {INotaryConsortium} from "../consortium/INotaryConsortium.sol";
import {IAssetRouter} from "./interfaces/IAssetRouter.sol";
import {Actions} from "../libs/Actions.sol";
import {Assert} from "./libraries/Assert.sol";
import {IBridgeToken} from "../interfaces/IBridgeToken.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BridgeToken adapter for AssetRouter
/// @author Lombard.Finance
/// @notice This contract is part of the Lombard.Finance protocol.
/// @custom:security-contact legal@lombard.finance
contract BridgeTokenAdapter is
    INativeLBTC,
    AccessControlDefaultAdminRulesUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    event BridgeTokenChanged(
        address indexed prevValue,
        address indexed newValue
    );

    error InvalidRecipient(address expected, address actual);

    /// @custom:storage-location erc7201:lombardfinance.storage.BridgeTokenAdapter
    struct BridgeTokenAdapterStorage {
        // slot: 20 + 8 + 1 | 29/32
        INotaryConsortium consortium;
        // slot: 20 | 20/32
        address treasury;
        // slot: 20 | 20/32
        IBascule bascule;
        // other slots by 32
        mapping(bytes32 => bool) usedPayloads; // sha256(rawPayload) => used
        IAssetRouter assetRouter;
        IBridgeToken bridgeToken; // the token to adapt
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BridgeTokenAdapter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_TOKEN_ADAPTER_STORAGE_LOCATION =
        0x12da876cd9d34462e8cb4fac06f079885ba1e4376e1cdc9acc16182cfc348a00;

    /// @notice The pauser role may pause the contract.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice The minter role is able to mint new tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// INTIALIZERS ///

    function initialize(
        address consortium,
        address treasury,
        address initialOwner,
        uint48 initialOwnerDelay,
        address bridgeToken
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay, initialOwner);
        __ReentrancyGuard_init();
        __BridgeTokenAdapter_init(bridgeToken, consortium, treasury);
        __Pausable_init();
    }

    function __BridgeTokenAdapter_init(
        address bridgeToken,
        address consortium,
        address treasury
    ) internal onlyInitializing {
        _changeConsortium(consortium);
        _changeTreasury(treasury);
        _changeBridgeToken(bridgeToken);
    }

    /// ONLY OWNER FUNCTIONS ///

    /// @notice Change the trusted consortium
    /// @custom:access Caller must have DEFAULT_ADMIN_ROLE
    function changeConsortium(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeConsortium(newVal);
    }

    /// @notice Change the treasury address
    /// @custom:access Caller must have DEFAULT_ADMIN_ROLE
    function changeTreasuryAddress(
        address newValue
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeTreasury(newValue);
    }

    /// @notice Pause contract
    /// @dev Each non owner method should be paused
    /// @custom:access Caller must have PAUSER_ROLE
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause contract
    /// @custom:access Caller must have DEFAULT_ADMIN_ROLE
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Change the address of the Bascule drawbridge contract.
    /// @dev Setting the address to 0 disables the Bascule check.
    /// @param newVal The new address.
    /// @custom:events Emits a [BasculeChanged] event.
    /// @custom:access Caller must have DEFAULT_ADMIN_ROLE
    function changeBascule(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeBascule(newVal);
    }

    /// @notice Change the address of [AssetRouter] contract.
    /// @param newVal The new address.
    /// @custom:events Emits a [AssetRouterChanged] event.
    /// @custom:access Caller must have DEFAULT_ADMIN_ROLE
    function changeAssetRouter(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeAssetRouter(newVal);
    }

    /// @dev mainly used for migration testing, remove later
    function changeBridgeToken(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeBridgeToken(newVal);
    }

    /// GETTERS ///

    function getConsortium() external view virtual returns (INotaryConsortium) {
        return _getBridgeTokenAdapterStorage().consortium;
    }

    function getAssetRouter() external view override returns (address) {
        return address(_getBridgeTokenAdapterStorage().assetRouter);
    }

    function isNative() public pure returns (bool) {
        return true;
    }

    function isRedeemsEnabled() public view override returns (bool) {
        (, , bool isRedeemEnabled) = _getBridgeTokenAdapterStorage()
            .assetRouter
            .tokenConfig(address(this));
        return isRedeemEnabled;
    }

    function getTreasury() public view override returns (address) {
        return _getBridgeTokenAdapterStorage().treasury;
    }

    function getRedeemFee() public view returns (uint256) {
        (uint256 redeemFee, , ) = _getBridgeTokenAdapterStorage()
            .assetRouter
            .tokenConfig(address(this));
        return redeemFee;
    }

    /// @dev Not implemented
    function getFeeDigest(
        uint256,
        uint256
    ) external view override returns (bytes32) {
        revert();
    }

    /// @notice Get Bascule contract.
    function getBascule() external view returns (IBascule) {
        return _getBridgeTokenAdapterStorage().bascule;
    }

    /// USER ACTIONS ///

    /// @notice Mint NativeLBTC to the specified address
    /// @param to The address to mint to
    /// @param amount The amount of NativeLBTC to mint
    /// @custom:access The caller must have MINTER_ROLE
    function mint(
        address to,
        uint256 amount
    ) external override whenNotPaused onlyRole(MINTER_ROLE) nonReentrant {
        // the mint can be not backed by Bitcoin deposit
        // set vout as dummy `type(uint256).max` to make it impossible on Bitcoin network
        // could help to filter out such events
        _getBridgeTokenAdapterStorage().bridgeToken.mint(
            to,
            amount,
            address(0),
            0,
            bytes32(0),
            type(uint256).max
        );
    }

    /// @notice Mint NativeLBTC in batches
    /// @param to The addresses to mint to
    /// @param amount The amounts of NativeLBTC to mint
    /// @custom:access The caller must have MINTER_ROLE
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyRole(MINTER_ROLE) nonReentrant {
        _batchMint(to, amount);
    }

    function _batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) internal whenNotPaused {
        Assert.equalLength(to.length, amount.length);
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();

        for (uint256 i; i < to.length; ++i) {
            // the mint can be not backed by Bitcoin deposit
            // set vout as dummy `type(uint256).max` to make it impossible on Bitcoin network
            // could help to filter out such events
            $.bridgeToken.mint(
                to[i],
                amount[i],
                address(0),
                0,
                bytes32(0),
                type(uint256).max
            );
        }
    }

    /// @notice Mint NativeLBTC by proving DepositV1 payload
    /// @param rawPayload The message with the stake data
    /// @param proof Signature of the consortium approving the mint
    function mintV1(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external nonReentrant {
        _mintV1(rawPayload, proof);
    }

    /// @notice Mint NativeLBTC in batches by DepositV1 payloads
    /// @param payload The messages with the stake data
    /// @param proof Signatures of the consortium approving the mints
    function batchMintV1(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external nonReentrant {
        Assert.equalLength(payload.length, proof.length);

        for (uint256 i; i < payload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(payload[i]);
            if (_getBridgeTokenAdapterStorage().usedPayloads[payloadHash]) {
                emit BatchMintSkipped(payloadHash, payload[i]);
                continue;
            }

            _mintV1(payload[i], proof[i]);
        }
    }

    /// TODO: remove after used
    /// @dev Allows to skip minting if recipient is address(this)
    /// @notice accept Btc deposited to adapter, but not mint
    function spendDeposit(
        bytes calldata payload,
        bytes calldata proof
    ) external {
        Assert.selector(payload, Actions.DEPOSIT_BTC_ACTION_V1);
        Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
            payload[4:]
        );
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();

        bytes32 payloadHash = sha256(payload);
        if ($.usedPayloads[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        $.consortium.checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        if (action.recipient != address(this)) {
            revert InvalidRecipient(address(this), action.recipient);
        }

        emit MintProofConsumed(action.recipient, payloadHash, payload);
    }

    /// @dev Implements [transferFrom] to mimic ERC20 token behaviour. Expose to caller ability to spend [BridgeToken] allowed to the adapter.
    /// @custom:access The caller mush have MINTER_ROLE.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external whenNotPaused onlyRole(MINTER_ROLE) {
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        SafeERC20.safeTransferFrom($.bridgeToken, from, address(this), amount);
        SafeERC20.safeTransfer($.bridgeToken, to, amount);
    }

    /// @dev Implements [burn] to mimic IBaseLBTC token interface. Expose to caller ability to burn [BridgeToken] allowed to the adapter.
    /// @custom:access The caller mush have MINTER_ROLE.
    function burn(
        uint256 amount
    ) external override whenNotPaused onlyRole(MINTER_ROLE) {
        // address(this) should be approved to burn `from`
        _getBridgeTokenAdapterStorage().bridgeToken.burnFrom(
            _msgSender(),
            amount
        );
    }

    /// @dev Implements [burn] to mimic IBaseLBTC token interface. Expose to caller ability to burn [BridgeToken] allowed to the adapter.
    /// @custom:access The caller mush have MINTER_ROLE.
    function burn(
        address from,
        uint256 amount
    ) external override whenNotPaused onlyRole(MINTER_ROLE) {
        // address(this) should be approved to burn `from`
        _getBridgeTokenAdapterStorage().bridgeToken.burnFrom(from, amount);
    }

    /// PRIVATE FUNCTIONS ///

    /// @notice Mint using payload
    function _mintV1(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal whenNotPaused returns (address, uint256) {
        Assert.selector(rawPayload, Actions.DEPOSIT_BTC_ACTION_V1);
        Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
            rawPayload[4:]
        );
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();

        /// make sure that hash of payload not used before
        /// need to check sha256 hash from payload without selector
        bytes32 payloadHash = sha256(rawPayload);
        bytes32 legacyHash = keccak256(rawPayload[4:]); // TODO: remove when bascule support sha256
        if ($.usedPayloads[payloadHash]) {
            revert PayloadAlreadyUsed();
        }
        $.consortium.checkProof(payloadHash, proof);
        $.usedPayloads[payloadHash] = true;

        // Confirm deposit against Bascule
        _confirmDeposit($, legacyHash, action.amount);

        // Actually mint
        $.bridgeToken.mint(
            action.recipient,
            action.amount,
            address(0),
            0,
            /// payload has not reversed txid (core representation), reverse to make it compatible with explorer
            reverseBytes32(action.txid),
            action.vout
        );

        emit MintProofConsumed(action.recipient, payloadHash, rawPayload);
        return (action.recipient, action.amount);
    }

    /// @notice          Changes the endianness of a bytes32
    /// @dev             https://graphics.stanford.edu/~seander/bithacks.html#ReverseParallel
    /// @param _b        The bytes32 to reverse
    /// @return v        The reversed value
    function reverseBytes32(bytes32 _b) internal pure returns (bytes32 v) {
        v = _b;

        // swap bytes
        v =
            ((v >> 8) &
                0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF) |
            ((v &
                0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF) <<
                8);
        // swap 2-byte long pairs
        v =
            ((v >> 16) &
                0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF) |
            ((v &
                0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF) <<
                16);
        // swap 4-byte long pairs
        v =
            ((v >> 32) &
                0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF) |
            ((v &
                0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF) <<
                32);
        // swap 8-byte long pairs
        v =
            ((v >> 64) &
                0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF) |
            ((v &
                0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF) <<
                64);
        // swap 16-byte long pairs
        v = (v >> 128) | (v << 128);
    }

    /// @dev Checks that the deposit was validated by the Bascule drawbridge.
    /// @param $ NativeLBTC storage.
    /// @param depositID The unique ID of the deposit.
    /// @param amount The withdrawal amount.
    function _confirmDeposit(
        BridgeTokenAdapterStorage storage $,
        bytes32 depositID,
        uint256 amount
    ) internal {
        IBascule bascule = $.bascule;
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
        }
    }

    /// @dev `consortium` not zero
    function _changeConsortium(address newVal) internal {
        Assert.zeroAddress(newVal);
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        emit ConsortiumChanged(address($.consortium), newVal);
        $.consortium = INotaryConsortium(newVal);
    }

    function _changeBascule(address newVal) internal {
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        emit BasculeChanged(address($.bascule), newVal);
        $.bascule = IBascule(newVal);
    }

    /// @dev `treasury` not zero
    function _changeTreasury(address newValue) internal {
        Assert.zeroAddress(newValue);
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }

    /// @dev `treasury` not zero
    function _changeBridgeToken(address newValue) internal {
        Assert.zeroAddress(newValue);
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        address prevValue = address($.bridgeToken);
        $.bridgeToken = IBridgeToken(newValue);
        emit BridgeTokenChanged(prevValue, newValue);
    }

    /// @dev allow zero address to disable Stakings
    function _changeAssetRouter(address newVal) internal {
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        address prevValue = address($.assetRouter);
        $.assetRouter = IAssetRouter(newVal);
        emit AssetRouterChanged(prevValue, newVal);
    }

    function _getBridgeTokenAdapterStorage()
        private
        pure
        returns (BridgeTokenAdapterStorage storage $)
    {
        assembly {
            $.slot := BRIDGE_TOKEN_ADAPTER_STORAGE_LOCATION
        }
    }
}
