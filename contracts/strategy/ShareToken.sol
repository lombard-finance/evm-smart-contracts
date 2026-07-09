// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseLBTC} from "../LBTC/BaseLBTC.sol";
import {IBaseLBTC} from "../LBTC/interfaces/IBaseLBTC.sol";

/**
 * @title Strategy share token (ERC20)
 * @author Lombard.Finance
 * @notice Minimal ERC20 share token for strategy vaults; reuses {BaseLBTC} for roles,
 *         rate limits, pause, and permit without Lombard BTC bridge/redeem surfaces.
 * @dev Inherits {BaseLBTC} / {IBaseLBTC} for shared mint/burn infrastructure. Several
 *      {IBaseLBTC} getters exist only on Lombard BTC tokens ({NativeLBTC}, {StakedLBTC},
 *      {BridgeTokenAdapter}) and are still required on {ShareToken} because the base type
 *      implements the full interface. Those getters revert with {LbtcFeatureNotSupported}
 *      instead of returning sentinel values so integrators cannot misread them as valid state.
 * @custom:security-contact security@lombard.finance
 */
contract ShareToken is BaseLBTC {
    /// @dev Raised when a caller invokes an {IBaseLBTC} getter that applies to Lombard BTC
    ///      tokens but not to strategy share tokens. {ShareToken} does not participate in
    ///      {AssetRouter} wiring, treasury fee collection, or BTC redeem flows.
    error LbtcFeatureNotSupported();

    /// @custom:storage-location erc7201:lombardfinance.storage.ShareToken
    struct ShareTokenStorage {
        uint8 decimals;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.ShareToken")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SHARE_TOKEN_STORAGE_LOCATION =
        0x93930c3a8d0bcac1539d1b8c6b0db66ea6a4a770e7037f2aaaab8672b3cb4f00;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// INITIALIZERS ///

    function initialize(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address initialOwner,
        uint48 initialOwnerDelay
    ) external initializer {
        __AccessControlDefaultAdminRules_init(initialOwnerDelay, initialOwner);

        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();
        __ERC20Permit_init(name_);

        __ReentrancyGuard_init();

        _getShareTokenStorage().decimals = decimals_;
    }

    /// ONLY OWNER FUNCTIONS ///

    function changeNameAndSymbol(
        string calldata name_,
        string calldata symbol_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _changeNameAndSymbol(name_, symbol_);
    }

    /// GETTERS ///

    /// @notice Token decimals for user-facing amounts.
    function decimals() public view virtual override returns (uint8) {
        return _getShareTokenStorage().decimals;
    }

    /// @inheritdoc IBaseLBTC
    /// @notice Reverts. Share tokens are not wired to {AssetRouter}.
    function getAssetRouter() external pure override returns (address) {
        revert LbtcFeatureNotSupported();
    }

    /// @inheritdoc IBaseLBTC
    /// @notice Reverts. Share tokens are not Lombard BTC native or staked assets.
    function isNative() external pure override returns (bool) {
        revert LbtcFeatureNotSupported();
    }

    /// @inheritdoc IBaseLBTC
    /// @notice Reverts. Share tokens do not support BTC redeem flows.
    function isRedeemsEnabled() external pure override returns (bool) {
        revert LbtcFeatureNotSupported();
    }

    /// @inheritdoc IBaseLBTC
    /// @notice Reverts. Share tokens have no protocol treasury address.
    function getTreasury() external pure override returns (address) {
        revert LbtcFeatureNotSupported();
    }

    /// @inheritdoc IBaseLBTC
    /// @notice Reverts. Share tokens do not charge Lombard BTC redeem fees.
    function getRedeemFee() external pure override returns (uint256) {
        revert LbtcFeatureNotSupported();
    }

    /// USER ACTIONS ///

    /**
     * @notice Mint ShareToken to the specified address
     * @param to The address to mint to
     * @param amount The amount of ShareToken to mint
     * @dev Only callable by whitelisted minters
     */
    function mint(
        address to,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) whenMintBurnAllowed {
        _mintWithLimit(to, amount);
    }

    /**
     * @notice Mint ShareToken in batches
     * @param to The addresses to mint to
     * @param amount The amounts of ShareToken to mint
     * @dev Only callable by whitelisted minters
     */
    function batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) external onlyRole(MINTER_ROLE) whenMintBurnAllowed {
        _batchMintWithLimit(to, amount);
    }

    /// @notice Burns caller's ShareToken balance.
    /// @param amount Amount of ShareToken to burn from `msg.sender`.
    function burn(uint256 amount) external whenMintBurnAllowed {
        _burn(_msgSender(), amount);
    }

    /// @notice Burns ShareToken from an arbitrary holder; minter-only.
    /// @param from Account whose ShareToken balance is burned.
    /// @param amount Amount of ShareToken to burn.
    function burn(
        address from,
        uint256 amount
    ) external override onlyRole(MINTER_ROLE) whenMintBurnAllowed {
        _burn(from, amount);
    }

    /// PRIVATE FUNCTIONS ///

    function _getShareTokenStorage()
        private
        pure
        returns (ShareTokenStorage storage $)
    {
        assembly {
            $.slot := SHARE_TOKEN_STORAGE_LOCATION
        }
    }
}
