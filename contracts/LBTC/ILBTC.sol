// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILBTC {
    error ProofAlreadyUsed();
    error ZeroAmount();
    error ZeroAddress();
    error ZeroContractHash();
    error ZeroChainId();
    error WithdrawalsDisabled();
    error WBTCStakingDisabled();
    error WBTCNotSet();
    error WBTCDecimalsMissmatch(uint8 expected, uint8 got);
    error BadChainId(uint256 expected, uint256 received);
    error BadToContractAddress(address expected, address received);
    error BadDestination();
    error KnownDestination();
    error UnknownDestination();
    error BadCommission();
    error ScriptPubkeyUnsupported();

    event UnstakeRequest(address indexed fromAddress, bytes scriptPubKey, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event OutputProcessed(bytes32 indexed transactionId, uint32 indexed index, bytes32 hash);
    event WBTCStaked(address indexed staker, address indexed to, uint256 amount);
    event WBTCStakingEnabled(bool);
    event WBTCChanged(address indexed prevVal, address indexed newVal);
    event BridgeDestinationAdded(bytes32 indexed toChain, bytes32 indexed toContract);
    event BridgeDestinationRemoved(bytes32 indexed toChain, bytes32 indexed toToken);
    event DepositToBridge(address indexed fromAddress, bytes32 indexed toAddress, bytes32 toContract, bytes32 chainId, uint64 amount);
    event WithdrawFromBridge(address indexed toAddress, bytes32 indexed txHash, uint32 indexed eventIndex, bytes32 fromContract, bytes32 fromChainId, uint64 amount);
    event DepositCommissionChanged(uint16 newValue, bytes32 indexed toChain);
    event TreasuryAddressChanged(address indexed prevValue, address indexed newValue);
}
