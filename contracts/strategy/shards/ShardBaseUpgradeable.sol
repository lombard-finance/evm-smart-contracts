// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IShardExecValidator} from "../interfaces/IShardExecValidator.sol";
import {IShard} from "../interfaces/IShard.sol";

/// @title ShardBaseUpgradeable
/// @notice Shared validator-gated `exec` for Shard and RemoteShard.
/// @dev Validator lives in ERC-7201 namespaced storage (`ShardBaseStorage`); one implementation
/// can serve many BeaconProxy instances. Values are set once in `initializer` and never changed.
/// Plain ETH may be received via {receive} to build balance for `exec` forwards; `msg.value` on `exec` also credits the contract.
abstract contract ShardBaseUpgradeable is
    IShard,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.ShardBaseUpgradeable
    struct ShardBaseStorage {
        IShardExecValidator validator;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.ShardBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant SHARD_BASE_STORAGE_LOCATION =
        0x0630e0afc59061c4f1e2cb6df01459cd5ec6182c4a389a98e28fac40af6bc500;

    bytes32 public constant PRIVILEGED_EXECUTOR_ROLE =
        keccak256("PRIVILEGED_EXECUTOR_ROLE");

    /// @return The configured policy validator.
    function validator() external view returns (IShardExecValidator) {
        return _getShardBaseStorage().validator;
    }

    /// @notice Replace the exec validator. Only `DEFAULT_ADMIN_ROLE`.
    function setValidator(
        IShardExecValidator newValidator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(newValidator) == address(0)) revert Shard_ZeroAddress();
        IShardExecValidator old = _getShardBaseStorage().validator;
        _getShardBaseStorage().validator = newValidator;
        emit ValidatorUpdated(old, newValidator);
    }

    /// @notice Validator-governed external call.
    /// @param validatorArgs Encoding is defined by the configured `IShardExecValidator` (e.g. Merkle `CallVerificationInput`).
    /// @dev ETH: requires `address(this).balance >= value` after receiving `msg.value`.
    ///      `to` cannot be this contract; admin changes use dedicated flows, not `exec` self-calls.
    function exec(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external payable nonReentrant returns (bytes memory) {
        if (to == address(this)) revert Shard_ExecToSelfNotAllowed();

        address sender = _msgSender();
        if (
            !_getShardBaseStorage().validator.isAllowed(
                sender,
                to,
                value,
                data,
                validatorArgs
            )
        ) {
            revert Shard_CallNotAllowed();
        }

        if (address(this).balance < value) revert Shard_InvalidEthFunding();

        (bool success, bytes memory returndata) = payable(to).call{
            value: value
        }(data);
        Address.verifyCallResult(success, returndata);

        emit Executed(sender, to, value, data);
        return returndata;
    }

    /// @notice Validator-bypassing external call for privileged executors (`PRIVILEGED_EXECUTOR_ROLE`).
    /// @dev Skips `IShardExecValidator`; all other safety checks (reentrancy, ETH balance) still apply.
    ///      `to` cannot be this contract; same restriction as the validator-gated overload.
    function exec(
        address to,
        uint256 value,
        bytes calldata data
    )
        external
        payable
        nonReentrant
        onlyRole(PRIVILEGED_EXECUTOR_ROLE)
        returns (bytes memory)
    {
        if (to == address(this)) revert Shard_ExecToSelfNotAllowed();

        if (address(this).balance < value) revert Shard_InvalidEthFunding();

        (bool success, bytes memory returndata) = payable(to).call{
            value: value
        }(data);
        Address.verifyCallResult(success, returndata);

        emit Executed(_msgSender(), to, value, data);
        return returndata;
    }

    /// @notice Accepts plain ETH transfers (no calldata) so the shard balance can be pre-funded for `exec`.
    receive() external payable {
        emit EthReceived(msg.sender, msg.value);
    }

    /// @dev Shared initializer fragment; call from concrete `initialize`.
    function __ShardBase_init(
        IShardExecValidator validator_,
        address defaultAdmin_
    ) internal onlyInitializing {
        if (address(validator_) == address(0) || defaultAdmin_ == address(0)) {
            revert Shard_ZeroAddress();
        }
        __ReentrancyGuard_init();
        __AccessControl_init();
        _getShardBaseStorage().validator = validator_;
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
    }

    function _getShardBaseStorage()
        private
        pure
        returns (ShardBaseStorage storage $)
    {
        assembly {
            $.slot := SHARD_BASE_STORAGE_LOCATION
        }
    }
}
