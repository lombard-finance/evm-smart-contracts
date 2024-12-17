# LBTC native bridge

**2nd factor provider:** [CCIP](https://docs.chain.link/ccip)

## Prerequisites

- LBTC
- Bridge

## How to bridge

### Approve

Make approve of LBTC to Bridge address

```typescript
await lbtc.approve(bridge.address, amount);
```

### Deposit

Call the method `function deposit(bytes32 toChain, bytes32 toAddress, uint64 amount)`

```typescript
// for EVM chains we should convert destination chain id and address to bytes32
import {CHAIN_ID} from "./helpers";

const CHAIN_ID = 17000;
const RECEIVER = '0x62F10cE5b727edf787ea45776bD050308A611508';

const destChainId = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [CHAIN_ID]);
const destReceiver = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [RECEIVER]);

await bridge.deposit(destChainId, destBridge, destReceiver, amount);
```

### Track bridge

Using received `txhash` you can see your transaction in CCIP explorer ([example](https://ccip.chain.link/#/side-drawer/msg/0xd63535b032119adf0bbb6ecf69a7225092c2f7d1483fad42973e9ee3cf319417))

After successful transaction confirmation and attestation by Lombard Ledger token minted automatically on destination chain.