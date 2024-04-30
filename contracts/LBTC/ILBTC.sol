// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../libs/DepositDataCodec.sol";

interface ILBTC {
    error ProofAlreadyUsed();
    error BadSignature();
    error BadChainId(uint256 expected, uint256 received);
    error ZeroAmount();
    error WithdrawalsDisabled();

    event Burned(address fromAddress, bytes32 outputScript, uint256 amount, uint256 nonce);
    event WithdrawalsEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
}
