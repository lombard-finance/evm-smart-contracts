# OFT Adapter integration

## Deposit
1. Inputs
   1. Use token from `token()`.
   2. Check if approval required for OFT Adapter by calling `approvalRequired()`.
      1. Make approval if required.
   3.  `sharedDecimals()`.
2. Choose destination EID https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts.
3. Invoke sending
   1. Build `SendParam`
   2. Get `MessagingFee` struct from `quoteSend(sendParam, true)`
   3. Send tx `send(sendParam, messagingFee, senderAddr)`