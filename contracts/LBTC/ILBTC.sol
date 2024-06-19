// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILBTC {
    error ProofAlreadyUsed();
    error BadChainId(uint256 expected, uint256 received);
    error ZeroAmount();
    error ZeroAddress();
    error WithdrawalsDisabled();
    error InvalidContractAddress();
    error EventFromUnknownContract();
    error BadFromToken();
    error InvalidType();
    error KnownDestination();
    error UnknownDestination();
    error BadSignature();
    error BadCommission();
    error ScriptPubkeyUnsupported();

    event UnstakeRequest(address indexed fromAddress, bytes scriptPubKey, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event OutputProcessed(bytes32 indexed transactionId, uint32 indexed index, bytes32 hash);
    event BridgeDestinationAdded(uint256 indexed toChain, address indexed toToken);
    event BridgeDestinationRemoved(uint256 indexed toChain, address indexed toToken);
    event DepositToBridge(uint256 chainId, address indexed fromAddress, address indexed toAddress, address fromToken, address toToken, uint256 totalAmount, uint256 nonce);
    event WithdrawFromBridge(bytes32 indexed receiptHash, address indexed fromAddress, address indexed toAddress, address fromToken, address toToken, uint256 totalAmount);
    event DepositCommissionChanged(uint16 newValue, uint256 toChain);
    event TreasuryAddressChanged(address indexed prevValue, address indexed newValue);


    function depositToBridge(uint256 toChain, address toAddress, uint256 amount) external;

    function withdrawFromBridge(bytes calldata encodedProof, bytes calldata rawReceipt, bytes memory receiptRootSignature) external;

}
