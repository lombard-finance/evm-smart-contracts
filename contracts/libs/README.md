# Libs

Shared library contracts used throughout the Lombard protocol.

## Libraries

### Actions.sol
Defines action structs used for cross-chain messaging and consortium verification:
- `DepositBtcActionV0/V1`: BTC deposit action structures
- `DepositBridgeAction`: Cross-chain bridge deposit
- `ValSetAction`: Validator set updates
- `FeeApprovalAction`: Fee approval signatures
- `RatioUpdate`: Oracle ratio updates

### BitcoinUtils.sol
Utilities for Bitcoin address parsing and validation.

### EIP1271SignatureUtils.sol
Helper functions for EIP-1271 smart contract signature verification.

### FeeUtils.sol
Fee calculation and validation utilities.

### LChainId.sol
Chain ID constants and utilities for the Lombard protocol.

### RateLimits.sol
Rate limiting implementation for deposit and withdrawal operations.
