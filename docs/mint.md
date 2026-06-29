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

## Operator runbook: proof-mint rate limit (`address(this)` bucket)

> **Operators must read this before sizing mint rate limits.**

Permissionless proof mints are rate-limited by a **single, protocol-wide leaky-bucket** keyed by
`address(this)` — not per-recipient or per-caller. It is configured with
`setMinterLimit(address(this), { limit, window })` and applies to:

- `NativeLBTC`: `mintV1`, `batchMintV1`, and the `CLAIMER_ROLE` fee paths `mintV1WithFee` /
  `batchMintV1WithFee` (the fee leg uses `_transfer`, so only the deposit `amount` is charged, but
  every proof flow still draws from this one quota).
- `BridgeTokenAdapter`: `mintV1`, `batchMintV1`.

Consequences and sizing guidance:

- **All users share one quota.** Heavy but fully legitimate proof-mint activity from one user can
  temporarily exhaust the bucket, causing other users' unrelated, consortium-approved proof mints to
  revert with `RateLimitExceeded` until the bucket decays. This is **intended behavior**.
- **Size `limit` for aggregate throughput**, not for a single user — base it on expected total
  proof-mint volume across the whole `window`, with headroom for bursts.
- **Expect short-window contention.** During spikes near the cap, some valid mints will revert and
  must be retried after partial decay; this is not a failure of the mint itself.
- The bucket is keyed by address, so revoking/regranting roles does not reset it; reconfigure via
  `setMinterLimit` (`MANAGER_ROLE`). Setting `limit = 0` deletes the entry and **blocks all proof
  mints** until reconfigured. For a practically unlimited cap, use a large `limit` (e.g. `type(uint96).max`)
  with a short `window`.

> Note: This is distinct from the `{AssetRouter}` bucket used by `StakedLBTC` release/redeem-fee
> /`mintWithFee` traffic, which is keyed by the AssetRouter address and shared across those flows.
