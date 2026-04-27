// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Assert} from "./libraries/Assert.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title Abstract bridge adapter
 * @author Lombard.finance
 * @notice Implements basic communication with Bridge contract.
 * Should be extended with business logic of bridging protocols (e.g. CCIP, LayerZero).
 * @dev Shared ERC20 + {AccessControlDefaultAdminRulesUpgradeable}. Role ids (`OPERATOR_ROLE`, etc.) live on each concrete token.
 *      `PAUSER_ROLE` may call `pauseTransfers()` to activate {ERC20Pausable} (blocks transfers and any `_update` including mint/burn).
 *      `MINT_BURN_PAUSER_ROLE` toggles `mintBurnPaused`; concrete contracts attach `whenMintBurnAllowed` to every external path that mints or burns
 *      so ERC20 transfers stay cheap (no guard in `_update`). New supply-changing entrypoints must use that modifier.
 *      Concrete contracts must call `__AccessControlDefaultAdminRules_init` in their `initializer` before other inits.
 *      Shared namespaced state for `BaseLBTC` lives in `BaseLBTCStorage`; extend that struct when adding base-level fields.
 * @custom:security-contact legal@lombard.finance
 */
abstract contract BaseLBTC is
    IBaseLBTC,
    AccessControlDefaultAdminRulesUpgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ReentrancyGuardUpgradeable
{
    error MintBurnPaused();
    error MintBurnExpectedPaused();

    event MintBurnPauseChanged(bool paused);

    /// @custom:storage-location erc7201:lombardfinance.storage.BaseLBTC
    struct BaseLBTCStorage {
        /// @dev When true, mint/burn entrypoints that use `whenMintBurnAllowed` revert; ERC20 transfers are unaffected.
        bool mintBurnPaused;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BaseLBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BaseLBTCStorageLocation =
        0xb916f9bd559884fff7955a8f87abe9b4ee4ee4202b8eb445cd8f820d3ee19000;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant MINT_BURN_PAUSER_ROLE =
        keccak256("MINT_BURN_PAUSER_ROLE");

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC20StorageLocation =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.EIP712")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant EIP712StorageLocation =
        0xa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d100;

    /// @notice EIP-712 digest for a fee approval users sign off-chain (`Actions.FEE_APPROVAL_EIP712_ACTION`).
    /// @dev Includes `block.chainid`, `fee`, and `expiry` in the struct hash; uses this contract's EIP-712 domain via `_hashTypedDataV4`.
    /// @param fee Maximum fee the approval allows.
    /// @param expiry Unix timestamp after which the approval is invalid.
    /// @return digest Typed data hash to sign or verify with `EIP712`.
    function getFeeDigest(
        uint256 fee,
        uint256 expiry
    ) external view virtual returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        Actions.FEE_APPROVAL_EIP712_ACTION,
                        block.chainid,
                        fee,
                        expiry
                    )
                )
            );
    }

    function _batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) internal {
        Assert.equalLength(to.length, amount.length);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        ERC20Storage storage $ = _getERC20Storage_();
        $._name = name_;
        $._symbol = symbol_;
        EIP712Storage storage $_ = _getEIP712Storage_();
        $_._name = name_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _getERC20Storage_() private pure returns (ERC20Storage storage $) {
        assembly {
            $.slot := ERC20StorageLocation
        }
    }

    function _getEIP712Storage_()
        private
        pure
        returns (EIP712Storage storage $)
    {
        assembly {
            $.slot := EIP712StorageLocation
        }
    }

    function _getBaseLBTCStorage()
        private
        pure
        returns (BaseLBTCStorage storage $)
    {
        assembly {
            $.slot := BaseLBTCStorageLocation
        }
    }

    /// @notice Whether mint/burn guard is active (ERC20 transfers unaffected).
    /// @return paused True when mint/burn entrypoints are guarded; false when they are allowed.
    function mintBurnPaused() external view returns (bool) {
        return _getBaseLBTCStorage().mintBurnPaused;
    }

    /// @notice Activates mint/burn guard on decorated entrypoints.
    /// @custom:access Caller must have `MINT_BURN_PAUSER_ROLE`
    function pauseMintBurn()
        external
        onlyRole(MINT_BURN_PAUSER_ROLE)
        whenMintBurnAllowed
    {
        BaseLBTCStorage storage $ = _getBaseLBTCStorage();
        $.mintBurnPaused = true;
        emit MintBurnPauseChanged(true);
    }

    /// @notice Clears mint/burn guard.
    /// @custom:access Caller must have `DEFAULT_ADMIN_ROLE`
    function unpauseMintBurn() external onlyRole(DEFAULT_ADMIN_ROLE) {
        BaseLBTCStorage storage $ = _getBaseLBTCStorage();
        if (!$.mintBurnPaused) {
            revert MintBurnExpectedPaused();
        }
        $.mintBurnPaused = false;
        emit MintBurnPauseChanged(false);
    }

    /// @dev Reverts if `mintBurnPaused` is set.
    function _requireMintBurnAllowed() internal view {
        if (_getBaseLBTCStorage().mintBurnPaused) {
            revert MintBurnPaused();
        }
    }

    /// @dev Use on concrete contracts for any external function that can mint or burn. Does not run on `transfer`.
    modifier whenMintBurnAllowed() {
        _requireMintBurnAllowed();
        _;
    }

    /// @notice Activates {ERC20Pausable}: blocks transfers and all balance updates (including mint/burn) until `unpauseTransfers`.
    /// @dev Delegates to `PausableUpgradeable._pause` (uses `whenNotPaused`): reverts with `EnforcedPause` if already paused — no no-op success.
    /// @custom:access Caller must have `PAUSER_ROLE`
    function pauseTransfers() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Clears {ERC20Pausable} pause set by `pauseTransfers`.
    /// @dev Delegates to `PausableUpgradeable._unpause` (uses `whenPaused`): reverts with `ExpectedPause` if not paused — no no-op success.
    /// @custom:access Caller must have `DEFAULT_ADMIN_ROLE`
    function unpauseTransfers() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
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
