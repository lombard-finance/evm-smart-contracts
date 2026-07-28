# Strategy (Lombard Strategies)

This folder contains on-chain strategy **share tokens**, **shards** (including `RemoteShard`), asset **converters**, a **BlocklistOracle** compliance gate, and the **Merkle allowlist validator** used by shard `exec` policy.

---

## MultiAssetWithAsyncRedemptionStrategy

The main strategy product (ERC-20 **strategy shares**). Users deposit **any supported token** (LBTC, BTC.b, or other configured assets) and receive **strategy shares** in return. Redemptions are **asynchronous**: users call `requestRedeem` (shares burn net of fees); accounts with **`PAY_REDEMPTIONS_ROLE`** call `fulfillRedeemRequests` to deliver underlying to the owner — no separate end-user claim transaction.

The concrete contract composes `MultiAssetDepositUpgradeable` (multi-token deposit) with `AsyncRedemptionUpgradeable` (async exit), both on top of `FeeManagerUpgradeable` (management / performance fees) and `StrategyBaseUpgradeable` (share token, NAV, shard registry, pauses, blocklist gate). It ships behind an OpenZeppelin `BeaconProxy` / `UpgradeableBeacon`.

**Deposit** — accepts multiple input tokens, each with its own pricing adapter (`IAssetConverter`) and an optional fee (in basis points, strictly below `10_000`). The adapter converts the deposit token into the strategy's base accounting units before shares are minted. Deposit-asset management is gated by **`MANAGER_ROLE`**.

```solidity
// Manager registers a new deposit asset (MANAGER_ROLE)
strategy.addDepositAsset(tokenAddress, converterAdapter, depositFeeBps);

// User deposits and receives shares
uint256 shares = strategy.deposit(tokenAddress, amount, receiver);

// Slippage-guarded variant: reverts if minted shares < minSharesOut
uint256 shares = strategy.deposit(tokenAddress, amount, receiver, minSharesOut);

// Exact-shares variants (pull computed gross assets; second reverts if assets > maxAssetsIn)
uint256 assets = strategy.mint(tokenAddress, shares, receiver);
uint256 assets = strategy.mint(tokenAddress, shares, receiver, maxAssetsIn);
```

On deposit, the gross `depositAsset` amount is pulled in first; then `depositFeeBps` is skimmed (rounded **up**) and the fee slice of the **deposit token** is transferred to `feeTreasury` (reverts `StrategyDeposit_FeeTreasuryNotSet` if a fee is due while the treasury is unset), emitting `DepositFeeTransferred`. Shares are minted against the **net** amount, the `Deposit` event reports net `assets`, `shares`, and `feeAssets` separately, and any net liquidity is forwarded to the default shard (`DepositRoutedToDefaultShard`) when one is configured. Both the `sender` and the `receiver` are checked against the [BlocklistOracle](#blocklistoracle).

**Redeem** — Users call `requestRedeem` (shares are burned up front, net of an optional redeem fee in shares to the fee treasury). Settlement is **not** ERC-4626 `withdraw`/`redeem`; payout happens when an address with **`PAY_REDEMPTIONS_ROLE`** calls `fulfillRedeemRequests`. Underlying assets are transferred to the **owner** on fulfillment — there is no separate user claim step.

`requestRedeem` returns a 1-based `requestId`. If the caller is not the `owner`, the caller's allowance over the owner's shares is spent. A request **cannot** be fulfilled in the same block it was created (one-block minimum delay), which blocks same-block deposit → request → fulfill (flash-loan) cycles.

```solidity
// shares burned net of the redeem fee; returns the request id
uint256 requestId = strategy.requestRedeem(shares, owner);

// caller needs PAY_REDEMPTIONS_ROLE; reverts if any id is still in its creation block
// Do not call between operator NAV snapshot and postPricePerShare
strategy.fulfillRedeemRequests([requestId1, requestId2]);
```

Each `requestRedeem` accrues the management fee, prices `netShares` into `assets` via the posted rate (`_convertToAssets`, rounded down), and records a `RedeemRequest { pendingShares, pendingAssets, owner, requestBlock }` (`pendingAssets` is the request-time ceiling). It reverts `AsyncRedemption_FeeSharesGreaterThanShares` if the fee would consume the whole request and `AsyncRedemption_ZeroAssets` if the net redemption prices to zero assets. `fulfillRedeemRequests` pays `min(pendingAssets, shares × current pricePerShare)` so a PPS drop after the request cannot overpay current NAV; a PPS rise leaves surplus in the vault for remaining holders (later inclusive `postPricePerShare` — see [Posted NAV vs dilution fees](#posted-nav-vs-dilution-fees)). It reverts `AsyncRedemption_NothingToFulfill` for an unknown/already-paid id and `AsyncRedemption_FulfillTooEarly` if `block.number <= requestBlock`. Read-only helpers: `redeemFee()`, `pendingRedeemRequest(requestId)`, `pendingAssetsOf(owner)`, and `totalPending()` → `(totalPendingShares, totalPendingAssets)`.

> There is **no** global per-request redemption cap; `requestRedeem` is unbounded in size (subject to the owner's balance). The `MaxRedeemRequestSet` event in `IAsyncRedemption` is reserved and currently unused.

**Roles**

All capabilities below reflect the exact `onlyRole` wiring in `StrategyBaseUpgradeable` / its modules. There is **no** `MGMT_FEE_CLAIM_ROLE`, **no** `LIMITED_ADMIN_ROLE`, and **no** `TREASURY_ROLE` in the implementation.

| Role                    | Constant                             | Controls                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`    | OZ `AccessControlDefaultAdminRules`  | Grant/revoke roles; `registerShard`; `setBlocklistOracle`; `changeNameAndSymbol`; fee **rates** (`setManagementFeeBps`, `setPerformanceFeeBps`, `setRedeemFeeBps`)                                                                                                                                   |
| `MANAGER_ROLE`          | `keccak256("MANAGER_ROLE")`          | Deposit-asset list / converters / fee bps (`addDepositAsset`, `removeDepositAsset`, `setAssetConverter`, `setDepositFeeBps`); `setPricePerShareRateLimit`; `setFeeTreasury`; `setManagementFeeTreasury`; `deregisterShard`; `setDefaultShard`; `unpauseDeposit`; `unpauseRedeem`; `unpause` (ERC-20) |
| `PRICE_SETTER_ROLE`     | `keccak256("PRICE_SETTER_ROLE")`     | `postPricePerShare` (may auto-pause deposit + redeem on a rate-limit drain)                                                                                                                                                                                                                          |
| `STRATEGY_PAUSER_ROLE`  | `keccak256("STRATEGY_PAUSER_ROLE")`  | `pauseDeposit`, `pauseRedeem` (deposit/redeem entrypoint pauses; not ERC-20 transfer pause)                                                                                                                                                                                                          |
| `TRANSFERS_PAUSER_ROLE` | `keccak256("TRANSFERS_PAUSER_ROLE")` | ERC-20 transfer pause (`pause`)                                                                                                                                                                                                                                                                      |
| `PAY_REDEMPTIONS_ROLE`  | `keccak256("PAY_REDEMPTIONS_ROLE")`  | `fulfillRedeemRequests`                                                                                                                                                                                                                                                                              |
| `PERF_FEE_CLAIM_ROLE`   | `keccak256("PERF_FEE_CLAIM_ROLE")`   | `harvestPerformanceFee`                                                                                                                                                                                                                                                                              |

> **Design note — role separation for `pricePerShare`:** The rate-limit configuration (`MANAGER_ROLE`, `setPricePerShareRateLimit`) and the price posting itself (`PRICE_SETTER_ROLE`, `postPricePerShare`) are deliberately held by different parties. This is a safety catch: compromising one key alone cannot both widen the allowed price band _and_ post an out-of-range price.

**Pauses** — There are **two independent** strategy pause flags — `depositPaused` and `redeemPaused` — separate from each other and from the optional ERC-20 **transfer** pause:

- `STRATEGY_PAUSER_ROLE` calls `pauseDeposit()` / `pauseRedeem()` (emit `DepositPaused` / `RedeemPaused`); `MANAGER_ROLE` clears each independently via `unpauseDeposit()` / `unpauseRedeem()`.
- ERC-20 transfer pause: `TRANSFERS_PAUSER_ROLE` calls `pause()`; `MANAGER_ROLE` calls `unpause()`.
- A `postPricePerShare` call that overshoots the rate limiter with `revertOnRateLimit = false` automatically pauses **both** deposit and redeem (circuit breaker). Redeem pause (`whenRedeemNotPaused`) gates both `requestRedeem` and `fulfillRedeemRequests`.

**Fees** — The strategy combines **two flow fees** (skim deposit tokens and redemption shares to treasury) with **two dilution fees** (mint new shares on accrual/harvest). They route to **different** destinations — this is the key correction versus older docs:

- The **two flow fees** (per-asset deposit fee, redeem fee) route to a single **`feeTreasury`** (`setFeeTreasury`, `MANAGER_ROLE`).
- The **management fee** mints to a **separate** **`managementFeeTreasury`** (`setManagementFeeTreasury`, `MANAGER_ROLE`).
- The **performance fee** mints to the **`feeRecipient`** passed into the harvest call (not to any stored treasury).

Governance sets fee **rates** via **`DEFAULT_ADMIN_ROLE`** (`setManagementFeeBps`, `setPerformanceFeeBps`, `setRedeemFeeBps`); deposit fee bps are set per-asset by **`MANAGER_ROLE`**. There is **no** management-fee harvest role or function — the management fee accrues automatically (see below); only the **performance** fee has a harvest entrypoint, delegated to **`PERF_FEE_CLAIM_ROLE`**.

| Surface                   | What users feel                                        | What on-chain does                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Per-asset deposit fee** | Lower effective deposit amount for the same share mint | `depositFeeBps` (strictly `< 10_000`) on **gross** deposit assets; the fee slice of the **deposit token** is rounded **up** and transferred to `feeTreasury` before shares are minted (reverts `StrategyDeposit_FeeTreasuryNotSet` if a fee is due and the treasury is unset).                                                             |
| **Redemption redeem fee** | Fewer shares burned for the same redemption request    | `redeemFeeBps` on requested shares (rounded **up**); applied only when the rate is non-zero **and** a `feeTreasury` is set. Fee shares are **transferred** to `feeTreasury`, the remainder burned and booked for fulfillment.                                                                                                              |
| **Management fee**        | Gradual dilution over time                             | Annualized **bps on total supply**, accrued since `lastFeeHarvestAt`. Accrual runs **automatically** inside every deposit / redeem-request (and on `setManagementFeeBps`) via the internal `_accrueManagementFee()` hook, which **mints** grossed-up dilution shares to `managementFeeTreasury`. There is no separate harvest transaction. |
| **Performance fee**       | Dilution when NAV rises above the prior peak           | **High-water mark** on `pricePerShare`; when NAV clears it, `harvestPerformanceFee` raises the watermark to the current posted rate and **mints** a bps slice of the share gain to the chosen `feeRecipient` (mint skipped if shares floor to zero; HWM still rises — accepted, see spec § Performance fee). |

Updating **management** fee bps first accrues at the prior rate, then resets the accrual clock. Updating **performance** fee bps first settles any accrued performance fee — but only if current `pricePerShare` is above the stored high-water mark, in which case it raises the watermark to that rate and (unless `forfeitAccrued` is set) mints the accrued shares to `feeRecipient`; if `pricePerShare` is at or below the watermark, nothing is settled and the watermark is left unchanged. Worth coordinating off-chain before changing parameters.

### Posted NAV vs dilution fees

`pricePerShare` is the **posted** exchange rate. It changes only through `postPricePerShare` (subject to `PriceRateLimiter`), not when management or performance fees mint shares.

Fee mints increase `totalSupply` but leave `pricePerShare` unchanged, so `totalAssets()` (= `totalSupply × pricePerShare / 10 ** decimals()`) can read **slightly above** custodied underlying immediately after a mint. Example: `totalSupply = 100`, `pricePerShare = 1.10`, performance fee mints `2` shares → posted NAV is `102 × 1.10 = 112.2` while underlying value is still `110`.

This is **intentional**. Dilution fees transfer economics via new shares; they are not implemented as an internal `pricePerShare` rebase. Rebasing PPS inside `_accrueManagementFee` / `_harvestPerformanceFee` would bypass the rate limiter and mix fee dilution with oracle-posted NAV updates.

**Between price posts**, deposit and redemption math use the same posted rate. Mid-epoch reconciliation values **net** effective-supply Δ at the still-stored PPS (deposits, fee mints, fulfill removals) — accepted vs per-leg accounting; fee dilution, fulfill surplus, and mixed-net bias land on a later inclusive snapshot. A deposit into an understated window can capture part of fulfill surplus. Normative detail: [`docs/spec/003-strategy.md`](../../docs/spec/003-strategy.md) § Exchange rate (Accepted tradeoff). A redeem requested while PPS is still overstated may lock a high `pendingAssets` ceiling; after the correcting post, fulfill pays `min(pendingAssets, shares × currentPPS)`. Integrators MUST NOT treat mid-epoch `totalAssets()` as exact economic NAV after fee mints or PPS-rise fulfills since the last inclusive snapshot.

**Operational expectations:**

- Configure total fees (flow + management + performance) so they remain **below** yield/rewards accruing to remaining holders.
- Do **not** call `fulfillRedeemRequests`, `harvestPerformanceFee`, `setManagementFeeBps`, or `setPerformanceFeeBps` between the operator NAV/`effectiveSupply` snapshot and `postPricePerShare` (they move mid-epoch supply for reconciliation). User `deposit` / `mint` / `requestRedeem` are excluded from that rule.
- `PRICE_SETTER_ROLE` should post NAV on a cadence that keeps posted `pricePerShare` aligned with strategy economics, snapshotting after material fee mints and mid-epoch fulfills when surplus / netting bias matters.
- Prefer a short gap between `fulfillRedeemRequests` and the next inclusive `postPricePerShare` when deposit is open.
- Batch `harvestPerformanceFee` until `performanceFee().previewShares > 0` — dust harvests still raise HWM with zero mint (accepted; see [`docs/spec/003-strategy.md`](../../docs/spec/003-strategy.md) § Performance fee).
- Integrators must treat `totalAssets()` as **posted** NAV, not instantaneous on-chain token balance.

```text
depositFee      = ceil(assets × depositFeeBps / 10_000)
mgmtFeeShares   = totalSupply × num / (10_000 × 365 days − num),   num = managementFeeBps × Δseconds
perfFeeShares   = (totalSupply × (pricePerShare − HWM) / HWM) × performanceFeeBps / 10_000   when pricePerShare > HWM
```

The management fee is **grossed up** for self-dilution: minting `num/den` of supply would leave the treasury owning only `f/(1+f)` of the post-mint supply, so the mint solves `x/(totalSupply+x)=f` and uses `num/(den−num)`, making the treasury own exactly the configured fraction `f`. The share base is full `totalSupply()` (user + treasury), so prior management-fee shares held by `managementFeeTreasury` compound into later accruals. Accrual charges the **full elapsed interval** (no one-year cap); `den−num` would only underflow after more than `365 days × 10_000 / managementFeeBps` of unbroken accrual (decades at realistic fee rates), which is treated as unreachable.

```solidity
// MANAGER_ROLE: where management-fee dilution shares are minted
strategy.setManagementFeeTreasury(managementFeeTreasury);
// MANAGER_ROLE: where deposit skims and redeem-fee shares go
strategy.setFeeTreasury(feeTreasury);
// DEFAULT_ADMIN_ROLE: accrues at the prior rate, then sets the new management bps (bps < 10_000)
// Do not call between operator NAV snapshot and postPricePerShare
strategy.setManagementFeeBps(bps);
// DEFAULT_ADMIN_ROLE: settles accrued perf fee (only if pricePerShare > HWM), then sets the new performance bps
// Do not call between operator NAV snapshot and postPricePerShare
strategy.setPerformanceFeeBps(bps, feeRecipient, forfeitAccrued);
// PERF_FEE_CLAIM_ROLE: mints performance-fee shares to feeRecipient when pricePerShare > HWM
// Do not call between operator NAV snapshot and postPricePerShare
strategy.harvestPerformanceFee(feeRecipient);
// Management fees need no harvest call — they accrue automatically on deposit / redeem-request.
```

### Posting NAV and the price rate limiter

`postPricePerShare` is the only way the posted exchange rate moves. It is **not** a raw price setter — the price is derived from a NAV/supply snapshot and reconciled against mid-epoch supply changes. Normative rules live in [`docs/spec/003-strategy.md`](../../docs/spec/003-strategy.md) § Exchange rate.

```solidity
// PRICE_SETTER_ROLE; reverts if the ERC-20 transfer pause is active, or if BOTH deposit and redeem are paused
// effectiveSupplyAtSnapshot = totalSupply() + totalPendingShares() observed when navAtSnapshot was measured
strategy.postPricePerShare(navAtSnapshot, effectiveSupplyAtSnapshot, revertOnRateLimit);
// MANAGER_ROLE: configure the rate-limiter bucket (micro-bps capacity + refill)
strategy.setPricePerShareRateLimit(maxBucketBps, refillRate);
```

**Inputs and declared vs reconciled PPS**

- `navAtSnapshot` — true vault backing (asset units) at observation time. Reverts `Strategy_ZeroNavAtSnapshot` if zero.
- `effectiveSupplyAtSnapshot` — effective share supply at that same instant; MUST match on-chain `_effectiveShareSupply` semantics. For async redemption that is `totalSupply() + totalPendingShares()` (pending shares are burned out of `totalSupply()` but their backing is still in the vault). Passing `totalSupply()` alone concentrates any NAV loss/gain onto the residual circulating supply. Reverts `Strategy_ZeroSharesAtSnapshot` if zero.
- `declaredPricePerShare = navAtSnapshot × oneShare / effectiveSupplyAtSnapshot` (`oneShare = 10 ** decimals()`). Pure snapshot rate.
- `reconciledPricePerShare` — what is **stored**, and what the **rate limiter** measures against the prior stored PPS. Mid-epoch **net** change in `_effectiveShareSupply()` is folded in with a single Floor: `(navAtSnapshot × oneShare ± Δ × oldPPS) / effectiveSupplyNow`. Same-epoch deposits therefore cannot inflate post-update NAV, and a redeem *request* (circulating → pending) does not change effective supply so it cannot concentrate a loss onto residual holders. Fulfillment decreases effective supply and is reconciled at the **still-stored** PPS (even when payout was `min(request PPS, current PPS)`). Fee mints are valued the same way (no asset inflow), so dilution lands on a later inclusive snapshot; fulfill then clips via `min(pendingAssets, shares × currentPPS)`. Net-Δ can leave posted PPS stale under mixed mid-epoch legs (including deposit-into-surplus) until a later clean post — accepted; see spec § Accepted tradeoff. If removals valued at the stored PPS exceed `navAtSnapshot` (scaled), the call reverts `Strategy_InsufficientNavForReconciliation` — re-snapshot after fulfills (or avoid fulfilling between snapshot and post during a large drawdown). Near-equality dust may hit `Strategy_ZeroPricePerShare` instead (accepted; see spec § fused plain mul). Fused plain-`*` overflow on unrealistic NAV is accepted; see same section.

**Pause gating**

- Reverts `Strategy_PricePerSharePaused` when deposit or redeem is paused. Ops that hold both `MANAGER_ROLE` and `PRICE_SETTER_ROLE` are expected to unpause and post atomically after a circuit-breaker trip.

**Rate limiter**

- Leaky bucket on the **reconciled** relative move (old → stored PPS), in **micro-basis-points** (`1_000_000 = 100%`, so `10_000` units = 1%). Mid-epoch flow can shrink or amplify that delta versus the pure snapshot (declared) move.
  - Within capacity → consume capacity, set the reconciled price, emit `PricePerShareUpdated`.
  - Over capacity with `revertOnRateLimit = true` → revert `PriceRateLimiterRateLimitExceeded`.
  - Over capacity with `revertOnRateLimit = false` → drain the bucket, **still set** the reconciled price, then **pause both** deposit and redeem (circuit breaker).
- The bucket is **zeroed at init** (`maxBps = 0`), so `MANAGER_ROLE` MUST call `setPricePerShareRateLimit` before any non-zero price move is allowed. Inspect it with `pricePerShareRateLimiterState()`.
- **Accepted:** a frontrun deposit can shrink the measured move vs declared and suppress auto-pause; no attacker profit (reconcile at stored PPS; async exit). See [`docs/spec/003-strategy.md`](../../docs/spec/003-strategy.md) § Rate limiter.

---

## BlocklistOracle

A standalone, upgradeable **compliance gate**. The strategy consults it on every **deposit** and **redeem request** and reverts if any in-scope account is **manually blocklisted** or appears on an **external sanction list** (Chainalysis-style). It does **not** move funds, gate ERC-20 share transfers, or touch the shard `exec` path — it only answers _"is this account allowed to transact?"_ via a single reverting view.

### How it integrates

`StrategyBaseUpgradeable` holds a **mandatory** `blocklistOracle` address — required at `initialize` and **never zero** (the oracle cannot be disabled on-chain). It is read via `blocklistOracle()` and replaced via `setBlocklistOracle(oracle_)` (**`DEFAULT_ADMIN_ROLE`**, rejects zero), which emits `BlocklistOracleSet(oracle)`. The strategy calls it through `_requireBlocklistAllows(account)` → `IBlocklistOracle.check(account)`:

| Flow               | Accounts checked            |
| ------------------ | --------------------------- |
| **Deposit**        | `sender` **and** `receiver` |
| **Redeem request** | `owner`                     |

`check` reverts with `BlocklistOracle_NotAllowed(DenialReason.Blocklist)` if the account is on the **manual blocklist**, otherwise `BlocklistOracle_NotAllowed(DenialReason.Sanction)` if **any** registered sanction list reports it; otherwise it returns silently.

### Two sources of truth

1. **Manual blocklist** — an on-chain `EnumerableSet` of addresses managed directly on this contract.
2. **Sanction lists** — zero or more external `ISanctionList` contracts (e.g. the Chainalysis sanctions oracle). `isSanctioned(account)` iterates every registered list and returns `true` if any reports the account sanctioned.

```solidity
oracle.check(account);                  // strategy gate (reverts on blocklist or sanction)

oracle.blockAccount(account);           // BLOCKLIST_SETTER_ROLE
oracle.unblockAccount(account);         // DEFAULT_ADMIN_ROLE
oracle.addSanctionList(chainalysis);    // DEFAULT_ADMIN_ROLE
oracle.removeSanctionList(chainalysis); // DEFAULT_ADMIN_ROLE
```

### Roles

Built on `AccessControlDefaultAdminRulesUpgradeable` (two-step admin handover with a configurable delay set at `initialize`).

| Role                    | Controls                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| `BLOCKLIST_SETTER_ROLE` | `blockAccount` only. Granted to `defaultAdmin_` at init.                      |
| `DEFAULT_ADMIN_ROLE`    | `unblockAccount`, `addSanctionList`, `removeSanctionList`; admin of all roles |

> **Asymmetric by design:** adding to the blocklist needs only `BLOCKLIST_SETTER_ROLE` (fast operational reaction), but **removing** an account needs `DEFAULT_ADMIN_ROLE`.

View helpers: `isSanctioned(address)` (any registered list), `isBlocklisted(address)` (manual list only), `blocklistLength()`, `getBlocklistEntries(offset, limit)` (paginated; empty if `limit == 0` or `offset >= length`; ordering not stable across mutations), and `getSanctionLists()`. `DenialReason` is `{ Blocklist, Sanction }`; `ISanctionList` is a single `isSanctioned(address) returns (bool)` view (the Chainalysis sanctions-oracle shape).

---

## MerkleAllowlistValidator

A read-only validator that answers: _"Is this call allowed under our published policy?"_ It does **not** execute calls or move ETH. It is **non-upgradeable** and **`Ownable2Step`**: only the **owner** may rotate the Merkle root (`setAllowlistRoot`), and ownership transfer is two-step.

Normative detail lives in [`docs/spec/001-merkle-call-data-allowlist.md`](../../docs/spec/001-merkle-call-data-allowlist.md). This README is a short product-oriented overview plus examples.

### How it works

1. Off-chain you define **many allowed call patterns** ("rules") and build a **Merkle tree** over them.
2. On-chain the contract stores only the **Merkle root** (a single hash). A **zero root** means "deny everything" until the **owner** sets a real root via `setAllowlistRoot` (emits `AllowlistRootUpdated(oldRoot, newRoot)`).
3. Each check supplies: the **call** you want to validate `(sender, to, value, data)` plus **one rule** (`ruleEncoded`) and a **Merkle proof** that this rule is in the tree.
4. The contract verifies the proof, then checks that the call **matches** that rule (optional fixed sender / target / ETH / payload length, plus optional **payload spot-checks**).

The contract implements both `IMerkleCallAllowlist` (typed `CallVerificationInput` struct) and `IShardExecValidator` (ABI-encoded `validatorArgs` `bytes`), so one deployment can serve shard `exec` and direct callers via two `isAllowed` overloads. The `sender` passed to `isAllowed` is the **logical** caller your product cares about (e.g. shard / strategy integration context), **not** necessarily `msg.sender` of the `isAllowed` call.

### What you can put in a rule

| You can fix or leave open            | Notes                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sender**                           | Exact address, or any.                                                                                                                                                                                                                                                                                                                                |
| **Target contract (`to`)**           | Exact address, or any.                                                                                                                                                                                                                                                                                                                                |
| **ETH sent with the call (`value`)** | Exact amount, or any.                                                                                                                                                                                                                                                                                                                                 |
| **Length of `data`**                 | Exact byte length, or any.                                                                                                                                                                                                                                                                                                                            |
| **Inside `data` (calldata)**         | Up to **64** checks: at a **byte offset into `data[4:]`** (ABI args only), read a **full** 32-byte window at full-calldata byte `4 + offset` and require `(word & mask) == expected`. The window must be fully present in `data`; a constraint whose window runs past the end of `data` **denies** the call (no zero-padding fallback at match time). |

**Function selector** is pinned with flag **`0x10`** and a **`bytes4 selector`** in the rule header (not with a constraint). **Payload checks** pin **ABI argument words**: first word at constraint offset **0** (full-calldata bytes `4..36`), second at offset **32**, etc.

**Limits (version `0x01`):**

- At most **64** payload checks per rule (`MAX_CONSTRAINTS = 64`).
- Each offset is **0…65535** (`uint16`).
- Checks must use **strictly increasing** offsets; **duplicate offsets** are invalid.
- **`mask` must be non-zero**; bits set in `expected` outside `mask` are invalid (`expected & ~mask == 0`).

### Flags (which fields are fixed)

`flags` uses bits **0–4**; bits **5–7** are reserved and must be zero (`flags & 0xE0 == 0`):

| Bit | Value  | Constant           | Meaning when set                                                                         |
| --- | ------ | ------------------ | ---------------------------------------------------------------------------------------- |
| 0   | `0x01` | `FLAG_SENDER`      | `sender` must equal the address in the rule                                              |
| 1   | `0x02` | `FLAG_TO`          | `to` must equal the address in the rule                                                  |
| 2   | `0x04` | `FLAG_VALUE`       | `value` must equal the value in the rule                                                 |
| 3   | `0x08` | `FLAG_DATA_LENGTH` | `data.length` must equal `dataLength` in the rule                                        |
| 4   | `0x10` | `FLAG_SELECTOR`    | `bytes4(data[0:4])` must equal `selector` in the rule (also requires `data.length >= 4`) |

If a bit is **clear**, that field is **wildcard** and the canonical encoding **must** store zero there (`address(0)`, `value == 0`, `dataLength == 0`, or **`selector == bytes4(0)`**). Match-time checks only compare fields whose flags are **set** — a zero stored in a wildcard field is **not** an exact-match constraint.

> **Warning:** Omitting `FLAG_VALUE` makes `value` a wildcard even when the encoded rule has `value: 0`. Callers can then reuse the Merkle proof with any ETH amount, and shard `exec` will forward ETH from the shard’s balance. Omit `FLAG_SENDER` only when any caller may reuse the proof; set it when the proof must be single-caller. Always OR in every flag for a field you intend to pin.

### Merkle leaf (for builders)

Leaves must match **OpenZeppelin `StandardMerkleTree`** with row types `['uint8', 'bytes32', 'bytes']` and values:

`[uint8(0), domainSeparator, ruleEncoded]`

The on-chain leaf is `keccak256(bytes.concat(keccak256(abi.encode(uint8(0), domainSeparator, ruleEncoded))))` (`LEAF_TYPE = 0`). `domainSeparator` is fixed per **chain** and **validator contract address** (query `domainSeparator()` after deploy). Its preimage is:

```text
domainSeparator = keccak256(abi.encodePacked(
    bytes4(0x414c4c57), // DOMAIN_MAGIC, ASCII "ALLW"
    uint8(1),           // DOMAIN_LAYOUT_VERSION
    block.chainid,      // uint256, 32-byte big-endian
    address(this)       // 20-byte packed validator address
))
```

You **cannot** build the final tree until you know the validator address (unless you use a known address, e.g. CREATE2).

### Examples (TypeScript / ethers)

Below, `encodeMerkleRule` matches the packed layout used in tests (version `0x01`, big-endian `dataLength` and constraint counts as in spec). The packed header is `version(1)+flags(1)+selector(4)+sender(20)+to(20)+value(32)+dataLength(4)+constraintCount(2) = 84` bytes (`sender`/`to` are **raw 20-byte** addresses, not ABI-padded), followed by `66 * constraintCount` bytes of constraints; total `ruleEncoded.length == 84 + 66 * constraintCount`.

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

`flags: 0x02 | 0x04` pins **`to`** and **`value == 0`**. Leaving `FLAG_SENDER` clear intentionally allows any caller to reuse the proof.

```typescript
const ruleA = encodeMerkleRule({
  flags: 0x02 | 0x04, // FLAG_TO | FLAG_VALUE — exact `to`, exact 0 ETH
  sender: ethers.ZeroAddress,
  to: targetContract,
  value: 0n,
  dataLength: 0,
  constraints: []
});
```

#### Example B — Fix selector only (e.g. ERC-20 `transfer(address,uint256)` = `0xa9059cbb`)

Use **`flags | 0x10`** and set **`selector`**; leave **`constraints`** empty to allow any arguments. Include **`0x04` (`FLAG_VALUE`)** when the call must send 0 ETH.

```typescript
const ruleB = encodeMerkleRule({
  flags: 0x02 | 0x04 | 0x10, // FLAG_TO | FLAG_VALUE | FLAG_SELECTOR
  selector: 'transfer(address,uint256)',
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: []
});
```

#### Example C — Fix selector + full first argument word (e.g. recipient address)

Pin **`selector`**, then constrain the first ABI argument word at **constraint offset `0`** (bytes `data[4..36)`). Same **`FLAG_VALUE`** requirement as above for 0 ETH.

```typescript
const firstArgWord = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [recipient]); // 32-byte hex string

const ALL_ONES = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const ruleC = encodeMerkleRule({
  flags: 0x02 | 0x04 | 0x10, // FLAG_TO | FLAG_VALUE | FLAG_SELECTOR
  selector: 'transfer(address,uint256)',
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: [{ offset: 0, mask: ALL_ONES, expected: firstArgWord }]
});
```

#### Building the tree and calling `isAllowed`

Use `@openzeppelin/merkle-tree`'s `StandardMerkleTree.of` with type `['uint8', 'bytes32', 'bytes']` and rows `[0, domainSeparator, ethers.getBytes(ruleEncoded)]`. As **owner**, set the contract root to `tree.root` via `setAllowlistRoot`, then obtain `proof` with `tree.getProof(...)` for that row. See `test/strategy/MerkleCallAllowlist.ts` for a full flow.

---

## Shards (`Shard` & `RemoteShard`)

Both are **beacon-proxy upgradeable** contracts that share **`ShardBaseUpgradeable`**: off-chain policy (via `IShardExecValidator`, e.g. the Merkle allowlist) gates **`exec`** — arbitrary external calls with optional ETH — while **`PRIVILEGED_EXECUTOR_ROLE`** may call a validator-bypass **`exec`** overload for emergencies or ops that policy cannot express. Admins (`DEFAULT_ADMIN_ROLE`) can **`setValidator`**; the contract can **`receive`** ETH (emitting `EthReceived`) so balances fund forwarded calls.

Both `exec` overloads reject **self-targeted** calls: `to == address(this)` reverts (`Shard_ExecToSelfNotAllowed`). Each overload also requires `address(this).balance >= value` after crediting `msg.value` (else `Shard_InvalidEthFunding`), runs under `nonReentrant`, and emits `Executed(caller, to, value, data)` on success.

```solidity
bytes32 public constant PRIVILEGED_EXECUTOR_ROLE = keccak256("PRIVILEGED_EXECUTOR_ROLE");

// Validator-gated: any caller; policy decides. Reverts Shard_CallNotAllowed if denied.
function exec(address to, uint256 value, bytes calldata data, bytes calldata validatorArgs)
    external payable returns (bytes memory);

// Privileged: bypasses the validator; requires PRIVILEGED_EXECUTOR_ROLE.
function exec(address to, uint256 value, bytes calldata data)
    external payable returns (bytes memory);

function setValidator(IShardExecValidator newValidator) external; // DEFAULT_ADMIN_ROLE; emits ValidatorUpdated
```

### `Shard`

**Strategy-attached deployment.** Initialized with an **`IStrategy`** (the share-token contract) and a shard-transfer role holder. **`SHARD_TRANSFER_ROLE`** may **`pullFromStrategy`** (`IStrategy.requestFunding`) and **`pushToStrategy`** (return any ERC-20 to the strategy via `safeTransfer`; callers pass `strategy.asset()` in normal operation). Neither pipe call goes through the validator. Choose this when capital moves **through the strategy funding pipe** and everything else is **validator-approved `exec`** (protocol integrations, bridges, etc.).

```solidity
bytes32 public constant SHARD_TRANSFER_ROLE = keccak256("SHARD_TRANSFER_ROLE");

function initialize(IStrategy strategy_, IShardExecValidator validator_, address defaultAdmin_, address shardTransferer) external;
function pullFromStrategy(IERC20 token, uint256 amount) external; // SHARD_TRANSFER_ROLE; emits PulledFromStrategy
function pushToStrategy(IERC20 token, uint256 amount) external;   // SHARD_TRANSFER_ROLE; emits PushedToStrategy
```

### `RemoteShard`

**Exec-only footprint.** No **`IStrategy`** reference — no **`pullFromStrategy`** / **`pushToStrategy`**, no `SHARD_TRANSFER_ROLE`. Liquidity is **`exec`** only (validator-gated or privileged). Choose this when outbound activity is **purely approved external calls**, not **`IStrategy.requestFunding`**.

```solidity
function initialize(IShardExecValidator validator_, address defaultAdmin_) external;
```

---

## Asset converters (`converters/`)

Each deposit asset is registered with an **`IAssetConverter`** adapter (see `addDepositAsset`) that prices the deposit token in the strategy's **base accounting units** (the same scale as `pricePerShare`). The interface is two `view` functions, with caller-controlled rounding:

```solidity
interface IAssetConverter {
    function toBaseUnits(uint256 tokenAmount, Math.Rounding rounding) external view returns (uint256 baseOut);
    function fromBaseUnits(uint256 baseUnits, Math.Rounding rounding) external view returns (uint256 tokenOut);
}
```

The converters are **stateless / immutable** adapters — no roles, no events. There are three:

| Converter                     | Oracle              | Use when                                                                                               |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `DirectConverter`             | none (1:1 identity) | The deposit asset **is** the base NAV denomination (e.g. native LBTC into an LBTC-accounted strategy). |
| `ChainlinkConverter`          | one Chainlink feed  | Deposit token priced by a single Chainlink AggregatorV3 feed (e.g. WBTC/BTC, BTC/USD).                 |
| `ChainlinkCompositeConverter` | two Chainlink feeds | Deposit token priced by a **ratio** of two feeds sharing a common quote (e.g. ETH/USD ÷ BTC/USD).      |

- **`DirectConverter`** — identity mapping with no oracle (`toBaseUnits`/`fromBaseUnits` are `pure` and ignore the rounding arg).
- **`ChainlinkConverter`** — wraps a single `AggregatorV3Interface` feed; an `inverted_` flag selects base-per-token vs token-per-base. Decimal normalization is stored as a rational `scaleNumerator / scaleDenominator` (exactly one is a power of ten) so a negative exponent never reverts. The feed read reverts on a zero/negative/future/stale answer (`ChainlinkConverterInvalidAnswer` / `ChainlinkConverterFutureAnswer` / `ChainlinkConverterStaleAnswer`), and an optional L2 sequencer-uptime feed adds `ChainlinkConverterSequencerDown` / `ChainlinkConverterGracePeriodNotOver`. After the grace period, each price answer must also have `updatedAt >=` the sequencer recovery `startedAt` (rejects pre-downtime answers that are still within `heartbeat`).
- **`ChainlinkCompositeConverter`** — crosses **two** feeds as a ratio, netting decimals per direction. Same staleness / future / sequencer guards (underscore-style error names), including the post-recovery `updatedAt >= startedAt` check on **both** feeds; note it does **not** check `roundId`.

In every converter, `baseDecimals_` MUST equal the strategy underlying's decimals (8 for BTC/LBTC, 18 for WETH).

---

## MAWARStrategyMigrated

A thin, **migration-only** subclass of `MultiAssetWithAsyncRedemptionStrategy`. It exists to convert a **proxy that is already deployed** running the legacy `ERC4626VaultWrapper` implementation into a `MultiAssetWithAsyncRedemptionStrategy` **in place**, without redeploying. Because the proxy's `initializer` slot is already consumed (and its storage layout differs), the normal `initialize(...)` cannot be re-run — so this contract adds a single admin-gated **`migrate`** function that re-seeds the new ERC-7201 namespaced storage by hand. It adds **no other behavior** (deposits, async redemption, fees, pricing, shards, roles are inherited unchanged) and does **not** override `version()`.

```solidity
// Caller needs DEFAULT_ADMIN_ROLE; intended to be called exactly once, immediately after the upgrade
strategy.migrate(blocklistOracle, asset, decimals, managementFeeTreasury, initialPPS);
```

`migrate` re-initializes the inherited **ReentrancyGuard** slot (`_status = NOT_ENTERED`), **StrategyBase** storage (`asset`, `underlyingDecimals` set **directly** to `decimals_`, blocklist oracle, `pricePerShare = initialPPS_`, zeroed rate-limiter bucket), and **FeeManager** storage (`highWaterMark = pricePerShare()`, `lastFeeHarvestAt`, `managementFeeTreasury`). It does **not** re-initialize ERC-20 metadata, pausable state, access control, multi-asset deposit, or async-redemption storage — those carry over from the existing proxy.

> **Safety note:** `migrate` is **not** guarded by an `initializer`/`reinitializer` modifier — only by `DEFAULT_ADMIN_ROLE` (it validates non-zero `blocklistOracle_`, `asset_`, `managementFeeTreasury_` and non-zero `decimals_`). After running it and verifying state, upgrade the proxy to the plain `MultiAssetWithAsyncRedemptionStrategy` implementation so the function is removed and re-entry is impossible.

---

## Files

| File                                        | Role                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MultiAssetWithAsyncRedemptionStrategy.sol` | Main strategy (multi-asset deposit + async redemption)                                                                                |
| `MAWARStrategyMigrated.sol`                 | One-shot `migrate` converting a deployed `ERC4626VaultWrapper` proxy into the strategy (re-seeds ERC-7201 storage)                    |
| `StrategyBaseUpgradeable.sol`               | Shared base (share token, NAV, `pricePerShare`, shard registry, funding, pauses, blocklist gate)                                      |
| `MultiAssetDepositUpgradeable.sol`          | Multi-token deposit logic with converter adapters and per-asset deposit fees                                                          |
| `FeeManagerUpgradeable.sol`                 | Management (auto-accrued) / performance (HWM, harvested) fee module — share minting to treasuries                                     |
| `AsyncRedemptionUpgradeable.sol`            | Async redemption, `PAY_REDEMPTIONS_ROLE` fulfillment, one-block delay                                                                 |
| `BlocklistOracle.sol`                       | Compliance gate: manual blocklist + external sanction lists; strategy calls `check` on deposit/redeem                                 |
| `libraries/PriceRateLimiter.sol`            | Micro-bps leaky-bucket limiting relative `pricePerShare` moves                                                                        |
| `validators/MerkleAllowlistValidator.sol`   | Merkle call allowlist validator (`Ownable2Step`, owner-rotated root)                                                                  |
| `interfaces/IMerkleCallAllowlist.sol`       | Interface + `CallVerificationInput` struct                                                                                            |
| `interfaces/IBlocklistOracle.sol`           | Oracle interface: `check`, `DenialReason`, blocklist/sanction admin + view API                                                        |
| `interfaces/ISanctionList.sol`              | External sanction-oracle interface (`isSanctioned`, Chainalysis-style)                                                                |
| `converters/`                               | Asset converter adapters: `DirectConverter` (1:1), `ChainlinkConverter` (single feed), `ChainlinkCompositeConverter` (two-feed ratio) |
| `shards/Shard.sol`                          | Strategy-linked shard: `pullFromStrategy` / `pushToStrategy` + gated `exec`                                                           |
| `shards/RemoteShard.sol`                    | Validator-gated `exec` only (no strategy funding helpers)                                                                             |
| `shards/ShardBaseUpgradeable.sol`           | Shared `exec` / validator storage for shards                                                                                          |
