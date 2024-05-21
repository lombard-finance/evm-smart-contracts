// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILBTC {
    error ProofAlreadyUsed();
    error BadChainId(uint256 expected, uint256 received);
    error ZeroAmount();
    error WithdrawalsDisabled();
    error WBTCStakingDisabled();
    error WBTCNotSet();
    error WBTCDecimalsMissmatch(uint8 expected, uint8 got);

    event UnstakeRequest(address fromAddress, bytes32 toAddress, uint256 amount);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address prevVal, address newVal);
    event OutputProcessed(bytes32 transactionId, uint32 index, bytes32 hash);
    event WBTCStaked(address staker, address to, uint256 amount);
    event WBTCStakingEnabled(bool);
    event WBTCChanged(address prevVal, address newVal);
}
