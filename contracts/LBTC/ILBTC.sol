// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ILBTC {
    error ZeroAddress();
    error ZeroContractHash();
    error ZeroChainId();
    error WithdrawalsDisabled();
    error KnownDestination();
    error UnknownDestination();
    error BadCommission();
    error ScriptPubkeyUnsupported();
    error AmountTooSmallToPayRelativeFee();
    error AmountLessThanCommission(uint256 fee);
    error AmountBelowDustLimit(uint256 dustLimit);
    error InvalidDustFeeRate();
    error UnauthorizedAccount(address account);
    error UnexpectedAction(bytes4 action);
    error UnknownOriginContract(uint256 fromChainId, address fromContract);

    event PauserRoleTransferred(address indexed previousPauser, address indexed newPauser);
    event UnstakeRequest(address indexed fromAddress, bytes scriptPubKey, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event BridgeDestinationAdded(bytes32 indexed toChain, bytes32 indexed toContract);
    event BridgeDestinationRemoved(bytes32 indexed toChain, bytes32 indexed toContract);
    event TreasuryAddressChanged(address indexed prevValue, address indexed newValue);
    event DepositAbsoluteCommissionChanged(uint64 newValue, bytes32 indexed toChain);
    event DepositRelativeCommissionChanged(uint16 newValue, bytes32 indexed toChain);
    event BurnCommissionChanged(uint64 indexed prevValue, uint64 indexed newValue);
    event DustFeeRateChanged(uint256 indexed oldRate, uint256 indexed newRate);
    event BasculeChanged(address indexed prevVal, address indexed newVal);
    
    event DepositToBridge(address indexed fromAddress, bytes indexed payload);
    event WithdrawFromBridge(bytes indexed payload, bytes32 indexed proofHash);
    event MintProofConsumed(bytes indexed payload, bytes32 indexed proofHash);
}
