// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILBTC {
    error ProofAlreadyUsed();
    error BadChainId(uint256 expected, uint256 received);
    error ZeroAmount();
    error WithdrawalsDisabled();

    event UnstakeRequest(address fromAddress, bytes32 toAddress, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event OutputProcessed(bytes32 transactionId, uint32 index, bytes32 hash);
}
