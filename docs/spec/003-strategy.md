# Feature: Strategy share token (multi-asset deposits, async redemption, shard integration)

Normative spec for **one** deployable **strategy** (ERC-20 share token): multi-asset depositor entry and accounting with **shards** moving liquidity via **`pullFromStrategy` / `pushToStrategy`** per **`docs/spec/002-strategy.md`**. The strategy implements **async redemption** (non-standard vs ERC-4626 immediate `withdraw`/`redeem`). Deposits use a **multi-asset** model (not standard ERC-4626 `deposit(assets, receiver)`). The **`IStrategy`** surface for shards MUST match **`contracts/strategy/interfaces/IStrategy.sol`**; multi-asset deposit and redemption entrypoints are **in addition** to that interface.

---

## Goal

Deliver **`StrategyBaseUpgradeable`** (shard registry + `pricePerShare` + strategy-wide pause), fee management (**`FeeManagerUpgradeable`**), multi-asset deposit routing (**`MultiAssetDepositUpgradeable`**), and async redemption (**`AsyncRedemptionUpgradeable`**), composed into a concrete implementation behind **`BeaconProxy`** (e.g. **`MultiAssetWithAsyncRedemptionStrategy`**).

1. **Deposits** — Multi-asset `deposit` / `mint` accepting listed ERC-20s via per-token `IAssetConverter` pricing; optional deposit fees and default-shard routing.
2. **Exits** — `requestRedeem` → pending → `fulfillRedeemRequests` (requires `PAY_REDEMPTIONS_ROLE`, direct settlement). No ERC-4626 `withdraw` / `redeem`.
3. **Redemption fulfillment** — `fulfillRedeemRequests(uint256[] requestIds)` transfers `asset` directly to each request's `owner` in one pass; caller MUST hold **`PAY_REDEMPTIONS_ROLE`**.
4. **Shards** — `registerShard` / `requestFunding` pipe per **002**; no extra `IStrategy` APIs moving `asset()` outside **002**.
5. **Exchange rate** — `pricePerShare` (asset wei per `10 ** decimals()` shares) posted by `PRICE_SETTER_ROLE`; `totalAssets()` derived from this rate.
6. **Fees** — Management fee (time-based dilution) and performance fee (high-water-mark) minted as shares by `TREASURY_ROLE`.

**Architecture (fixed):** Redemption fulfillment is invoked by an account with **`PAY_REDEMPTIONS_ROLE`**, directly paying asset to each request's owner in one tx. Cross-chain pricing field `pricePerShare` MUST be writable **only** by `PRICE_SETTER_ROLE`, subject to a **rate limiter** bucket. The implementation MUST ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (strategy-dedicated beacon, same pattern as **002** §A.1).

---

## Roles

| Role                    | Constant                             | Capabilities                                                                                                                      |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`    | OZ standard                          | Grant/revoke roles; `registerShard`; add/remove deposit assets; set asset converters; other admin-only hooks                      |
| `LIMITED_ADMIN_ROLE`    | `keccak256("LIMITED_ADMIN_ROLE")`    | `deregisterShard`; `unpauseStrategyOperations`                                                                                    |
| `PRICE_SETTER_ROLE`     | `keccak256("PRICE_SETTER_ROLE")`     | `postPricePerShare`                                                                                                               |
| `STRATEGY_PAUSER_ROLE`  | `keccak256("STRATEGY_PAUSER_ROLE")`  | `pauseDeposit`, `pauseRedeem` (strategy operations pause only; not ERC-20 transfer pause)                                         |
| `TRANSFERS_PAUSER_ROLE` | `keccak256("TRANSFERS_PAUSER_ROLE")` | ERC-20 transfer pause (`pause`)                                                                                                   |
| `TREASURY_ROLE`         | `keccak256("TREASURY_ROLE")`         | `setFeeTreasury`; set/harvest management and performance fees; set deposit fee bps                                                |
| `PAY_REDEMPTIONS_ROLE`  | `keccak256("PAY_REDEMPTIONS_ROLE")`  | `fulfillRedeemRequests`                                                                                                           |
| `MANAGER_ROLE`          | `keccak256("MANAGER_ROLE")`          | `setPricePerShareRateLimit`; `setFeeTreasury`; `deregisterShard`; `setDefaultShard`; unpause strategy operations / ERC-20 unpause |

`DEFAULT_ADMIN_ROLE` is the access-control super-admin per OpenZeppelin; capabilities above reflect **intended** assignments (see source `StrategyBaseUpgradeable` / modules for exact `onlyRole` wiring).

---

## Strategy operations pause

The strategy has an **operations pause** (deposit / redemption / price post paths) separate from optional ERC-20 **transfer** pause:

- `STRATEGY_PAUSER_ROLE` calls **`pauseDeposit()`** / **`pauseRedeem()`** to block deposit and redemption entrypoints.
- `LIMITED_ADMIN_ROLE` calls **`unpauseStrategyOperations()`**. Emits `StrategyOperationsUnpaused(account)`.
- `strategyOperationsPaused()` view returns current pause state.
- A `postPricePerShare` call that exceeds the rate-limit bucket and uses `revertOnRateLimit = false` also triggers the strategy operations pause automatically (see **Cross-chain ratio**).
- Pausing MUST NOT block `fulfillRedeemRequests` (redemption fulfillment is not guarded by this pause).

---

## Multi-Asset Deposits

The strategy accepts **multiple listed ERC-20 tokens** for deposits, each with its own pricing adapter (`IAssetConverter`) and optional deposit fee. This replaces ERC-4626 single-asset `deposit(assets, receiver)`.

### Deposit asset management

- **`addDepositAsset(address depositAsset, IAssetConverter converter, uint16 depositFeeBps)`** — Lists `depositAsset` with a converter and initial fee. Requires `DEFAULT_ADMIN_ROLE`. `depositFeeBps` MUST be strictly less than `10_000`.
- **`removeDepositAsset(address depositAsset)`** — Removes token from the allowlist. Requires `DEFAULT_ADMIN_ROLE`. Reverts if not listed (`StrategyDeposit_AssetNotListed`).
- **`setAssetConverter(address depositAsset, IAssetConverter converter)`** — Updates converter for a listed asset. Requires `DEFAULT_ADMIN_ROLE`.
- **`setDepositFeeBps(address depositAsset, uint16 bps)`** — Sets deposit fee for a listed asset; `bps` MUST be strictly less than `10_000`. Requires `TREASURY_ROLE`.
- **`isDepositAsset(address depositAsset)`** — View: returns whether token is listed.
- **`depositFee(address depositAsset)`** — View: returns configured deposit fee in bps.
- **`converterOf(address depositAsset)`** — View: returns the `IAssetConverter` for a token.

### Deposit and mint

All deposit/mint paths require the strategy to not be paused (`whenStrategyNotPaused`) and are protected by `nonReentrant`.

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

- **`setDefaultShard(address shard)`** — Sets the shard that receives `net` deposit tokens after each deposit. `shard` MUST be a registered shard or `address(0)` (to disable). Requires `DEFAULT_ADMIN_ROLE`. Emits `DefaultShardSet`.
- **`defaultShard()`** — View: returns configured default shard address (or zero).
- When `deregisterShard` is called for the current `defaultShard`, the default is automatically cleared to `address(0)`.

---

## Fee System

`FeeManagerUpgradeable` adds management and performance fees, both minted as new strategy shares. Fee **rates** are set by `DEFAULT_ADMIN_ROLE`; **harvest** entrypoints use `TREASURY_ROLE` (see source for full signatures).

### Management fee

Time-based annual fee accruing on total supply. Computed as:

```
shares = totalSupply * feeBps * elapsed / (10_000 * 365 days)
```

- **`setManagementFeeBps(uint16 bps)`** — Sets annual rate; `bps` MUST be strictly less than `10_000`. Emits `ManagementFeeBpsSet`.
- **`harvestManagementFee(address to)`** — Mints accrued shares to `to` (must not be zero); resets `lastFeeHarvestAt` to `block.timestamp`. Reverts with `FeeManager_NothingToHarvest(true)` if `shares == 0`. Emits `ManagementFeeHarvested(to, shares, elapsed)`.
- **`managementFee()`** → `(feeBps, previewShares, lastHarvestAt)`.

### Performance fee

HWM-based fee: triggers when `pricePerShare` exceeds the stored high-water mark. Computed on the gain above HWM:

```
gainShares = totalSupply * (pps - hwm) / hwm
shares = gainShares * feeBps / 10_000
```

- **`setPerformanceFeeBps(uint16 bps)`** — Sets fee rate; `bps` MUST be strictly less than `10_000`. **Resets high-water mark** to current `pricePerShare`. Emits `PerformanceFeeBpsSet`.
- **`harvestPerformanceFee(address to)`** — Mints performance fee shares to `to`; raises HWM to current `pricePerShare`. Reverts with `FeeManager_PriceAtOrBelowHighWaterMark` if `pps <= hwm`. Reverts with `FeeManager_NothingToHarvest(false)` if `shares == 0`. Emits `PerformanceFeeHarvested(to, shares, oldHWM, newHWM)`.
- **`performanceFee()`** → `(feeBps, previewShares, performanceHighWaterMark)`.

### Fee treasury

- **`setFeeTreasury(address treasury)`** — Sets the protocol fee recipient for deposit fees, redeem fee shares, and future fee harvests. Must not be zero. Requires `TREASURY_ROLE`. Emits `FeeTreasurySet`.
- **`feeTreasury()`** — View: returns configured treasury address.
- The treasury address is also used by `harvestManagementFee` / `harvestPerformanceFee` callers as the `to` recipient (callers supply it explicitly; it need not equal `feeTreasury()`).

---

## Accounting and `totalAssets`

- **`asset()`** — Returns the underlying ERC-20 (set at initialization). Same token used for async redemption payout and strategy funding.
- **`pricePerShare`** — Stored exchange rate: asset wei per `10 ** decimals()` share units. Initialized to `10 ** decimals()` (1:1) on deployment.
- **`totalAssets()`** MUST equal `totalSupply() * pricePerShare / 10 ** decimals()` (floor). It is **not** a raw ERC-20 balance sum. The rate is posted externally and reflects the economic NAV of the strategy portfolio.
- **`_convertToShares(assets, rounding)`** = `assets * 10 ** decimals() / pricePerShare`.
- **`_convertToAssets(shares, rounding)`** = `shares * pricePerShare / 10 ** decimals()`.
- If `pricePerShare == 0` (theoretically unreachable after init), all conversions return `0`.

---

## Cross-chain Ratio (`pricePerShare`)

- **`postPricePerShare(uint256 newPricePerShare, bool revertOnRateLimit)`** — Updates `pricePerShare`. Requires `PRICE_SETTER_ROLE`. Reverts if `newPricePerShare == 0` (`Strategy_ZeroPricePerShare`). Reverts if strategy operations are paused.
- Subject to a **`PriceRateLimiter` bucket** (micro-bps capacity / refill model). The limiter measures the relative price move as bps and compares to remaining bucket capacity:
  - If the move fits within capacity: consume capacity, set price, emit `PricePerShareUpdated`.
  - If the move exceeds capacity and `revertOnRateLimit == true`: revert (`PriceRateLimiterRateLimitExceeded`).
  - If the move exceeds capacity and `revertOnRateLimit == false`: drain the bucket, set the price, **pause strategy operations** (`_pauseStrategy`), emit `PricePerShareUpdated` and `StrategyOperationsPaused`.
- **`setPricePerShareRateLimit(uint32 maxBucketBps, uint64 refillRate)`** — Configures the rate-limiter bucket. Requires `MANAGER_ROLE`. This is a safety catch controlled by a separate role from `PRICE_SETTER_ROLE`, with the intent that different parties perform each operation — reducing single-point-of-failure risk.
- **`pricePerShareRateLimiterState()`** — View: returns current bucket state with refill virtually applied.
- Each successful update MUST emit **`PricePerShareUpdated(uint256 pricePerShare, uint256 nav, uint64 postedAt)`** where `nav = totalAssets()` (computed with the new PPS) and `postedAt = block.timestamp`.

---

## Shard integration (`IStrategy`)

- **`registerShard(address shard)`** — Adds `shard` to the funding whitelist. Requires `DEFAULT_ADMIN_ROLE`. Reverts if already registered (`Strategy_ShardAlreadyRegistered`). Emits `ShardRegistered(shard, caller)`. Does **not** establish a token allowance.
- **`deregisterShard(address shard)`** — Removes `shard` from the whitelist. Requires `LIMITED_ADMIN_ROLE`. Reverts if not registered (`Strategy_ShardNotRegistered`). Emits `ShardDeregistered(shard, caller)`. Clears `defaultShard` if it equals the removed shard.
- **`isRegisteredShard(address shard)`** — View: returns whether `shard` is in the whitelist.
- **`requestFunding(IERC20 token, uint256 amount)`** — Called by a registered shard; the strategy transfers `amount` of `token` to `msg.sender` via `safeTransfer`. Reverts if caller is not registered (`Strategy_ShardNotRegistered`). Reverts if `token` is the strategy share token (`Strategy_ShareTransferNotAllowed`). Reverts if `amount == 0` (`Strategy_ZeroAmount`). Emits `FundingRequested(shard, token, amount)`. Protected by `nonReentrant`.
- **No dedicated allowance restore**: there is no allowance to restore; the strategy transfers directly on `requestFunding`.

---

## Async Redemptions

### `requestRedeem`

**`requestRedeem(uint256 shares, address owner)`** → `uint256 requestId`

- Requires strategy operations not paused (`whenStrategyNotPaused`). Protected by `nonReentrant`.
- `shares` MUST be non-zero (`AsyncRedemption_ZeroRedeemRequestShares`).
- If `msg.sender != owner`, allowance is spent via `_spendAllowance(owner, msg.sender, shares)`.
- **Redeem fee** (if configured and treasury is set): `feeShares = shares * redeemFeeBps / 10_000` (floor). Fee shares are transferred from `owner` to `feeTreasury`. Emits `RedeemFeeCharged(treasury, feeShares)`.
- `netShares = shares - feeShares`. Burns `netShares` from `owner`.
- `assets = _convertToAssets(netShares, Floor)`.
- Assigns a new non-zero `requestId` via `++nextRequestId` (starting from `1`).
- Records `RedeemRequest { pendingShares: netShares, pendingAssets: assets, owner }`.
- Updates global `totalPendingShares` and `totalPendingAssets`.
- Emits `RedeemRequested(requestId, owner, caller, assets, shares, feeShares)` where `shares = netShares` (burned for the request, matches `RedeemRequest.pendingShares`), `assets = pendingAssets = _convertToAssets(netShares, Floor)` (paid on fulfillment), and `feeShares` is the fee transferred to the treasury. The gross requested amount is `shares + feeShares`.

**Returns** unique non-zero `requestId`.

### `setRedeemFeeBps` / `redeemFee`

- **`setRedeemFeeBps(uint16 bps)`** — Sets redeem fee; `bps` MUST be strictly less than `10_000`. Requires `DEFAULT_ADMIN_ROLE`. Emits `RedeemFeeBpsSet(bps)`.
- **`redeemFee()`** — View: returns current redeem fee in bps.

### Request queries

- **`pendingRedeemRequest(uint256 requestId)`** — Returns `pendingShares` for `requestId`.
- **`claimableRedeemRequest(uint256)`** — Always returns `0`; there is no separate claimable buffer.

### Redemption fulfillment

**`fulfillRedeemRequests(uint256[] calldata requestIds)`**

- Requires **`PAY_REDEMPTIONS_ROLE`**. Protected by `nonReentrant`. **Not** guarded by strategy operations pause.
- For each `requestId`: if `pendingAssets == 0`, reverts `AsyncRedemption_NothingToFulfill(requestId)`.
- Subtracts from global `totalPendingShares` and `totalPendingAssets`.
- Deletes the request record.
- Transfers `pendingAssets` of `asset()` directly to request `owner` via `safeTransfer`. Emits `Redeem(msgSender, owner, assets, shares)`.
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

1. **`IStrategy` (002)** + `requestFunding` pipe: `registerShard` by `DEFAULT_ADMIN_ROLE`; `deregisterShard` by `LIMITED_ADMIN_ROLE`; `requestFunding` callable only by registered shards; transfers token directly.
2. **Multi-asset deposits**: `deposit` and `mint` (both overloads each) accept listed `depositAsset`; deposit fee routed to `feeTreasury` before mint; optional default shard receives `net` tokens; `previewDeposit` / `previewMint` / `maxDeposit` / `maxMint` per **Multi-Asset Deposits**.
3. **Fee system**: management fee (time-based, `TREASURY_ROLE` harvests) and performance fee (HWM, `TREASURY_ROLE` harvests); fee **rates** set by `DEFAULT_ADMIN_ROLE` (see `FeeManagerUpgradeable`); fees minted as shares; HWM resets on performance fee rate updates per implementation.
4. **Async redemptions**: `requestRedeem` burns `netShares`; optional redeem fee taken as shares; `claimableRedeemRequest` always returns `0`.
5. **Redemption fulfillment**: `fulfillRedeemRequests(uint256[] requestIds)` requires `PAY_REDEMPTIONS_ROLE`; reverts `AsyncRedemption_NothingToFulfill` when nothing to pay for an id; transfers `asset` to owner; emits `Redeem` per request; emits `RedeemRequestsFulfilled` after batch.
6. **Strategy operations pause**: `STRATEGY_PAUSER_ROLE` pauses; `MANAGER_ROLE` unpauses; auto-pause on rate-limit-exceeded + `revertOnRateLimit = false`.
7. **`postPricePerShare(uint256, bool)`**: rate-limiter bucket; `PRICE_SETTER_ROLE`; `PricePerShareUpdated` event; auto-pause on excess if `revertOnRateLimit = false`.
8. **Beacon** deployment + initializer per **002** §A.1.
9. **`totalAssets()`** = `totalSupply() * pricePerShare / 10 ** decimals()` (floor); conversion functions per **Accounting**.
10. **Fee treasury**: `setFeeTreasury` by `TREASURY_ROLE`; used for deposit fees, redeem fee shares.

---

## Edge Cases

- **`totalAssets()`** is derived from the posted rate, not raw ERC-20 balances.
- Redemption fulfillment uses the strategy's live `asset()` balance at transfer time; the ERC-20 transfer reverts if insufficient. Shards MUST `pushToStrategy` before an operator calls `fulfillRedeemRequests` if off-strategy custody should fund settlements.
- **Withdrawal fee of `0` bps** (or unset treasury): no shares are deducted; `netShares == shares`.
- **Rounding** follows floor/ceiling discipline in each path; extreme ratios can produce `0` shares or assets.
- **`pricePerShare` rate limiter at zero capacity** (initial state): the limiter's `_wouldExceedLimit` behavior with a zeroed bucket means the first `postPricePerShare` may succeed or trigger the limit depending on config. The `MANAGER_ROLE` holder MUST call `setPricePerShareRateLimit` before relying on the limiter.
- **Explicit non-goals (unless added later):** bridge vendor / message format; shard `exec` / Merkle allowlist (**001**) beyond **002**; async deposits; `IRedemptionPolicy`; any ERC-4626 standard `deposit(assets, receiver)` / `withdraw` / `redeem` entrypoints; `requestDeposit`; `cancelRedeemRequest`.

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
