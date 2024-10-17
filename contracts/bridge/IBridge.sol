// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBridge {
    /// @notice Emitted when the destination is unknown.
    error UnknownDestination();

    /// @notice Emitted when the zero address is used.
    error ZeroAddress();

    /// @notice Emitted when the destination is already known.
    error KnownDestination();

    /// @notice Emitted when the commission is invalid.
    error BadCommission();

    /// @notice Emitted when the zero contract hash is used.
    error ZeroContractHash();

    /// @notice Emitted when the chain id is invalid.
    error ZeroChainId();

    /// @notice Emitted when the destination is not valid.
    error NotValidDestination();

    /// @notice Emitted when there is no enough value to pay relative fee
    error AmountTooSmallToPayRelativeFee();

    /// @notice Emitted when amount is below commission
    error AmountLessThanCommission(uint256 commission);

    /// @notice Emitted when the origin contract is unknown.
    error UnknownOriginContract(bytes32 fromChain, bytes32 fromContract);

    /// @notice Emitted when the unexpected action is used.
    error UnexpectedAction(bytes4 action);

    /// @notice Emitted when the deposit absolute commission is changed.
    event DepositAbsoluteCommissionChanged(uint64 newValue, bytes32 chain);

    /// @notice Emitted when the deposit relative commission is changed.
    event DepositRelativeCommissionChanged(uint16 newValue, bytes32 chain);

    /// @notice Emitted when a bridge destination is added.
    event BridgeDestinationAdded(bytes32 chain, bytes32 contractAddress);

    /// @notice Emitted when a bridge destination is removed.
    event BridgeDestinationRemoved(bytes32 indexed chain, bytes32 indexed contractAddress);

    /// @notice Emitted when the adapter is changed.
    event AdapterChanged(address previousAdapter, address newAdapter);

    /// @notice Emitted when the is a deposit in the bridge
    event DepositToBridge(address indexed fromAddress, bytes32 indexed toAddress, bytes32 indexed payloadHash, bytes payload);
}