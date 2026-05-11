# Strategy (Lombard Strategies)

This folder contains on-chain strategy share tokens, shards (including `RemoteShard`), converters, and the Merkle allowlist validator used by shard `exec` policy.

---

## MultiAssetWithAsyncRedemptionStrategy

The main strategy product (ERC-20 **strategy shares**). Users deposit **any supported token** (LBTC, BTC.b, or other configured assets) and receive **strategy shares** in return. Redemptions are **asynchronous**: users call `requestRedeem` (shares burn net of fees); accounts with **`PAY_REDEMPTIONS_ROLE`** call `fulfillRedeemRequests` to deliver underlying to the owner — no separate end-user claim transaction.

**Deposit** — accepts multiple input tokens, each with its own pricing adapter and an optional fee (in basis points). The adapter converts the deposit token into the strategy’s base asset before shares are minted. The concrete contract composes `FeeManagerUpgradeable` (management / performance fees on shares) with `MultiAssetDepositUpgradeable`.

```solidity
// Admin registers a new deposit asset
strategy.addDepositAsset(tokenAddress, converterAdapter, depositFeeBps);

// User deposits and receives shares
uint256 shares = strategy.deposit(tokenAddress, amount, receiver);
```

**Redeem** — Users call `requestRedeem` (shares are burned up front, net of an optional redeem fee in shares to the fee treasury). Settlement is **not** ERC-4626 `withdraw`/`redeem`; payout happens when an address with **`PAY_REDEMPTIONS_ROLE`** calls `fulfillRedeemRequests`. Underlying assets are transferred to the **owner** on fulfillment — there is no separate user claim step.

```solidity
strategy.requestRedeem(shares, owner);
strategy.fulfillRedeemRequests([requestId1, requestId2]);
```

**Roles**

| Role                    | Controls                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`    | Deposit asset list / converters, fee treasury + fee bps config, redemption cap config, `pricePerShare` rate-limit config, **register shards**, grant roles |
| `MGMT_FEE_CLAIM_ROLE`   | `harvestManagementFee`                                                                                                                                     |
| `PERF_FEE_CLAIM_ROLE`   | `harvestPerformanceFee`                                                                                                                                    |
| `PRICE_SETTER_ROLE`     | `postPricePerShare` within the configured rate limit                                                                                                       |
| `STRATEGY_PAUSER_ROLE`  | `pauseDeposit`, `pauseRedeem` (strategy operations pause only; not ERC-20 transfer pause)                                                                  |
| `TRANSFERS_PAUSER_ROLE` | ERC-20 transfer pause (`pause`)                                                                                                                            |
| `PAY_REDEMPTIONS_ROLE`  | `fulfillRedeemRequests`                                                                                                                                    |
| `MANAGER_ROLE`          | **Deregister shards**, `setDefaultShard`, unpause strategy operations / ERC-20 unpause                                                                     |

**Fees** — The strategy combines **two flow fees** (skim deposit tokens and redemption shares to treasury) with **two dilution fees** (mint new shares to the treasury on harvest). All treasury-directed flows share one **`feeTreasury`** (`setFeeTreasury`); governance sets rates via admin and fee-harvest execution is delegated to **`MGMT_FEE_CLAIM_ROLE`** / **`PERF_FEE_CLAIM_ROLE`**.

| Surface                   | What users feel                                        | What on-chain does                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-asset deposit fee** | Lower effective deposit amount for the same share mint | `depositFeeBps` on **gross** deposit assets; the fee slice of the **deposit token** is transferred to `feeTreasury` before shares are minted (requires treasury set).                        |
| **Redemption redeem fee** | Fewer shares burned for the same redemption request    | `redeemFeeBps` on requested shares; fee shares are **transferred** to `feeTreasury`, remainder burned and booked for fulfillment.                                                            |
| **Management fee**        | Gradual dilution over time                             | Annualized **bps on total supply**, accrued since the last management harvest; treasury calls harvest to **mint** fee shares to a recipient.                                                 |
| **Performance fee**       | Dilution when NAV rises above the prior peak           | **High-water mark** on `pricePerShare`; when NAV clears it, harvest **mints** a bps slice of the **incremental supply that would correspond to that NAV gain** (then updates the watermark). |

Updating **management** fee bps resets the accrual clock; updating **performance** fee bps resets the high-water mark to the current NAV — worth coordinating off-chain before changing parameters.

```text
depositFee      = assets × depositFeeBps / 10_000
mgmtFeeShares   ≈ totalSupply × (managementFeeBps × Δseconds) / (10_000 × 365 days)
perfFeeShares   ≈ (totalSupply × (pricePerShare − HWM) / HWM) × performanceFeeBps / 10_000   when pricePerShare > HWM
```

```solidity
// Treasury-configured address for deposit skims, redeem-fee shares, and harvest mint targets
strategy.setFeeTreasury(treasury);
// Caller needs MGMT_FEE_CLAIM_ROLE
strategy.harvestManagementFee(treasury);
// Caller needs PERF_FEE_CLAIM_ROLE
strategy.harvestPerformanceFee(treasury);
```

---

## MerkleAllowlistValidator

A read-only validator that answers: _"Is this call allowed under our published policy?"_ It does **not** execute calls or move ETH.

Normative detail lives in [`docs/spec/001-merkle-call-data-allowlist.md`](../../docs/spec/001-merkle-call-data-allowlist.md). This README is a short product-oriented overview plus examples.

### How it works

1. Off-chain you define **many allowed call patterns** ("rules") and build a **Merkle tree** over them.
2. On-chain the contract stores only the **Merkle root** (a single hash). A **zero root** means "deny everything" until you set a real root.
3. Each check supplies: the **call** you want to validate `(sender, to, value, data)` plus **one rule** (`ruleEncoded`) and a **Merkle proof** that this rule is in the tree.
4. The contract verifies the proof, then checks that the call **matches** that rule (optional fixed sender / target / ETH / payload length, plus optional **payload spot-checks**).

The `sender` passed to `isAllowed` is the **logical** caller your product cares about (e.g. shard / strategy integration context), **not** necessarily `msg.sender` of the `isAllowed` call.

### What you can put in a rule

| You can fix or leave open            | Notes                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sender**                           | Exact address, or any.                                                                                                                                                            |
| **Target contract (`to`)**           | Exact address, or any.                                                                                                                                                            |
| **ETH sent with the call (`value`)** | Exact amount, or any.                                                                                                                                                             |
| **Length of `data`**                 | Exact byte length, or any.                                                                                                                                                        |
| **Inside `data` (calldata)**         | Up to **64** checks: at a **byte offset into `data[4:]`** (ABI args only), read a 32-byte window (zero-padded if the payload ends early) and require `(word & mask) == expected`. |

**Function selector** is pinned with flag **`0x10`** and a **`bytes4 selector`** in the rule header (not with a constraint). **Payload checks** pin **ABI argument words**: first word at constraint offset **0** (full-calldata bytes `4..36`), second at offset **32**, etc.

**Limits (version `0x01`):**

- At most **64** payload checks per rule.
- Each offset is **0…65535**.
- Checks must use **strictly increasing** offsets; **duplicate offsets** are invalid.
- **`mask` must be non-zero**; bits set in `expected` outside `mask` are invalid.

### Flags (which fields are fixed)

`flags` uses bits **0–4**; bits **5–7** are reserved and must be zero:

| Bit | Value  | Meaning when set                                      |
| --- | ------ | ----------------------------------------------------- |
| 0   | `0x01` | `sender` must equal the address in the rule           |
| 1   | `0x02` | `to` must equal the address in the rule               |
| 2   | `0x04` | `value` must equal the value in the rule              |
| 3   | `0x08` | `data.length` must equal `dataLength` in the rule     |
| 4   | `0x10` | `bytes4(data[0:4])` must equal `selector` in the rule |

If a bit is **clear**, that field is **wildcard** and the canonical encoding **must** store zero there (`address(0)`, `value == 0`, `dataLength == 0`, or **`selector == bytes4(0)`**).

### Merkle leaf (for builders)

Leaves must match **OpenZeppelin `StandardMerkleTree`** with values:

`[uint8(0), domainSeparator, ruleEncoded]`

where `domainSeparator` is fixed per **chain** and **validator contract address** (query `domainSeparator()` after deploy). You **cannot** build the final tree until you know that address (unless you use a known address e.g. CREATE2).

### Examples (TypeScript / ethers)

Below, `encodeMerkleRule` matches the packed layout used in tests (version `0x01`, big-endian `dataLength` and constraint counts as in spec).

#### Helper (same idea as `test/strategy/MerkleCallAllowlist.ts`)

```typescript
import { ethers } from 'ethers';
import { packRuleSelector, packedSelectorToBytes4 } from '../../scripts/strategy/merkleUtils';

interface RuleConstraint {
  offset: number;
  mask: string;
  expected: string;
}

function encodeMerkleRule(p: {
  flags: number;
  selector?: string;
  sender: string;
  to: string;
  value: bigint;
  dataLength: number;
  constraints: RuleConstraint[];
}): string {
  const sel = packedSelectorToBytes4(packRuleSelector(p.selector));
  const types: string[] = ['uint8', 'uint8', 'bytes4', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    0x01,
    p.flags,
    sel,
    p.sender,
    p.to,
    p.value,
    p.dataLength >>> 0,
    p.constraints.length
  ];
  for (const c of p.constraints) {
    types.push('uint16', 'bytes32', 'bytes32');
    values.push(c.offset, c.mask, c.expected);
  }
  return ethers.solidityPacked(types, values);
}
```

#### Example A — Allow any calldata to one contract, 0 ETH, any sender

```typescript
const ruleA = encodeMerkleRule({
  flags: 0x02, // exact `to` only
  sender: ethers.ZeroAddress,
  to: targetContract,
  value: 0n,
  dataLength: 0,
  constraints: []
});
```

#### Example B — Fix selector only (e.g. ERC-20 `transfer(address,uint256)` = `0xa9059cbb`)

Use **`flags | 0x10`** and set **`selector`**; leave **`constraints`** empty to allow any arguments.

```typescript
const ruleB = encodeMerkleRule({
  flags: 0x02 | 0x10,
  selector: 'transfer(address,uint256)',
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: []
});
```

#### Example C — Fix selector + full first argument word (e.g. recipient address)

Pin **`selector`**, then constrain the first ABI argument word at **constraint offset `0`** (bytes `data[4..36)`).

```typescript
const firstArgWord = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [recipient]); // 32-byte hex string

const ALL_ONES = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const ruleC = encodeMerkleRule({
  flags: 0x02 | 0x10,
  selector: 'transfer(address,uint256)',
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: [{ offset: 0, mask: ALL_ONES, expected: firstArgWord }]
});
```

#### Building the tree and calling `isAllowed`

Use `@openzeppelin/merkle-tree`'s `StandardMerkleTree.of` with type `['uint8', 'bytes32', 'bytes']` and rows `[0, domainSeparator, ethers.getBytes(ruleEncoded)]`. Set the contract root to `tree.root`, then obtain `proof` with `tree.getProof(...)` for that row. See `test/strategy/MerkleCallAllowlist.ts` for a full flow.

---

## Shards (`Shard` & `RemoteShard`)

Both are **beacon-proxy upgradeable** contracts that share **`ShardBaseUpgradeable`**: off-chain policy (via `IShardExecValidator`, e.g. Merkle allowlist) gates **`exec`**—arbitrary external calls with optional ETH—while **`PRIVILEGED_EXECUTOR_ROLE`** may call a validator-bypass **`exec`** overload for emergencies or ops that policy cannot express. Admins can **`setValidator`**; the contract can **`receive`** ETH so balances fund forwarded calls.

### `Shard`

**Strategy-attached deployment.** Initialized with an **`IStrategy`** (the share-token contract) and a shard-transfer role holder. **`SHARD_TRANSFER_ROLE`** may **`pullFromStrategy`** (`IStrategy.requestFunding`) and **`pushToStrategy`** (return ERC-20 to the strategy). Choose this when capital moves **through the strategy funding pipe** and everything else is **validator-approved `exec`** (protocol integrations, bridges, etc.).

### `RemoteShard`

**Exec-only footprint.** No **`IStrategy`** reference—no **`pullFromStrategy`** / **`pushToStrategy`**. Liquidity is **`exec`** only (validator-gated or privileged). Choose this when outbound activity is **purely approved external calls**, not **`IStrategy.requestFunding`**.

---

## Files

| File                                        | Role                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `MultiAssetWithAsyncRedemptionStrategy.sol` | Main strategy (multi-asset deposit + async redemption)                      |
| `StrategyBaseUpgradeable.sol`               | Shared base (share token, NAV, shard registry, funding, pause)              |
| `MultiAssetDepositUpgradeable.sol`          | Multi-token deposit logic with converter adapters                           |
| `FeeManagerUpgradeable.sol`                 | Management / performance fee module (share minting to treasury)             |
| `AsyncRedemptionUpgradeable.sol`            | Async redemption, `PAY_REDEMPTIONS_ROLE` fulfillment                        |
| `libraries/PriceRateLimiter.sol`            | Bucket used to limit relative `pricePerShare` moves                         |
| `validators/MerkleAllowlistValidator.sol`   | Merkle call allowlist validator                                             |
| `interfaces/IMerkleCallAllowlist.sol`       | Interface + `CallVerificationInput` struct                                  |
| `converters/`                               | Asset converter adapters (Chainlink, direct, staked LBTC, etc.)             |
| `shards/Shard.sol`                          | Strategy-linked shard: `pullFromStrategy` / `pushToStrategy` + gated `exec` |
| `shards/RemoteShard.sol`                    | Validator-gated `exec` only (no strategy funding helpers)                   |
| `shards/ShardBaseUpgradeable.sol`           | Shared `exec` / validator storage for shards                                |
