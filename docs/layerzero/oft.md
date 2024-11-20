# OFT Adapter integration

## Deposit
1. Inputs
   1. Use token from `token()` (should be LBTC).
   2. Check if approval required for OFT Adapter by calling `approvalRequired()`.
      1. Make approval if required.
2. Choose [destination EID](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts). (e.g bera testnet - 40291, eth sepolia - 40161)
3. Bridge
   1. Build `SendParam`
      1. `to` - zero prefixed hex address with 32 bytes length
      2. `amountLD`, `minAmountLD` - LBTC amount to send
      3. `extraOptions` - hex build by `@layerzerolabs/lz-v2-utilities` package
         1. `gasLimit` - should be set to `140000`.
         2. ```typescript
                const opts = Options.newOptions().addExecutorLzReceiveOption(
                    140_000,
                    0
                );
            ```
      4. `composeMgs` - empty `0x`
      5. `oftCmd` - empty `0x`
   2. Get `MessagingFee` struct from `quoteSend(sendParam, true)`
   3. Send tx `send(sendParam, messagingFee, senderAddr)` with value = `nativeFee` from `MessagingFee` msg
   4. Check tx status by [LZ explorer](https://testnet.layerzeroscan.com/tx/0x0caab84a15cae46d938b1e19ff88eafdccf5e8b05291f65e48c29c32698856f1)
      1. Their explorer have API if we want to track status on our front-end