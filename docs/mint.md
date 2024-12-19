# Mint LBTC

This action mints deposited `BTC` in `LBTC` tokens.

## Prerequisites

Before performing the following steps, the offchain part of the protocol must be executed:
1. Generate deposit bitcoin address.
2. Send `BTC` to deposit bitcoin address.
3. Wait for required block confirmations on bitcoin network.
4. Receive notarization result of your deposit (includes special payload and array of notaries signatures)

## Send mint tx

### Function: `mint(bytes calldata payload, bytes calldata proof)`
Mints `LBTC` by proving a notarized `DEPOSIT_BTC_ACTION` as payload.

**Example:**

```typescript
await lbtc['mint(bytes,bytes)'](payload, proof)
```

[Prod tx](https://etherscan.io/tx/0xc70e0593bf8e52d238a2a812ee8a3f97d14f0dbb5c2dda60d8f221c56bf82633)

## Misc

There are different methods to mint LBTC.

### Function: `mint(address to, uint256 amount)`
> **IMPORTANT**: Only allowed for whitelisted minters such as PMM modules.
> 
Mint LBTC to the specified address without proof and payload.

**Example:**

```typescript
await lbtc.mint[address,amount](toAddress, amount)
```

### Function: `batchMint(address[] calldata to,uint256[] calldata amount)`
> **IMPORTANT**: Only allowed for whitelisted minters such as PMM modules.

Mint LBTC to the specified address without proof and payload.