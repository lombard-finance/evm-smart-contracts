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

Mint LBTC to the specified address without proof and payload.

**Example:**

```typescript
await lbtc.mint[address,amount](toAddress, amount)
```

### Function: `batchMint(address[] calldata to,uint256[] calldata amount)`
Batched `mint(address to, uint256 amount)`

### Function: `batchMint(bytes[] calldata payload, bytes[] calldata proof)`

Batched `mint(bytes calldata payload, bytes calldata proof)`

### Function: `mintWithFee(bytes calldata mintPayload, bytes calldata proof, bytes calldata feePayload, bytes calldata userSignature)`
> **IMPORTANT**: Only allowed for whitelisted claimers.

Grants ability to special `claimer` to mint `LBTC` using a notarized `DEPOSIT_BTC_ACTION` and charge fees for that.
The possible fee is set in two places (inside smart-contract and typed message), the smart-contract choose the lowest of them.

**Example:**

```typescript
const [fields, domainName, version, chainId, verifyingContract, salt, extensions] = await lbtc.eip712Domain();

export async function signFeeTypedMessage(
  signer: HardhatEthersSigner,
  fee: BigNumberish,
  expiry: BigNumberish,
) {
  const domain = {
    name: domainName,
    version: version,
    chainId: chainId,
    verifyingContract: verifyingContract,
  };
  const types = {
    feeApproval: [
      { name: 'chainId', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  };
  const message = { chainId, fee, expiry };

  return signer.signTypedData(domain, types, message);
};

await lbtc.mintWithFee(actionPayload, proof, feePayload,
  await signFeeTypedMessage(
    defaultArgs.mintRecipient(),
    await lbtc.getAddress(),
    snapshotTimestamp
  )
);
```
### Function: `batchMintWithFee(bytes[] calldata mintPayload, bytes[] calldata proof, bytes[] calldata feePayload, bytes[] calldata userSignature)`

Batched `mintWithFee(bytes calldata mintPayload, bytes calldata proof, bytes calldata feePayload, bytes calldata userSignature)`
