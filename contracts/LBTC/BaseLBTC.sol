// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Assert} from "./libraries/Assert.sol";
import {Actions} from "../libs/Actions.sol";
import {RateLimitsV2} from "../libs/RateLimitsV2.sol";

/**
 * @title Abstract bridge adapter
 * @author Lombard.finance
 * @notice Implements basic communication with Bridge contract.
 * Should be extended with business logic of bridging protocols (e.g. CCIP, LayerZero).
 * @dev Shared ERC20 + {AccessControlDefaultAdminRulesUpgradeable}. Role ids (`OPERATOR_ROLE`, etc.) live on each concrete token.
 *      `PAUSER_ROLE` may call `pauseTransfers()` to activate {ERC20Pausable} (blocks transfers and any `_update` including mint/burn).
 *      `MINT_BURN_PAUSER_ROLE` toggles `mintBurnPaused`; concrete contracts attach `whenMintBurnAllowed` to every external path that mints or burns
 *      so ERC20 transfers stay cheap (no guard in `_update`). New supply-changing entrypoints must use that modifier.
 *      `MINTER_ROLE` holders mint through `_mintWithLimit` / `_batchMintWithLimit`; per-minter leaky-bucket limits
 *      are configured with `setMinterLimit`. Proof-mint paths consume the bucket keyed by
 *      `address(this)` at the call site. {AssetRouter} holds `MINTER_ROLE` on its own bucket:
 *      fee collection there uses mint-to-treasury (not transfer) and consumes that bucket without
 *      burns releasing capacity — see {AssetRouter} for redeem blocking and StakedLBTC
 *      `mintWithFee` double-count behaviour Lombard acknowledges as expected.
 *      Use `type(uint96).max` with a short `window` for a practical unlimited cap.
 *      Rate limits are keyed by minter address, not role membership: revoking and re-granting `MINTER_ROLE` does not
 *      reset or clear `minterRateLimits` (intended; `MANAGER_ROLE` must reconfigure or accept prior state).
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

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.BaseLBTC
    struct BaseLBTCStorage {
        /// @dev When true, mint/burn entrypoints that use `whenMintBurnAllowed` revert; ERC20 transfers are unaffected.
        bool mintBurnPaused;
        /// @dev Per-minter rate limit for `MINTER_ROLE` mint entrypoints; keyed by address, survives role revoke/grant.
        mapping(address => RateLimitsV2.Data) minterRateLimits;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BaseLBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BaseLBTCStorageLocation =
        0xb916f9bd559884fff7955a8f87abe9b4ee4ee4202b8eb445cd8f820d3ee19000;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant MINT_BURN_PAUSER_ROLE =
        keccak256("MINT_BURN_PAUSER_ROLE");

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

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

    /// @notice Sets the leaky-bucket mint rate limit for a `MINTER_ROLE` holder or `address(this)` (proof mint).
    /// @dev `limit` = `0` deletes the minter's mapping entry (unset; mints revert until reconfigured).
    ///      Non-zero `limit`: if the new limit is below decayed in-flight, in-flight is capped
    ///      to the new limit so the tighter cap applies immediately (see {RateLimitsV2.setRateLimit}).
    ///      Revoking and re-granting `MINTER_ROLE` for `minter` does not change this limit state.
    ///      When `minter` is {AssetRouter}, size the limit for fee mints on redeem paths and for
    ///      `amount + fee` on StakedLBTC `mintWithFee` (see {AssetRouter}).
    ///      When `minter` is `address(this)`, the bucket is a single PROTOCOL-WIDE proof-mint quota
    ///      shared by ALL permissionless proof mints (and, on NativeLBTC, the `CLAIMER_ROLE` fee
    ///      paths). It is not per-recipient or per-caller: size `limit` for aggregate proof-mint
    ///      throughput across the whole `window` and expect short-window cross-user contention (one
    ///      user's heavy-but-legitimate proof mints can transiently exhaust the bucket and revert
    ///      others' unrelated proof mints with `RateLimitExceeded` until it decays).
    /// @param minter Minter address, or `address(this)` for the proof-mint bucket.
    /// @param config Rate limit configuration (`limit`, `window`).
    /// @custom:access Caller must have `MANAGER_ROLE`
    function setMinterLimit(
        address minter,
        RateLimitsV2.Config memory config
    ) external onlyRole(MANAGER_ROLE) {
        BaseLBTCStorage storage $ = _getBaseLBTCStorage();
        if (config.limit == 0) {
            delete $.minterRateLimits[minter];
            emit MinterLimitSet(minter, 0, 0);
        } else {
            RateLimitsV2.setRateLimit($.minterRateLimits[minter], config);
            emit MinterLimitSet(minter, config.limit, config.window);
        }
    }

    /// @notice Returns rate-limit state for `minter`.
    /// @return limit Configured limit; `0` if unset.
    /// @return window Configured window in seconds; `0` if unset.
    /// @return amountInFlight Decayed in-flight amount at `block.timestamp`.
    /// @return remaining Remaining mint allowance; `0` when unset.
    function getMinterLimit(
        address minter
    )
        external
        view
        returns (
            uint256 limit,
            uint256 window,
            uint256 amountInFlight,
            uint256 remaining
        )
    {
        RateLimitsV2.Data storage rl = _getBaseLBTCStorage().minterRateLimits[
            minter
        ];
        limit = rl.limit;
        window = rl.window;
        (amountInFlight, remaining) = RateLimitsV2.availableAmount(rl);
    }

    function _mintWithLimit(address to, uint256 amount) internal {
        _consumeMinterLimit(_msgSender(), amount);
        _mint(to, amount);
    }

    function _batchMintWithLimit(
        address[] calldata to,
        uint256[] calldata amount
    ) internal {
        Assert.equalLength(to.length, amount.length);

        uint256 totalAmount;
        for (uint256 i; i < amount.length; ++i) {
            totalAmount += amount[i];
        }
        _consumeMinterLimit(_msgSender(), totalAmount);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    function _consumeMinterLimit(address minter, uint256 amount) internal {
        RateLimitsV2.updateLimit(
            _getBaseLBTCStorage().minterRateLimits[minter],
            amount
        );
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
    /// @custom:access Caller must have `MANAGER_ROLE`
    function unpauseMintBurn() external onlyRole(MANAGER_ROLE) {
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
