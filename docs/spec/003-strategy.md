# Feature: Strategy share token (multi-asset deposits, async redemption, shard integration)

Normative spec for **one** deployable **strategy** (ERC-20 share token): multi-asset depositor entry and accounting with **shards** moving liquidity via **`pullFromStrategy` / `pushToStrategy`** per **`docs/spec/002-strategy.md`**. The strategy implements **async redemption** (non-standard vs ERC-4626 immediate `withdraw`/`redeem`). Deposits use a **multi-asset** model (not standard ERC-4626 `deposit(assets, receiver)`). The **`IStrategy`** surface for shards MUST match **`contracts/strategy/interfaces/IStrategy.sol`**; multi-asset deposit and redemption entrypoints are **in addition** to that interface.

---

## Goal

Deliver **`StrategyBaseUpgradeable`** (shard registry + `pricePerShare` + strategy-wide pause), fee management (**`FeeManagerUpgradeable`**), multi-asset deposit routing (**`MultiAssetDepositUpgradeable`**), and async redemption (**`AsyncRedemptionUpgradeable`**), composed into a concrete implementation behind **`BeaconProxy`** (e.g. **`MultiAssetWithAsyncRedemptionStrategy`**).

1. **Deposits** — Multi-asset `deposit` / `mint` accepting listed ERC-20s via per-token `IAssetConverter` pricing; optional deposit fees and default-shard routing.
2. **Exits** — `requestRedeem` → pending → `fulfillRedeemRequests` (requires `PAY_REDEMPTIONS_ROLE`, direct settlement). No ERC-4626 `withdraw` / `redeem`.
3. **Redemption fulfillment** — `fulfillRedeemRequests(uint256[] requestIds)` pays `min(pendingAssets@request, shares × currentPPS)` of `asset` to each request's `owner` in one pass; caller MUST hold **`PAY_REDEMPTIONS_ROLE`**.
4. **Shards** — `registerShard` / `requestFunding` pipe per **002**; no extra `IStrategy` APIs moving `asset()` outside **002**.
5. **Exchange rate** — `pricePerShare` (asset wei per `10 ** decimals()` shares) posted by `PRICE_SETTER_ROLE` via `postPricePerShare(navAtSnapshot, effectiveSupplyAtSnapshot, revertOnRateLimit)`; `totalAssets()` derived from this rate.
6. **Fees** — Management fee (time-based dilution, auto-accrued) and performance fee (high-water-mark, `PERF_FEE_CLAIM_ROLE` harvest) minted as shares.

**Architecture (fixed):** Redemption fulfillment is invoked by an account with **`PAY_REDEMPTIONS_ROLE`**, directly paying asset to each request's owner in one tx. Cross-chain pricing field `pricePerShare` MUST be writable **only** by `PRICE_SETTER_ROLE`, subject to a **rate limiter** bucket. The implementation MUST ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (strategy-dedicated beacon, same pattern as **002** §A.1).

---

## Roles

| Role                    | Constant                             | Capabilities                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`    | OZ standard                          | Grant/revoke roles; `registerShard`; `setBlocklistOracle`; fee **rates** (`setManagementFeeBps`, `setPerformanceFeeBps`, `setRedeemFeeBps`); other admin-only hooks                                                                   |
| `MANAGER_ROLE`          | `keccak256("MANAGER_ROLE")`          | Deposit-asset list / converters / deposit fee bps; `setPricePerShareRateLimit`; `setFeeTreasury`; `setManagementFeeTreasury`; `deregisterShard`; `setDefaultShard`; unpause deposit/redeem / ERC-20 unpause                           |
| `PRICE_SETTER_ROLE`     | `keccak256("PRICE_SETTER_ROLE")`     | `postPricePerShare`                                                                                                                                                                                                                   |
| `STRATEGY_PAUSER_ROLE`  | `keccak256("STRATEGY_PAUSER_ROLE")`  | `pauseDeposit`, `pauseRedeem` (strategy operations pause only; not ERC-20 transfer pause)                                                                                                                                             |
| `TRANSFERS_PAUSER_ROLE` | `keccak256("TRANSFERS_PAUSER_ROLE")` | ERC-20 transfer pause (`pause`)                                                                                                                                                                                                       |
| `PAY_REDEMPTIONS_ROLE`  | `keccak256("PAY_REDEMPTIONS_ROLE")`  | `fulfillRedeemRequests`                                                                                                                                                                                                               |
| `PERF_FEE_CLAIM_ROLE`   | `keccak256("PERF_FEE_CLAIM_ROLE")`   | `harvestPerformanceFee`                                                                                                                                                                                                               |

`DEFAULT_ADMIN_ROLE` is the access-control super-admin per OpenZeppelin; capabilities above reflect **intended** assignments (see source `StrategyBaseUpgradeable` / modules for exact `onlyRole` wiring).

---

## Strategy operations pause

The strategy has **two independent** operations pause flags — `depositPaused` and `redeemPaused` — separate from each other and from optional ERC-20 **transfer** pause:

- `STRATEGY_PAUSER_ROLE` calls **`pauseDeposit()`** / **`pauseRedeem()`** to block deposit and redemption entrypoints (`whenDepositNotPaused` / `whenRedeemNotPaused`).
- `MANAGER_ROLE` clears each independently via **`unpauseDeposit()`** / **`unpauseRedeem()`**.
- `depositPaused()` / `redeemPaused()` views return each flag.
- A `postPricePerShare` call that exceeds the rate-limit bucket and uses `revertOnRateLimit = false` also pauses **both** deposit and redeem automatically (see **Exchange rate**).
- Redeem pause MUST block both `requestRedeem` and `fulfillRedeemRequests` (`whenRedeemNotPaused`).
- While `depositPaused` or `redeemPaused`: `setManagementFeeBps`, and `_harvestPerformanceFee` when PPS > HWM (`harvestPerformanceFee` / `setPerformanceFeeBps`), MUST revert `FeeManager_StrategyPaused`.

---

## Multi-Asset Deposits

The strategy accepts **multiple listed ERC-20 tokens** for deposits, each with its own pricing adapter (`IAssetConverter`) and optional deposit fee. This replaces ERC-4626 single-asset `deposit(assets, receiver)`.

### Deposit asset management

- **`addDepositAsset(address depositAsset, IAssetConverter converter, uint16 depositFeeBps)`** — Lists `depositAsset` with a converter and initial fee. Requires `MANAGER_ROLE`. `depositFeeBps` MUST be strictly less than `10_000`.
- **`removeDepositAsset(address depositAsset)`** — Removes token from the allowlist. Requires `MANAGER_ROLE`. Reverts if not listed (`StrategyDeposit_AssetNotListed`).
- **`setAssetConverter(address depositAsset, IAssetConverter converter)`** — Updates converter for a listed asset. Requires `MANAGER_ROLE`.
- **`setDepositFeeBps(address depositAsset, uint16 bps)`** — Sets deposit fee for a listed asset; `bps` MUST be strictly less than `10_000`. Requires `MANAGER_ROLE`.
- **`isDepositAsset(address depositAsset)`** — View: returns whether token is listed.
- **`depositFee(address depositAsset)`** — View: returns configured deposit fee in bps.
- **`converterOf(address depositAsset)`** — View: returns the `IAssetConverter` for a token.

### Deposit and mint

All deposit/mint paths require deposit not paused (`whenDepositNotPaused`) and are protected by `nonReentrant`.

**`deposit(address depositAsset, uint256 assets, address receiver)`** → `uint256 shares`
**`deposit(address depositAsset, uint256 assets, address receiver, uint256 minSharesOut)`** → `uint256 shares` (slippage guard: reverts if `shares < minSharesOut` with `StrategyDeposit_InsufficientSharesOut`)

**`mint(address depositAsset, uint256 shares, address receiver)`** → `uint256 assets`
**`mint(address depositAsset, uint256 shares, address receiver, uint256 maxAssetsIn)`** → `uint256 assets` (slippage cap: reverts if `assets > maxAssetsIn` with `StrategyDeposit_ExcessiveAssetsIn`)

**Deposit flow (normative):**

1. Pull `assets` of `depositAsset` from `msg.sender` via `safeTransferFrom` to the strategy.
2. Split the deposit: `fee = assets * depositFeeBps / 10_000` (floor); `net = assets - fee`.
3. If `fee > 0`: transfer `fee` of `depositAsset` to `feeTreasury`. Reverts with `StrategyDeposit_FeeTreasuryNotSet` if `feeTreasury == address(0)`. Emits `DepositFeeTransferred`.
4. Convert `net` to strategy base units via `IAssetConverter(converter).toBaseUnits(net, Floor)`.
5. Convert base units to shares via `_convertToShares(baseUnits, Floor)`.
6. Mint shares to `receiver`. Emits `Deposit(sender, receiver, depositAsset, net, shares, fee)` where `net` and `fee` are the post-split `depositAsset` amounts; gross transferred = `net + fee`.
7. If `defaultShard != address(0)` and `net > 0`: transfer `net` of `depositAsset` to `defaultShard`. Emits `DepositRoutedToDefaultShard`.

**Bounds:**

- `maxDeposit(depositAsset, receiver)` → `0` if paused or unlisted; otherwise `type(uint256).max`.
- `maxMint(depositAsset, receiver)` → `0` if paused or unlisted; otherwise `type(uint256).max`.
- `previewDeposit(depositAsset, assets)` → shares at current NAV after deposit fee (or `0` if unlisted/zero assets).
- `previewMint(depositAsset, shares)` → gross assets required at current NAV including deposit fee (or `0` if unlisted/zero shares). Uses ceiling rounding.

**Converter previews (no fee):**

- `convertToShares(depositAsset, assets)` → shares equivalent to `assets` (using converter, no deposit fee).
- `convertToAssets(depositAsset, shares)` → asset units equivalent to `shares` (using converter, floor rounding).

### Default shard

- **`setDefaultShard(address shard)`** — Sets the shard that receives `net` deposit tokens after each deposit. `shard` MUST be a registered shard or `address(0)` (to disable). Requires `MANAGER_ROLE`. Emits `DefaultShardSet`.
- **`defaultShard()`** — View: returns configured default shard address (or zero).
- When `deregisterShard` is called for the current `defaultShard`, the default is automatically cleared to `address(0)`.

---

## Fee System

`FeeManagerUpgradeable` adds management and performance fees, both minted as new strategy shares. Fee **rates** are set by `DEFAULT_ADMIN_ROLE`. Management fee accrues automatically (no harvest entrypoint). Performance fee is harvested by `PERF_FEE_CLAIM_ROLE` via `harvestPerformanceFee`.

### Management fee

Time-based annual fee accruing on total supply. Accrual runs **automatically** inside deposit / redeem-request (and on `setManagementFeeBps`) via `_accrueManagementFee`, which mints grossed-up dilution shares to `managementFeeTreasury` and advances `lastFeeHarvestAt`.

Computed as (gross-up so treasury owns fraction `f = num/den` of post-mint supply):

```
num = feeBps * elapsed
den = 10_000 * 365 days
shares = totalSupply * num / (den - num)   // floor
```

- **`setManagementFeeBps(uint16 bps)`** — Sets annual rate; `bps` MUST be strictly less than `10_000`. Accrues (may mint) at the prior rate first. Emits `ManagementFeeBpsSet`. MUST NOT be called between an operator NAV snapshot and `postPricePerShare`. Reverts `FeeManager_StrategyPaused` when `depositPaused` or `redeemPaused`.
- **`setManagementFeeTreasury(address treasury)`** — Recipient for management-fee share mints; must not be zero. Requires `MANAGER_ROLE`. Emits `ManagementFeeTreasurySet`.
- **`managementFee()`** → `(feeBps, lastHarvestAt, managementFeeTreasury)`.

### Performance fee

HWM-based fee: triggers when `pricePerShare` exceeds the stored high-water mark. Computed on the gain above HWM:

```
gainShares = totalSupply * (pps - hwm) / hwm
shares = gainShares * feeBps / 10_000
```

- **`setPerformanceFeeBps(uint16 bps, address feeRecipient, bool forfeitAccrued)`** — Sets fee rate; `bps` MUST be strictly less than `10_000`. `feeRecipient` MUST be non-zero (reverts `FeeManager_FeeRecipientRequired`), including when `pps <= hwm`, accrued shares round to zero, or `forfeitAccrued` is true. Settles accrued performance fee at the prior rate when `pps > hwm` (raises HWM; mints unless `forfeitAccrued`), then stores the new bps. If `pps <= hwm`, nothing is settled and HWM is unchanged. Emits `PerformanceFeeBpsSet`. MUST NOT be called between an operator NAV snapshot and `postPricePerShare`. Reverts `FeeManager_StrategyPaused` when `depositPaused` or `redeemPaused` and `pps > hwm`.
- **`harvestPerformanceFee(address to)`** — `to` MUST be non-zero (reverts `FeeManager_FeeRecipientRequired`), including when `pps <= hwm` or computed shares round to zero. When `pps > hwm`, raises HWM to current `pricePerShare`, then mints to `to` if `shares > 0`. If `shares == 0`, returns without mint/event but HWM is already raised. If `pps <= hwm`, returns unchanged. Requires `PERF_FEE_CLAIM_ROLE`. Emits `PerformanceFeeHarvested(to, shares, oldHWM, newHWM)` only on mint. MUST NOT be called between an operator NAV snapshot and `postPricePerShare`. Reverts `FeeManager_StrategyPaused` when `depositPaused` or `redeemPaused` and `pps > hwm`.
- **`performanceFee()`** → `(feeBps, previewShares, performanceHighWaterMark)`. `previewShares` is 0 when at/below HWM **or** when fee shares floor to 0 (a zero-share harvest above HWM still raises HWM).

**Accepted tradeoff — dust HWM free-roll:** `_harvestPerformanceFee` assigns `highWaterMark = pps` before the `shares == 0` early-return. Dust PPS ups that floor fee shares to 0 still ratchet HWM, so a later harvest only charges residual gain above the free-rolled mark. Holder-favorable (no dilution); ops footgun if `PERF_FEE_CLAIM_ROLE` harvests on every tiny PPS post. Prefer batching until `performanceFee().previewShares > 0`.

### Fee treasury

- **`setFeeTreasury(address treasury)`** — Sets the protocol fee recipient for deposit fees and redeem fee shares. Must not be zero. Requires `MANAGER_ROLE`. Emits `FeeTreasurySet`.
- **`feeTreasury()`** — View: returns configured treasury address.
- Management-fee mints go to `managementFeeTreasury` (separate). Performance-fee mints go to the `to` / `feeRecipient` argument of the harvest or `setPerformanceFeeBps` call (not necessarily `feeTreasury()`).

---

## Accounting and `totalAssets`

- **`asset()`** — Returns the underlying ERC-20 (set at initialization). Same token used for async redemption payout and strategy funding.
- **`pricePerShare`** — Stored exchange rate: asset wei per `10 ** decimals()` share units. Initialized to `10 ** decimals()` (1:1) on deployment.
- **`totalAssets()`** MUST equal `totalSupply() * pricePerShare / 10 ** decimals()` (floor). It is **not** a raw ERC-20 balance sum. The rate is posted externally and reflects the economic NAV of the strategy portfolio.
- **`_convertToShares(assets, rounding)`** = `assets * 10 ** decimals() / pricePerShare`.
- **`_convertToAssets(shares, rounding)`** = `shares * pricePerShare / 10 ** decimals()`.
- If `pricePerShare == 0` (theoretically unreachable after init), all conversions return `0`.

---

## Exchange rate (`pricePerShare`)

`pricePerShare` is the posted exchange rate (asset wei per `10 ** decimals()` shares). It moves **only** through `postPricePerShare`; fee share mints do not rebase it.

### Effective share supply

Reconciliation uses `_effectiveShareSupply()`, not bare `totalSupply()`:

- **Default** (`StrategyBaseUpgradeable`): `totalSupply()`.
- **Async redemption** (`AsyncRedemptionUpgradeable`): `totalSupply() + totalPendingShares()`. Pending (burned-but-unfulfilled) shares leave circulating supply on `requestRedeem`, but their backing remains in the vault until `fulfillRedeemRequests`.

Operators MUST snapshot `effectiveSupplyAtSnapshot` with the **same** definition the strategy uses on-chain. For async strategies that is `totalSupply() + totalPendingShares()` — **not** `totalSupply()` alone. Omitting pending shares concentrates any NAV loss/gain onto the residual circulating supply.

### `postPricePerShare`

**`postPricePerShare(uint256 navAtSnapshot, uint256 effectiveSupplyAtSnapshot, bool revertOnRateLimit)`**

- Requires `PRICE_SETTER_ROLE`. Also gated by ERC-20 transfer pause (`whenNotPaused`).
- Reverts `Strategy_ZeroNavAtSnapshot` / `Strategy_ZeroSharesAtSnapshot` on zero inputs.
- Reverts `Strategy_PricePerSharePaused` when deposit or redeem is paused. After a circuit-breaker trip, unpause and corrective `postPricePerShare` MUST be in the same transaction.

**Declared vs reconciled:**

1. `declaredPricePerShare = navAtSnapshot × oneShare / effectiveSupplyAtSnapshot` (floor). Pure snapshot rate.
2. Let `effectiveSupplyNow = _effectiveShareSupply()`.
3. If `effectiveSupplyNow == 0`: store `declaredPricePerShare`.
4. Else reconcile the net effective-supply delta at the **still-stored** PPS with a **single** Floor in PPS-scaled space (no intermediate asset-space rounding):
   - shares added → `priceToSet = (navAtSnapshot × oneShare + Δ × oldPPS) / effectiveSupplyNow` (floor);
   - shares removed → `priceToSet = (navAtSnapshot × oneShare − Δ × oldPPS) / effectiveSupplyNow` (floor). Reverts `Strategy_InsufficientNavForReconciliation` when `navAtSnapshot × oneShare < Δ × oldPPS` (removed shares valued at the still-stored PPS exceed the snapshot NAV). Mitigate by re-taking `navAtSnapshot` / `effectiveSupplyAtSnapshot` after mid-epoch fulfills, or by avoiding fulfills between snapshot and post during large declared drawdowns.
5. A redeem *request* (circulating → pending) does **not** change effective supply, so it neither adds nor removes backing in step 4 — that is what prevents mid-epoch exits from concentrating a NAV loss onto residual holders. Fulfillment (backing paid out) decreases effective supply and is reconciled as a removal. Same-epoch deposits are priced at the stale PPS, so a frontrunning deposit cannot inflate the post-update NAV.

**Accepted tradeoff — fused plain mul (single Floor):** Step 4 forms the full numerator with Solidity `*` / `+` / `−` then one floor `/` (avoids split `mulDiv` Floor/Ceil 1-wei PPS drops). Plain `uint256` products panic on overflow (`0x11`) more often than 512-bit `mulDiv`. **Accepted — does not restrict expected ops:** overflow needs unrealistic magnitudes (e.g. `oneShare = 10**18` → `navAtSnapshot > floor(2**256 / 10**18) ≈ 1.15e59`, or similarly absurd `Δ × oldPPS`). Boundary `nav = floor(uint256.max / oneShare)` still posts. The InsufficientNav check is the same numerator compare (`nav × oneShare < Δ × oldPPS`); near-equality dust that would fail a split Floor/Ceil quotient check instead hits `Strategy_ZeroPricePerShare` — crisis post still fails.
**Accepted tradeoff — net Δ @ stored PPS:** Step 4 uses a single net \(\Delta = S_{\mathrm{now}} - S_{\mathrm{snap}}\) valued at the still-stored PPS. The protocol does **not** track gross deposits, fee mints, and fulfill payouts separately. Temporary mis-valuation is corrected on a later inclusive `postPricePerShare` (true `navAtSnapshot`, \(\Delta \approx 0\), or fee supply already in the snapshot). Interim `totalAssets()` / posted PPS are **posted**, not exact economic NAV, when material mid-epoch flow occurred since the last inclusive snapshot.

Expected consequences:

- **Deposits** — Assets arrived at stored PPS; valuing additions at `oldPPS` is correct for that leg.
- **Fee mints** — No asset inflow; valuing at `oldPPS` does not dilute that post. Dilution lands when a later snapshot includes fee supply against true NAV (`nav / supply` falls). Until then `totalAssets()` may overstate economic NAV.
- **Fulfill removals** — Payout is `min(request PPS, current PPS)` but removals reconcile at `oldPPS`. A PPS-rise fulfill between snapshot and post leaves surplus in the vault for remaining holders (later clean post).
- **Heterogeneous netting** — Opposing legs that cancel in share count (deposit @ stored PPS + fulfill @ earlier request PPS) yield \(\Delta = 0\) and no reconcile adjustment even when asset deltas do not cancel; posted PPS can understate residual NAV until the next inclusive post.
- **Deposit into unreflected surplus** — After a below-`oldPPS` fulfill, posted PPS can lag true PPS; a deposit in that window mints at the understated rate and can capture part of the surplus. Bound \(\approx\) shares \(\times (\mathrm{oldPPS} - \mathrm{requestPPS})\). Mitigate operationally (below), not with gross-flow accounting.

**Correcting post vs pending redeems (expected):** If a holder `requestRedeem`s while posted PPS still overstates economic NAV (e.g. after fee mints since the last inclusive snapshot), `pendingAssets` may lock a high ceiling. After a correcting `postPricePerShare` whose snapshot includes those fee shares, current PPS is diluted and fulfillment pays only `shares × currentPPS`. Stored `pendingAssets` is not rewritten; clipping is at fulfill time.

**Operational expectations:**

- Operator / role-gated supply movers — `fulfillRedeemRequests`, `harvestPerformanceFee`, `setManagementFeeBps`, `setPerformanceFeeBps` — MUST NOT run between the operator's NAV/`effectiveSupply` snapshot and `postPricePerShare` (they change mid-epoch Δ that reconciliation folds at stored PPS). User `deposit` / `mint` / `requestRedeem` are out of that MUST NOT (permissionless); ops still SHOULD keep the snapshot→post window short.
- `PRICE_SETTER_ROLE` SHOULD post on a cadence that keeps posted PPS aligned with economics; snapshot after material fee mints and after material mid-epoch fulfills when surplus or netting bias matters.
- Prefer re-taking `navAtSnapshot` / `effectiveSupplyAtSnapshot` after mid-epoch fulfills (or avoid fulfilling between snapshot and post during large declared drawdowns) — also avoids `Strategy_InsufficientNavForReconciliation`.
- Keep the gap between `fulfillRedeemRequests` and the next inclusive post short when deposit is open (bounds the surplus-deposit window).
- Integrators MUST NOT treat mid-epoch `totalAssets()` as exact economic NAV after fee mints or after PPS-rise fulfills since the last inclusive snapshot.

`totalAssets()` (= `totalSupply() × pricePerShare / oneShare`) reports only **circulating**-share backing; any pending/reserved fraction stays in the vault for its claimants.

### Rate limiter

Subject to a **`PriceRateLimiter`** leaky bucket (micro-bps capacity / refill). The limiter measures the **reconciled** relative move (old → stored PPS). Mid-epoch flow can shrink or amplify that delta versus the pure snapshot (declared) move:

- Within capacity → consume capacity, set the **reconciled** price, emit `PricePerShareUpdated`.
- Over capacity and `revertOnRateLimit == true` → revert `PriceRateLimiterRateLimitExceeded`.
- Over capacity and `revertOnRateLimit == false` → drain the bucket, set the reconciled price, **pause both** deposit and redeem (circuit breaker).

**Accepted tradeoff — sub-quantum refill discard:** `_refill` credits `added = (elapsed × refillRate) >> 32` (floor) and `_checkpoint` still sets `lastRefill = block.timestamp` when `added == 0`, discarding fractional progress. Successful `postPricePerShare` (including zero-delta) checkpoints, so posting more often than the refill quantum (`≈ 2^32 / refillRate`; ~20 min weekly / ~62 s daily on the 500 / 1400 micro-bps configs) never refills — effective **one-shot** until a quiet gap ≥ one quantum. **Accepted — trusted `PRICE_SETTER`:** no permissionless exploit; a setter can pin an empty bucket so later corrections must wait or soft-overflow (pause). Operators SHOULD space successful posts ≥ one quantum when continuous refill is required.

**Accepted tradeoff — reconciled gate:** A mid-epoch deposit/mint can shrink the measured move vs the declared snapshot rate (e.g. declared −50% → reconciled −25%) and suppress hard-revert / soft auto-pause that would have fired on declared alone. **Accepted — no attacker profit:** the gated magnitude is the **stored** PPS; additions reconcile at still-stored PPS (no share windfall); exit is async + `PAY_REDEMPTIONS_ROLE` (≥1 block). Mid-epoch fulfills (role-gated; MUST NOT in the snapshot→post window) can amplify a drawdown and trip sooner.

**`setPricePerShareRateLimit(uint32 maxBucketBps, uint64 refillRate)`** — Configures the bucket. Requires `MANAGER_ROLE` (separate from `PRICE_SETTER_ROLE` by design). The bucket is **zeroed at init**; `MANAGER_ROLE` MUST configure it before any non-zero move is allowed.

**`pricePerShareRateLimiterState()`** — View: current bucket state with refill virtually applied.

Each successful update MUST emit **`PricePerShareUpdated(uint256 pricePerShare, uint256 nav, uint64 postedAt)`** where `nav = totalAssets()` (with the new PPS) and `postedAt = block.timestamp`.

---

## Shard integration (`IStrategy`)

- **`registerShard(address shard)`** — Adds `shard` to the funding whitelist. Requires `DEFAULT_ADMIN_ROLE`. Reverts if already registered (`Strategy_ShardAlreadyRegistered`). Emits `ShardRegistered(shard, caller)`. Does **not** establish a token allowance.
- **`deregisterShard(address shard)`** — Removes `shard` from the whitelist. Requires `MANAGER_ROLE`. Reverts if not registered (`Strategy_ShardNotRegistered`). Emits `ShardDeregistered(shard, caller)`. Clears `defaultShard` if it equals the removed shard.
- **`isRegisteredShard(address shard)`** — View: returns whether `shard` is in the whitelist.
- **`requestFunding(IERC20 token, uint256 amount)`** — Called by a registered shard; the strategy transfers `amount` of `token` to `msg.sender` via `safeTransfer`. Reverts if caller is not registered (`Strategy_ShardNotRegistered`). Reverts if `token` is the strategy share token (`Strategy_ShareTransferNotAllowed`). Reverts if `amount == 0` (`Strategy_ZeroAmount`). Emits `FundingRequested(shard, token, amount)`. Protected by `nonReentrant`.
- **No dedicated allowance restore**: there is no allowance to restore; the strategy transfers directly on `requestFunding`.

---

## Async Redemptions

### `requestRedeem`

**`requestRedeem(uint256 shares, address owner)`** → `uint256 requestId`

- Requires redeem not paused (`whenRedeemNotPaused`). Protected by `nonReentrant`.
- `shares` MUST be non-zero (`AsyncRedemption_ZeroRedeemRequestShares`).
- If `msg.sender != owner`, allowance is spent via `_spendAllowance(owner, msg.sender, shares)`.
- **Redeem fee** (if configured and treasury is set): `feeShares = shares * redeemFeeBps / 10_000` (floor). Fee shares are transferred from `owner` to `feeTreasury`. Emits `RedeemFeeCharged(treasury, feeShares)`.
- `netShares = shares - feeShares`. Burns `netShares` from `owner`.
- `assets = _convertToAssets(netShares, Floor)`.
- Assigns a new non-zero `requestId` via `++nextRequestId` (starting from `1`).
- Records `RedeemRequest { pendingShares: netShares, pendingAssets: assets, owner }`.
- Updates global `totalPendingShares` and `totalPendingAssets`.
- Emits `RedeemRequested(requestId, owner, caller, assets, shares, feeShares)` where `shares = netShares` (burned for the request, matches `RedeemRequest.pendingShares`), `assets = pendingAssets = _convertToAssets(netShares, Floor)` (ceiling locked at request; actual fulfillment payout may be lower — see **Redemption fulfillment**), and `feeShares` is the fee transferred to the treasury. The gross requested amount is `shares + feeShares`.

**Returns** unique non-zero `requestId`.

### `setRedeemFeeBps` / `redeemFee`

- **`setRedeemFeeBps(uint16 bps)`** — Sets redeem fee; `bps` MUST be strictly less than `10_000`. Requires `DEFAULT_ADMIN_ROLE`. Emits `RedeemFeeBpsSet(bps)`.
- **`redeemFee()`** — View: returns current redeem fee in bps.

### Request queries

- **`pendingRedeemRequest(uint256 requestId)`** — Returns `pendingShares` for `requestId`.
- **`claimableRedeemRequest(uint256)`** — Always returns `0`; there is no separate claimable buffer.

### Redemption fulfillment

**`fulfillRedeemRequests(uint256[] calldata requestIds)`**

- Requires **`PAY_REDEMPTIONS_ROLE`**. Protected by `nonReentrant`. Requires redeem not paused (`whenRedeemNotPaused`).
- MUST NOT be called between an operator NAV snapshot and `postPricePerShare` (decreases `_effectiveShareSupply` and is folded into mid-epoch reconciliation).
- For each `requestId`: if `pendingAssets == 0`, reverts `AsyncRedemption_NothingToFulfill(requestId)`.
- Enforces a one-block minimum delay (`AsyncRedemption_FulfillTooEarly` if `block.number <= requestBlock`).
- **Payout** = `min(pendingAssets, _convertToAssets(pendingShares, Floor))` — i.e. `min(request PPS, current PPS)` in asset terms. A PPS drop after the request cannot pay more than current NAV for the burned shares; a PPS rise leaves surplus in the vault for remaining holders (later inclusive `postPricePerShare`; see **Exchange rate** § Accepted tradeoff). If `pendingAssets` was locked while posted PPS temporarily overstated NAV (fee mints not yet in an operator snapshot), a later correcting post that includes those fee shares dilutes current PPS and fulfillment pays only `shares × currentPPS`.
- Subtracts full `pendingShares` / `pendingAssets` from global totals (clears the ticket), even when payout is below `pendingAssets`.
- Deletes the request record.
- Transfers **`payout`** of `asset()` directly to request `owner` via `safeTransfer`. Emits `Redeem(msgSender, owner, payout, shares)`.
- After all requests: emits `RedeemRequestsFulfilled(requestIds)`.
- The strategy contract's `asset()` balance MUST be sufficient at transfer time; the ERC-20 transfer will revert if insufficient.

### Request IDs

- Monotonic counter (`nextRequestId`), starting from `1`. Each `requestRedeem` increments and assigns.
- `pendingRedeemRequest` and `fulfillRedeemRequests` operate per `requestId`.

---

## Implementation Shape

- **`StrategyBaseUpgradeable`** — ERC-20 strategy shares + `IStrategy` behavior (shard registry, `requestFunding`, `pricePerShare`, `postPricePerShare`, `totalAssets`, `AccessControl`, `ReentrancyGuard`, strategy operations pause). Abstract. Uses ERC-7201 namespaced storage — no `__gap` arrays.
- **`FeeManagerUpgradeable`** — Extends `StrategyBaseUpgradeable`; adds management + performance fee state and harvest logic. Abstract.
- **`MultiAssetDepositUpgradeable`** — Extends `FeeManagerUpgradeable`; adds multi-asset deposit/mint, converter registry, deposit fees, default shard routing. Abstract.
- **`AsyncRedemptionUpgradeable`** — Extends `StrategyBaseUpgradeable`; adds async redemption queues and fulfillment gated by `PAY_REDEMPTIONS_ROLE`. Abstract.
- **Concrete strategy** — e.g. **`MultiAssetWithAsyncRedemptionStrategy`** composes **`MultiAssetDepositUpgradeable`** + **`AsyncRedemptionUpgradeable`** (see contract C3 order).
- **Beacon** — Live deployment MUST use `BeaconProxy` with `UpgradeableBeacon` (**strategy** beacon, distinct from shard beacons in **002**). Updating the implementation pointer MUST be restricted to protocol admin. `constructor` empty of mutable state; `initializer` per **002** §A.1.

---

## Acceptance Criteria

1. **`IStrategy` (002)** + `requestFunding` pipe: `registerShard` by `DEFAULT_ADMIN_ROLE`; `deregisterShard` by `MANAGER_ROLE`; `requestFunding` callable only by registered shards; transfers token directly.
2. **Multi-asset deposits**: `deposit` and `mint` (both overloads each) accept listed `depositAsset`; deposit fee routed to `feeTreasury` before mint; optional default shard receives `net` tokens; `previewDeposit` / `previewMint` / `maxDeposit` / `maxMint` per **Multi-Asset Deposits**.
3. **Fee system**: management fee auto-accrues via `_accrueManagementFee` (mints to `managementFeeTreasury`); performance fee (HWM) harvested by `PERF_FEE_CLAIM_ROLE`; fee **rates** set by `DEFAULT_ADMIN_ROLE` (see `FeeManagerUpgradeable`); fees minted as shares; HWM raised on performance harvest / rate update per implementation.
4. **Async redemptions**: `requestRedeem` burns `netShares`; optional redeem fee taken as shares; `claimableRedeemRequest` always returns `0`.
5. **Redemption fulfillment**: `fulfillRedeemRequests(uint256[] requestIds)` requires `PAY_REDEMPTIONS_ROLE`; reverts `AsyncRedemption_NothingToFulfill` when nothing to pay for an id; pays `min(pendingAssets, shares × currentPPS)` to owner; emits `Redeem` per request; emits `RedeemRequestsFulfilled` after batch.
6. **Strategy operations pause**: `STRATEGY_PAUSER_ROLE` pauses; `MANAGER_ROLE` unpauses; auto-pause on rate-limit-exceeded + `revertOnRateLimit = false`.
7. **`postPricePerShare(navAtSnapshot, effectiveSupplyAtSnapshot, revertOnRateLimit)`**: declared-vs-reconciled semantics per **Exchange rate**; rate-limiter on reconciled move; `PRICE_SETTER_ROLE`; `PricePerShareUpdated` event; auto-pause deposit+redeem on excess if `revertOnRateLimit = false`.
8. **Beacon** deployment + initializer per **002** §A.1.
9. **`totalAssets()`** = `totalSupply() * pricePerShare / 10 ** decimals()` (floor); conversion functions per **Accounting**.
10. **Fee treasury**: `setFeeTreasury` / `setManagementFeeTreasury` by `MANAGER_ROLE`; flow fees use `feeTreasury`; management dilution uses `managementFeeTreasury`; performance mint recipient is the harvest/`setPerformanceFeeBps` argument.

---

## Edge Cases

- **`totalAssets()`** is derived from the posted rate, not raw ERC-20 balances.
- Redemption fulfillment uses the strategy's live `asset()` balance at transfer time; the ERC-20 transfer reverts if insufficient. Shards MUST `pushToStrategy` before an operator calls `fulfillRedeemRequests` if off-strategy custody should fund settlements.
- **Withdrawal fee of `0` bps** (or unset treasury): no shares are deducted; `netShares == shares`.
- **Rounding** follows floor/ceiling discipline in each path; extreme ratios can produce `0` shares or assets.
- **`pricePerShare` rate limiter at zero capacity** (initial state): the limiter's `_wouldExceedLimit` behavior with a zeroed bucket means the first `postPricePerShare` may succeed or trigger the limit depending on config. The `MANAGER_ROLE` holder MUST call `setPricePerShareRateLimit` before relying on the limiter.
- **Reconciled rate-limit gate (accepted):** mid-epoch deposit can shrink measured PPS move vs declared and suppress crisis auto-pause; no attacker profit (reconcile at `oldPPS`; async exit). See **Exchange rate** § Rate limiter.
- **Sub-quantum refill discard (accepted):** successful posts below the refill quantum discard remainder and prevent refill (one-shot under high-frequency posting); trusted `PRICE_SETTER`. See **Exchange rate** § Rate limiter.
- **Net-Δ reconciliation tradeoff (accepted):** mid-epoch fee mints, fulfills paid below `oldPPS`, and mixed deposit+fulfill nets can leave posted PPS / `totalAssets()` temporarily disagreeing with economic NAV; depositors may skim unreflected fulfill surplus until a later inclusive post. See **Exchange rate** § Accepted tradeoff.
- **Fused reconcil overflow (accepted):** plain `nav × oneShare` / `Δ × oldPPS` panics only for unrealistic magnitudes. See **Exchange rate** § Accepted tradeoff — fused plain mul.
- **InsufficientNav vs split Floor/Ceil (accepted):** numerator compare differs by dust; near-equality may hit `Strategy_ZeroPricePerShare` instead. See **Exchange rate** § fused plain mul.
- **Dust HWM free-roll (accepted):** `harvestPerformanceFee` raises HWM even when fee shares floor to 0; repeated dust harvests forfeit that interval’s performance fee (holder-favorable). See **Performance fee** § Accepted tradeoff.
- **Explicit non-goals (unless added later):** bridge vendor / message format; shard `exec` / Merkle allowlist (**001**) beyond **002**; async deposits; `IRedemptionPolicy`; any ERC-4626 standard `deposit(assets, receiver)` / `withdraw` / `redeem` entrypoints; `requestDeposit`; `cancelRedeemRequest`; on-chain gross-flow (per-leg) PPS reconciliation.

---

## References

- `docs/spec/002-strategy.md` — `IStrategy`, shard liquidity pipe
- `contracts/strategy/interfaces/IStrategy.sol`
- `contracts/strategy/interfaces/IAsyncRedemption.sol`
- `contracts/strategy/interfaces/IFeeManager.sol`
- `contracts/strategy/interfaces/IMultiAssetDeposit.sol`
- `contracts/strategy/StrategyBaseUpgradeable.sol`
- `contracts/strategy/FeeManagerUpgradeable.sol`
- `contracts/strategy/MultiAssetDepositUpgradeable.sol`
- `contracts/strategy/AsyncRedemptionUpgradeable.sol`
- `contracts/strategy/libraries/PriceRateLimiter.sol`
- `contracts/strategy/MultiAssetWithAsyncRedemptionStrategy.sol`
