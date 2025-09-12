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
import {BaseLBTC} from "./BaseLBTC.sol";
import {IBridgeToken} from "../interfaces/IBridgeToken.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

/**
 * @title Adapter between BridgeToken (BTC.b) and AssetRouter
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract BridgeTokenAdapter is
    INativeLBTC,
    AccessControlDefaultAdminRulesUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    NoncesUpgradeable
{
    event BridgeTokenChanged(
        address indexed prevValue,
        address indexed newValue
    );

    /// @custom:storage-location erc7201:lombardfinance.storage.NativeLBTC
    // TODO: calculate
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
        IBridgeToken bridgeToken; // not upgradeable token whiling to adapt
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.NativeLBTC")) - 1)) & ~bytes32(uint256(0xff))
    // TODO: calc
    bytes32 private constant BRIDGE_TOKEN_ADAPTER_STORAGE_LOCATION =
        0xb773c428c0cecc1b857b133b10e11481edd580cedc90e62754fff20b7c0d6000;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
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

    function changeAssetRouter(
        address newVal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeAssetRouter(newVal);
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

    function getFeeDigest(
        uint256 fee,
        uint256 expiry
    ) external view override returns (bytes32) {
        require(false, "not implemented");
        return bytes32(0);
    }

    /**
     * Get Bascule contract.
     */
    function getBascule() external view returns (IBascule) {
        return _getBridgeTokenAdapterStorage().bascule;
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
    ) external override whenNotPaused onlyRole(MINTER_ROLE) {
        // set vout as max(uint256) to make it impossible
        _getBridgeTokenAdapterStorage().bridgeToken.mint(
            to,
            amount,
            address(0),
            0,
            bytes32(0),
            type(uint256).max
        );
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
    ) external whenNotPaused onlyRole(MINTER_ROLE) {
        _batchMint(to, amount);
    }

    function _batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) internal {
        Assert.equalLength(to.length, amount.length);
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();

        for (uint256 i; i < to.length; ++i) {
            // set vout as max(uint256) to make it impossible
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

    /**
     * @notice Mint NativeLBTC by proving DepositV1 payload
     * @param rawPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mintV1(
        bytes calldata rawPayload,
        bytes calldata proof
    ) public nonReentrant whenNotPaused {
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
    ) external {
        Assert.equalLength(payload.length, proof.length);

        for (uint256 i; i < payload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(payload[i]);
            if (_getBridgeTokenAdapterStorage().usedPayloads[payloadHash]) {
                emit BatchMintSkipped(payloadHash, payload[i]);
                continue;
            }

            mintV1(payload[i], proof[i]);
        }
    }

    function burn(uint256 amount) external override whenNotPaused {
        // address(this) should be approved to burn `from`
        _getBridgeTokenAdapterStorage().bridgeToken.burnFrom(
            _msgSender(),
            amount
        );
    }

    /**
     * @dev Allows minters to burn NativeLBTC
     *
     * @param amount Amount of NativeLBTC to burn
     */
    function burn(
        address from,
        uint256 amount
    ) external override whenNotPaused onlyRole(MINTER_ROLE) {
        // address(this) should be approved to burn `from`
        _getBridgeTokenAdapterStorage().bridgeToken.burnFrom(from, amount);
    }

    /// PRIVATE FUNCTIONS ///

    function _mint(bytes calldata rawPayload, bytes calldata proof) internal {
        _mintV1(rawPayload, proof);
    }

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
            reverseTxid(action.txid),
            action.vout
        );

        emit MintProofConsumed(action.recipient, payloadHash, rawPayload);
        return (action.recipient, action.amount);
    }

    function reverseTxid(bytes32 txid) internal pure returns (bytes32) {
        bytes memory txidbytes = bytes.concat(txid);
        bytes memory reversed = new bytes(32);
        unchecked {
            for (uint256 i; i < txidbytes.length; i++) {
                reversed[i] = txidbytes[txidbytes.length - i - 1];
            }
        }

        return bytes32(reversed);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param $ NativeLBTC storage.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
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

    /// @dev not zero
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

    function _getTreasury() internal view virtual returns (address) {
        BridgeTokenAdapterStorage storage $ = _getBridgeTokenAdapterStorage();
        return $.treasury;
    }
}
