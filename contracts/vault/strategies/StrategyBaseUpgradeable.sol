// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";

/// @title StrategyBaseUpgradeable
/// @notice Shared validator-gated `exec` for Strategy and SatelliteStrategy (`docs/spec/002-strategy.md`).
/// @dev Validator lives in ERC-7201 namespaced storage (`StrategyBaseStorage`); one implementation
/// can serve many BeaconProxy instances. Values are set once in `initializer` and never changed.
abstract contract StrategyBaseUpgradeable is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @custom:storage-location erc7201:lombardfinance.storage.StrategyBaseUpgradeable
    struct StrategyBaseStorage {
        /// @notice Policy validator (`docs/spec/002-strategy.md` §A.2).
        IStrategyExecValidator validator;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StrategyBaseUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STRATEGY_BASE_STORAGE_LOCATION =
        0xfed51ddfcaefd85c8bb60b3d58b2af0fe77f5875ff8dd3a36da477495c45c700;

    /// @dev Validator rejected `exec` for `(msg.sender, to, value, data, input)`.
    error CallNotAllowed();

    /// @dev Contract ETH balance (including `msg.value` on this call) is less than `value`.
    error InvalidEthFunding();

    error ZeroAddress();

    event Executed(
        address indexed caller,
        address indexed to,
        uint256 value,
        bytes data
    );

    /// @return The configured policy validator.
    function validator() external view returns (IStrategyExecValidator) {
        return _getStrategyBaseStorage().validator;
    }

    /// @notice Validator-governed external call (`docs/spec/002-strategy.md` §A.2).
    /// @param validatorArgs Encoding is defined by the configured `IStrategyExecValidator` (e.g. Merkle `CallVerificationInput`).
    /// @dev ETH: requires `address(this).balance >= value` after receiving `msg.value`.
    function exec(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external payable nonReentrant {
        if (
            !_getStrategyBaseStorage().validator.isAllowed(
                msg.sender,
                to,
                value,
                data,
                validatorArgs
            )
        ) {
            revert CallNotAllowed();
        }

        if (address(this).balance < value) revert InvalidEthFunding();

        (bool success, bytes memory returndata) = payable(to).call{
            value: value
        }(data);
        Address.verifyCallResult(success, returndata);

        emit Executed(msg.sender, to, value, data);
    }

    /// @dev Shared initializer fragment; call from concrete `initialize`.
    function __StrategyBase_init(
        IStrategyExecValidator validator_,
        address defaultAdmin_
    ) internal onlyInitializing {
        if (address(validator_) == address(0) || defaultAdmin_ == address(0)) {
            revert ZeroAddress();
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
