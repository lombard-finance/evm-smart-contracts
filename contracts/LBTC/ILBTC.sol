// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ILBTC {
    error ZeroAddress();
    error ZeroContractHash();
    error ZeroChainId();
    error WithdrawalsDisabled();
    error KnownDestination();
    error UnknownDestination();
    error ScriptPubkeyUnsupported();
    error AmountLessThanCommission(uint256 fee);
    error AmountBelowDustLimit(uint256 dustLimit);
    error InvalidDustFeeRate();
    error UnauthorizedAccount(address account);
    error UnexpectedAction(bytes4 action);
    error UnknownOriginContract(uint256 fromChainId, address fromContract);
    /// @dev Error thrown when signature payload is already used
    error PayloadAlreadyUsed();

    event PauserRoleTransferred(address indexed previousPauser, address indexed newPauser);
    event UnstakeRequest(address indexed fromAddress, bytes scriptPubKey, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event TreasuryAddressChanged(address indexed prevValue, address indexed newValue);
    event BurnCommissionChanged(uint64 indexed prevValue, uint64 indexed newValue);
    event DustFeeRateChanged(uint256 indexed oldRate, uint256 indexed newRate);
    event BasculeChanged(address indexed prevVal, address indexed newVal);
    event MinterUpdated(address indexed minter, bool isMinter);
    event BridgeChanged(address indexed prevVal, address indexed newVal);

    event MintProofConsumed(address indexed recipient, bytes32 indexed payloadHash, bytes payload);
}
