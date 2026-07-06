// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IShardExecValidator} from "../interfaces/IShardExecValidator.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {ShardBaseUpgradeable} from "./ShardBaseUpgradeable.sol";

/// @title Shard
/// @notice Strategy-linked shard with funding pipe and validator-governed `exec`.
/// @custom:security-contact security@lombard.finance
contract Shard is ShardBaseUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Role required for `pullFromStrategy` / `pushToStrategy`.
    bytes32 public constant SHARD_TRANSFER_ROLE =
        keccak256("SHARD_TRANSFER_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.Shard
    struct ShardStorage {
        IStrategy strategy;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Shard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SHARD_STORAGE_LOCATION =
        0x97c82c2e2872db3d07cb4a7237a90d1f4284c8fb256545e02923dbbc52c8d900;

    /// @notice Liquidity role pulled `amount` of `token` from the strategy via `requestFunding`.
    event PulledFromStrategy(
        address indexed caller,
        address indexed token,
        uint256 amount
    );

    /// @notice Liquidity role pushed `amount` of `token` into the strategy balance.
    event PushedToStrategy(
        address indexed caller,
        address indexed token,
        uint256 amount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @return The configured strategy.
    function strategy() external view returns (IStrategy) {
        return _getShardStorage().strategy;
    }

    /// @param strategy_ Strategy address; stored once in ERC-7201 `ShardStorage` (beacon-safe).
    /// @param validator_ Policy validator (`IShardExecValidator`).
    /// @param defaultAdmin_ Receives `DEFAULT_ADMIN_ROLE`.
    /// @param shardTransferer Receives `SHARD_TRANSFER_ROLE` for `pullFromStrategy` / `pushToStrategy`.
    function initialize(
        IStrategy strategy_,
        IShardExecValidator validator_,
        address defaultAdmin_,
        address shardTransferer
    ) external initializer {
        if (address(strategy_) == address(0) || shardTransferer == address(0)) {
            revert Shard_ZeroAddress();
        }
        __ShardBase_init(validator_, defaultAdmin_);
        _getShardStorage().strategy = strategy_;
        _grantRole(SHARD_TRANSFER_ROLE, shardTransferer);
    }

    /// @notice Pull `token` from the strategy via `requestFunding`.
    function pullFromStrategy(
        IERC20 token,
        uint256 amount
    ) external onlyRole(SHARD_TRANSFER_ROLE) {
        _getShardStorage().strategy.requestFunding(token, amount);
        emit PulledFromStrategy(_msgSender(), address(token), amount);
    }

    /// @notice Push `token` to the strategy. Any ERC-20 token is accepted; callers are expected to pass `strategy.asset()` in normal operation.
    function pushToStrategy(
        IERC20 token,
        uint256 amount
    ) external onlyRole(SHARD_TRANSFER_ROLE) {
        token.safeTransfer(address(_getShardStorage().strategy), amount);
        emit PushedToStrategy(_msgSender(), address(token), amount);
    }

    function _getShardStorage() private pure returns (ShardStorage storage $) {
        assembly {
            $.slot := SHARD_STORAGE_LOCATION
        }
    }
}
