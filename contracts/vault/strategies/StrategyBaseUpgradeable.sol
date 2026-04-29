// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";

/// @title StrategyBaseUpgradeable
/// @notice Shared validator-gated `exec` for Strategy and SatelliteStrategy.
/// @dev Validator lives in ERC-7201 namespaced storage (`StrategyBaseStorage`); one implementation
/// can serve many BeaconProxy instances. Values are set once in `initializer` and never changed.
abstract contract StrategyBaseUpgradeable is
    IStrategy,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.StrategyBaseUpgradeable
    struct StrategyBaseStorage {
        IStrategyExecValidator validator;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StrategyBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STRATEGY_BASE_STORAGE_LOCATION =
        0xfed51ddfcaefd85c8bb60b3d58b2af0fe77f5875ff8dd3a36da477495c45c700;

    bytes32 public constant PRIVILEGED_EXECUTOR_ROLE = keccak256("PRIVILEGED_EXECUTOR_ROLE");

    /// @return The configured policy validator.
    function validator() external view returns (IStrategyExecValidator) {
        return _getStrategyBaseStorage().validator;
    }

    /// @notice Validator-governed external call.
    /// @param validatorArgs Encoding is defined by the configured `IStrategyExecValidator` (e.g. Merkle `CallVerificationInput`).
    /// @dev ETH: requires `address(this).balance >= value` after receiving `msg.value`.
    function exec(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external payable nonReentrant {
        address sender = _msgSender();
        if (
            !_getStrategyBaseStorage().validator.isAllowed(
                sender,
                to,
                value,
                data,
                validatorArgs
            )
        ) {
            revert Strategy_CallNotAllowed();
        }

        if (address(this).balance < value) revert Strategy_InvalidEthFunding();

        (bool success, bytes memory returndata) = payable(to).call{
            value: value
        }(data);
        Address.verifyCallResult(success, returndata);

        emit Executed(sender, to, value, data);
    }

    /// @notice Validator-bypassing external call for privileged executors (`PRIVILEGED_EXECUTOR_ROLE`).
    /// @dev Skips `IStrategyExecValidator`; all other safety checks (reentrancy, ETH balance) still apply.
    function exec(
        address to,
        uint256 value,
        bytes calldata data
    ) external payable nonReentrant onlyRole(PRIVILEGED_EXECUTOR_ROLE) {
        if (address(this).balance < value) revert Strategy_InvalidEthFunding();

        (bool success, bytes memory returndata) = payable(to).call{
            value: value
        }(data);
        Address.verifyCallResult(success, returndata);

        emit Executed(_msgSender(), to, value, data);
    }

    /// @dev Shared initializer fragment; call from concrete `initialize`.
    function __StrategyBase_init(
        IStrategyExecValidator validator_,
        address defaultAdmin_
    ) internal onlyInitializing {
        if (address(validator_) == address(0) || defaultAdmin_ == address(0)) {
            revert Strategy_ZeroAddress();
        }
        __ReentrancyGuard_init();
        __AccessControl_init();
        _getStrategyBaseStorage().validator = validator_;
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
    }

    function _getStrategyBaseStorage()
        private
        pure
        returns (StrategyBaseStorage storage $)
    {
        assembly {
            $.slot := STRATEGY_BASE_STORAGE_LOCATION
        }
    }
}
