// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";
import {IVault} from "./../interfaces/IVault.sol";
import {StrategyBaseUpgradeable} from "./StrategyBaseUpgradeable.sol";

/// @title Strategy
/// @notice Vault-linked strategy: §B pipe + validator-governed `exec` (`docs/spec/002-strategy.md` §B).
contract Strategy is StrategyBaseUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Role required for `pullFromVault` / `pushToVault` (`docs/spec/002-strategy.md` §B).
    bytes32 public constant VAULT_TOKEN_LIQUIDITY_ROLE =
        keccak256("VAULT_TOKEN_LIQUIDITY_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.Strategy
    struct StrategyStorage {
        IVault vault;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Strategy")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STRATEGY_STORAGE_LOCATION =
        0x90ec6e70d08ce3f865147ce41c466c2b0486ac747f5e826cd1470c21d9390900;

    event PulledFromVault(uint256 amount);
    event PushedToVault(uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @return The configured vault.
    function vault() external view returns (IVault) {
        return _getStrategyStorage().vault;
    }

    /// @param vault_ §B vault; stored once in ERC-7201 `StrategyStorage` (beacon-safe).
    /// @param validator_ Policy validator (`IStrategyExecValidator`).
    /// @param defaultAdmin_ Receives `DEFAULT_ADMIN_ROLE`.
    /// @param liquidityRoleHolder Receives `VAULT_TOKEN_LIQUIDITY_ROLE` for `pullFromVault` / `pushToVault`.
    function initialize(
        IVault vault_,
        IStrategyExecValidator validator_,
        address defaultAdmin_,
        address liquidityRoleHolder
    ) external initializer {
        if (
            address(vault_) == address(0) || liquidityRoleHolder == address(0)
        ) {
            revert Strategy_ZeroAddress();
        }
        __StrategyBase_init(validator_, defaultAdmin_);
        _getStrategyStorage().vault = vault_;
        _grantRole(VAULT_TOKEN_LIQUIDITY_ROLE, liquidityRoleHolder);
    }

    /// @notice Pull `IERC20(vault.asset())` from the vault via allowance from `registerStrategy` (`docs/spec/002-strategy.md` §B).
    function pullFromVault(
        uint256 amount
    ) external onlyRole(VAULT_TOKEN_LIQUIDITY_ROLE) {
        IVault v = _getStrategyStorage().vault;
        // TODO: fix after vault update
        // IERC20(v.asset()).safeTransferFrom(address(v), address(this), amount);
        emit PulledFromVault(amount);
    }

    /// @notice Push `IERC20(vault.asset())` to the vault (`docs/spec/002-strategy.md` §B).
    function pushToVault(
        uint256 amount
    ) external onlyRole(VAULT_TOKEN_LIQUIDITY_ROLE) {
        IVault v = _getStrategyStorage().vault;
        // TODO: fix after vault update
        // IERC20(v.asset()).safeTransfer(address(v), amount);
        emit PushedToVault(amount);
    }

    function _getStrategyStorage()
        private
        pure
        returns (StrategyStorage storage $)
    {
        assembly {
            $.slot := STRATEGY_STORAGE_LOCATION
        }
    }
}
