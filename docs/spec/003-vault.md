# Feature: Vault (Multi-Asset Deposits, Async Redemption, Strategy Integration)

Normative spec for **one** deployable vault: multi-asset depositor entry and accounting with **Strategies** moving liquidity via **`pullFromVault` / `pushToVault`** per **`docs/spec/002-strategy.md`**. The vault implements **async redemption** (non-standard vs ERC-4626 immediate `withdraw`/`redeem`). Deposits use a **multi-asset** model (not standard ERC-4626 `deposit(assets, receiver)`). The **`IVault`** interface for Strategies MUST match **`contracts/vault/interfaces/IVault.sol`**; multi-asset deposit and redemption entrypoints are **in addition** to that interface.

---

## Goal

Deliver a **`VaultBase`** core (strategy registry + `pricePerShare` + vault-wide pause), fee management (**`FeeManagerUpgradeable`**), multi-asset deposit routing (**`MultiAssetDepositUpgradeable`**), and async redemption (**`AsyncRedemptionUpgradeable`**), composed into a concrete vault behind **`BeaconProxy`**.

1. **Deposits** — Multi-asset `deposit` / `mint` accepting listed ERC-20s via per-token `IAssetConverter` pricing; optional deposit fees and default-strategy routing.
2. **Exits** — `requestRedeem` → pending → `fulfillRedeemRequests` (operator-authorized, direct settlement). No ERC-4626 `withdraw` / `redeem`.
3. **Redemption fulfillment** — `fulfillRedeemRequests(uint256[] requestIds)` transfers `asset` directly to each request's `owner` in one pass; caller MUST hold **`OPERATOR_ROLE`**.
4. **Strategies** — `registerStrategy` + `requestFunding` pipe per **002**; no extra Vault APIs moving `asset()` outside **002**.
5. **Exchange rate** — `pricePerShare` (asset wei per `10 ** decimals()` shares) posted by `PRICE_MANAGER_ROLE`; `totalAssets()` derived from this rate.
6. **Fees** — Management fee (time-based dilution) and performance fee (high-water-mark) minted as shares by `TREASURY_ROLE`.

**Architecture (fixed):** Redemption fulfillment is invoked by an account with **`OPERATOR_ROLE`**, directly paying asset to each request's owner in one tx. Cross-chain pricing field `pricePerShare` MUST be writable **only** by `PRICE_MANAGER_ROLE`, subject to a **rate limiter** bucket. The implementation MUST ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (Vault-dedicated beacon, same pattern as **002** §A.1).

---

## Roles

| Role                     | Constant                              | Capabilities                                                                                                                                    |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`     | OZ standard                           | Grant/revoke all roles; unpause vault operations; set default strategy; add/remove deposit assets; set asset converters                         |
| `STRATEGY_DEPLOYER_ROLE` | `keccak256("STRATEGY_DEPLOYER_ROLE")` | `registerStrategy`, `deregisterStrategy`                                                                                                        |
| `PRICE_MANAGER_ROLE`     | `keccak256("PRICE_MANAGER_ROLE")`     | `postPricePerShare`; configure rate limiter                                                                                                     |
| `PAUSER_ROLE`            | `keccak256("PAUSER_ROLE")`            | `pauseVaultOperations`                                                                                                                          |
| `TREASURY_ROLE`          | `keccak256("TREASURY_ROLE")`          | `setFeeTreasury`; set/harvest management and performance fees; set deposit fee bps; set withdrawal fee bps; set global `maxRedeemRequestShares` |
| `OPERATOR_ROLE`          | `keccak256("OPERATOR_ROLE")`          | `fulfillRedeemRequests`                                                                                                                         |

`DEFAULT_ADMIN_ROLE` MUST grant/revoke all other roles.

---

## Vault Pause

The vault has a **vault-level operations pause** separate from ERC-20 transfer pause:

- `PAUSER_ROLE` calls **`pauseVaultOperations()`** to block deposit and redemption entrypoints (`whenVaultNotPaused` guard). Emits `VaultOperationsPaused(account)`.
- Only `DEFAULT_ADMIN_ROLE` may call **`unpauseVaultOperations()`**. Emits `VaultOperationsUnpaused(account)`.
- `vaultOperationsPaused()` view returns current pause state.
- A `postPricePerShare` call that exceeds the rate-limit bucket and uses `revertOnRateLimit = false` also triggers the vault pause automatically (see **Cross-chain ratio**).
- Pausing MUST NOT block `fulfillRedeemRequests` (redemption fulfillment is not guarded by this pause).

---

## Multi-Asset Deposits

The vault accepts **multiple listed ERC-20 tokens** for deposits, each with its own pricing adapter (`IAssetConverter`) and optional deposit fee. This replaces ERC-4626 single-asset `deposit(assets, receiver)`.

### Deposit asset management

- **`addDepositAsset(address depositAsset, IAssetConverter converter, uint16 depositFeeBps)`** — Lists `depositAsset` with a converter and initial fee. Requires `DEFAULT_ADMIN_ROLE`. `depositFeeBps` MUST be strictly less than `10_000`.
- **`removeDepositAsset(address depositAsset)`** — Removes token from the allowlist. Requires `DEFAULT_ADMIN_ROLE`. Reverts if not listed (`VaultDeposit_AssetNotListed`).
- **`setAssetConverter(address depositAsset, IAssetConverter converter)`** — Updates converter for a listed asset. Requires `DEFAULT_ADMIN_ROLE`.
- **`setDepositFeeBps(address depositAsset, uint16 bps)`** — Sets deposit fee for a listed asset; `bps` MUST be strictly less than `10_000`. Requires `TREASURY_ROLE`.
- **`isDepositAsset(address depositAsset)`** — View: returns whether token is listed.
- **`depositFee(address depositAsset)`** — View: returns configured deposit fee in bps.
- **`converterOf(address depositAsset)`** — View: returns the `IAssetConverter` for a token.

### Deposit and mint

All deposit/mint paths require vault to not be paused (`whenVaultNotPaused`) and are protected by `nonReentrant`.

**`deposit(address depositAsset, uint256 assets, address receiver)`** → `uint256 shares`
**`deposit(address depositAsset, uint256 assets, address receiver, uint256 minSharesOut)`** → `uint256 shares` (slippage guard: reverts if `shares < minSharesOut` with `VaultDeposit_InsufficientSharesOut`)

**`mint(address depositAsset, uint256 shares, address receiver)`** → `uint256 assets`
**`mint(address depositAsset, uint256 shares, address receiver, uint256 maxAssetsIn)`** → `uint256 assets` (slippage cap: reverts if `assets > maxAssetsIn` with `VaultDeposit_ExcessiveAssetsIn`)

**Deposit flow (normative):**

1. Pull `assets` of `depositAsset` from `msg.sender` via `safeTransferFrom` to the vault.
2. Split the deposit: `fee = assets * depositFeeBps / 10_000` (floor); `net = assets - fee`.
3. If `fee > 0`: transfer `fee` of `depositAsset` to `feeTreasury`. Reverts with `VaultDeposit_FeeTreasuryNotSet` if `feeTreasury == address(0)`. Emits `DepositFeeTransferred`.
4. Convert `net` to vault base units via `IAssetConverter(converter).toBaseUnits(net, Floor)`.
5. Convert base units to shares via `_convertToShares(baseUnits, Floor)`.
6. Mint shares to `receiver`. Emits `Deposit(sender, receiver, depositAsset, assets, shares)`.
7. If `defaultStrategy != address(0)` and `net > 0`: transfer `net` of `depositAsset` to `defaultStrategy`. Emits `DepositRoutedToDefaultStrategy`.

**Bounds:**

- `maxDeposit(depositAsset, receiver)` → `0` if paused or unlisted; otherwise `type(uint256).max`.
- `maxMint(depositAsset, receiver)` → `0` if paused or unlisted; otherwise `type(uint256).max`.
- `previewDeposit(depositAsset, assets)` → shares at current NAV after deposit fee (or `0` if unlisted/zero assets).
- `previewMint(depositAsset, shares)` → gross assets required at current NAV including deposit fee (or `0` if unlisted/zero shares). Uses ceiling rounding.

**Converter previews (no fee):**

- `convertToShares(depositAsset, assets)` → shares equivalent to `assets` (using converter, no deposit fee).
- `convertToAssets(depositAsset, shares)` → asset units equivalent to `shares` (using converter, ceiling rounding).

### Default strategy

- **`setDefaultStrategy(address strategy)`** — Sets the strategy that receives `net` deposit tokens after each deposit. `strategy` MUST be a registered strategy or `address(0)` (to disable). Requires `DEFAULT_ADMIN_ROLE`. Emits `DefaultStrategySet`.
- **`defaultStrategy()`** — View: returns configured default strategy address (or zero).
- When `deregisterStrategy` is called for the current `defaultStrategy`, the default is automatically cleared to `address(0)`.

---

## Fee System

`FeeManagerUpgradeable` adds management and performance fees, both minted as new vault shares. All fee operations require `TREASURY_ROLE`.

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

- **`setFeeTreasury(address treasury)`** — Sets the protocol fee recipient for deposit fees, withdrawal fee shares, and future fee harvests. Must not be zero. Requires `TREASURY_ROLE`. Emits `FeeTreasurySet`.
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

- **`postPricePerShare(uint256 newPricePerShare, bool revertOnRateLimit)`** — Updates `pricePerShare`. Requires `PRICE_MANAGER_ROLE`. Reverts if `newPricePerShare == 0` (`Vault_ZeroPricePerShare`). Reverts if vault operations are paused.
- Subject to a **`PriceRateLimiter` bucket** (micro-bps capacity / refill model). The limiter measures the relative price move as bps and compares to remaining bucket capacity:
  - If the move fits within capacity: consume capacity, set price, emit `PricePerShareUpdated`.
  - If the move exceeds capacity and `revertOnRateLimit == true`: revert (`PriceRateLimiter_RateLimitExceeded`).
  - If the move exceeds capacity and `revertOnRateLimit == false`: drain the bucket, set the price, **pause vault operations** (`_pauseVault`), emit `PricePerShareUpdated` and `VaultOperationsPaused`.
- **`setPricePerShareRateLimit(uint32 maxBucketBps, uint64 refillRate)`** — Configures the rate-limiter bucket. Requires `DEFAULT_ADMIN_ROLE`.
- **`pricePerShareRateLimiterState()`** — View: returns current bucket state with refill virtually applied.
- Each successful update MUST emit **`PricePerShareUpdated(uint256 pricePerShare, uint256 nav, uint64 postedAt)`** where `nav = totalAssets()` (computed with the new PPS) and `postedAt = block.timestamp`.

---

## Strategy Integration

- **`registerStrategy(address strategy)`** — Adds `strategy` to the funding whitelist. Requires `STRATEGY_DEPLOYER_ROLE`. Reverts if already registered (`Vault_StrategyAlreadyRegistered`). Emits `StrategyRegistered(strategy, caller)`. Does **not** establish a token allowance.
- **`deregisterStrategy(address strategy)`** — Removes strategy from the whitelist. Requires `STRATEGY_DEPLOYER_ROLE`. Reverts if not registered (`Vault_StrategyNotRegistered`). Emits `StrategyDeregistered(strategy, caller)`. Clears `defaultStrategy` if it equals the removed strategy.
- **`isRegisteredStrategy(address strategy)`** — View: returns whether strategy is in the whitelist.
- **`requestFunding(IERC20 token, uint256 amount)`** — Called by a registered strategy; vault transfers `amount` of `token` to `msg.sender` via `safeTransfer`. Reverts if caller is not registered (`Vault_StrategyNotRegistered`). Reverts if `token` is the vault share token (`Vault_ShareTransferNotAllowed`). Reverts if `amount == 0` (`Vault_ZeroAmount`). Emits `FundingRequested(strategy, token, amount)`. Protected by `nonReentrant`.
- **No dedicated `restoreStrategyAllowance`**: there is no allowance to restore; the vault transfers directly on `requestFunding`.

---

## Async Redemptions

### Global limits

- **`setMaxRedeemRequestShares(uint256 maxShares)`** — Upper bound on `shares` for each `requestRedeem` call (defaults to `type(uint256).max`). Requires `TREASURY_ROLE`. Emits `MaxRedeemRequestSet(maxShares)`.
- **`maxRedeemRequestShares()`** — View: returns the configured cap.

To block new redemption requests, set `maxRedeemRequestShares` to `0`.

### `requestRedeem`

**`requestRedeem(uint256 shares, address owner)`** → `uint256 requestId`

- Requires vault not paused (`whenVaultNotPaused`). Protected by `nonReentrant`.
- `shares` MUST be non-zero (`AsyncRedemption_ZeroRedeemRequestShares`).
- `shares` MUST NOT exceed `maxRedeemRequestShares` (`AsyncRedemption_ExceededMaxRedeem`).
- If `msg.sender != owner`, allowance is spent via `_spendAllowance(owner, msg.sender, shares)`.
- **Withdrawal fee** (if configured and treasury is set): `feeShares = shares * withdrawalFeeBps / 10_000` (floor). Fee shares are transferred from `owner` to `feeTreasury`. Emits `WithdrawalFeeCharged(treasury, feeShares)`.
- `netShares = shares - feeShares`. Burns `netShares` from `owner`.
- `assets = _convertToAssets(netShares, Floor)`.
- Assigns a new non-zero `requestId` via `++nextRequestId` (starting from `1`).
- Records `RedeemRequest { pendingShares: netShares, pendingAssets: assets, owner }`.
- Updates global `totalPendingShares` and `totalPendingAssets`.
- Emits `RedeemRequested(requestId, owner, caller, shares)` (original `shares`, not `netShares`).

**Returns** unique non-zero `requestId`.

### `setWithdrawalFeeBps` / `withdrawalFee`

- **`setWithdrawalFeeBps(uint16 bps)`** — Sets withdrawal fee; `bps` MUST be strictly less than `10_000`. Requires `TREASURY_ROLE`. Emits `WithdrawalFeeBpsSet(bps)`.
- **`withdrawalFee()`** — View: returns current withdrawal fee in bps.

### Request queries

- **`pendingRedeemRequest(uint256 requestId)`** — Returns `pendingShares` for `requestId`.
- **`claimableRedeemRequest(uint256)`** — Always returns `0`; there is no separate claimable buffer.

### Redemption fulfillment

**`fulfillRedeemRequests(uint256[] calldata requestIds)`**

- Requires **`OPERATOR_ROLE`**. Protected by `nonReentrant`. **Not** guarded by vault pause.
- For each `requestId`: if `pendingAssets == 0`, reverts `AsyncRedemption_NothingToFulfill(requestId)`.
- Subtracts from global `totalPendingShares` and `totalPendingAssets`.
- Deletes the request record.
- Transfers `pendingAssets` of `asset()` directly to request `owner` via `safeTransfer`. Emits `Withdraw(msgSender, owner, assets, shares)`.
- After all requests: emits `RedeemRequestsFulfilled(requestIds)`.
- The Vault's asset balance MUST be sufficient at transfer time; the ERC-20 transfer will revert if insufficient.

### Request IDs

- Monotonic counter (`nextRequestId`), starting from `1`. Each `requestRedeem` increments and assigns.
- `pendingRedeemRequest` and `fulfillRedeemRequests` operate per `requestId`.

---

## Implementation Shape

- **`VaultBaseUpgradeable`** — Holds `IVault` behavior (strategy registry, `requestFunding`, `pricePerShare`, `postPricePerShare`, `totalAssets`, `AccessControl`, `ReentrancyGuard`, vault pause). Abstract. Uses ERC-7201 namespaced storage — no `__gap` arrays.
- **`FeeManagerUpgradeable`** — Extends `VaultBaseUpgradeable`; adds management + performance fee state and harvest logic. Abstract.
- **`MultiAssetDepositUpgradeable`** — Extends `FeeManagerUpgradeable`; adds multi-asset deposit/mint, converter registry, deposit fees, default strategy routing. Abstract.
- **`AsyncRedemptionUpgradeable`** — Extends `VaultBaseUpgradeable`; adds async redemption requests, global caps, fulfillment gated by `OPERATOR_ROLE`. Abstract.
- **Concrete vault** — Composes all of the above into a single implementation contract set on the Vault `UpgradeableBeacon`.
- **Beacon** — Live vault MUST be `BeaconProxy` with `UpgradeableBeacon` (Vault-dedicated beacon, not shared with Strategy). Updating the implementation pointer MUST be restricted to protocol admin. `constructor` empty of mutable state; `initializer` per **002** §A.1.

---

## Acceptance Criteria

1. **`IVault` (002)** + Strategy `requestFunding` pipe: `registerStrategy` gated by `STRATEGY_DEPLOYER_ROLE`, reverts if already registered; `deregisterStrategy` by same role; `requestFunding` callable only by registered strategies, transfers token directly.
2. **Multi-asset deposits**: `deposit` and `mint` (both overloads each) accept listed `depositAsset`; deposit fee routed to `feeTreasury` before mint; optional default strategy receives `net` tokens; `previewDeposit` / `previewMint` / `maxDeposit` / `maxMint` per **Multi-Asset Deposits**.
3. **Fee system**: management fee (time-based, `TREASURY_ROLE` harvests) and performance fee (HWM, `TREASURY_ROLE` harvests); `setManagementFeeBps` / `setPerformanceFeeBps` by `TREASURY_ROLE`; fees minted as shares; HWM resets on `setPerformanceFeeBps`.
4. **Async redemptions**: `requestRedeem` burns `netShares`; shares capped by `maxRedeemRequestShares` (`TREASURY_ROLE`); withdrawal fee taken as shares; `claimableRedeemRequest` always returns `0`.
5. **Redemption fulfillment**: `fulfillRedeemRequests(uint256[] requestIds)` requires `OPERATOR_ROLE`; reverts `AsyncRedemption_NothingToFulfill` for unknown or already fulfilled ids; transfers `asset` to owner; emits `Withdraw` per request; emits `RedeemRequestsFulfilled` after batch.
6. **Vault pause**: `PAUSER_ROLE` pauses, `DEFAULT_ADMIN_ROLE` unpauses; auto-pause on rate-limit-exceeded + `revertOnRateLimit = false`.
7. **`postPricePerShare(uint256, bool)`**: rate-limiter bucket; `PRICE_MANAGER_ROLE`; `PricePerShareUpdated` event; auto-pause on excess if `revertOnRateLimit = false`.
8. **Beacon** deployment + initializer per **002** §A.1.
9. **`totalAssets()`** = `totalSupply() * pricePerShare / 10 ** decimals()` (floor); conversion functions per **Accounting**.
10. **Fee treasury**: `setFeeTreasury` by `TREASURY_ROLE`; used for deposit fees, withdrawal fee shares.

---

## Edge Cases

- **`totalAssets()`** is derived from the posted rate, not raw ERC-20 balances.
- Redemption fulfillment uses the Vault's live asset balance at transfer time; the ERC-20 transfer reverts if insufficient. Strategies MUST `pushToVault` before the operator calls `fulfillRedeemRequests` if their custody should fund settlements.
- **Withdrawal fee of `0` bps** (or unset treasury): no shares are deducted; `netShares == shares`.
- **`maxRedeemRequestShares == 0`**: `requestRedeem` with any non-zero shares reverts `AsyncRedemption_ExceededMaxRedeem`; this blocks new requests.
- **Rounding** follows floor/ceiling discipline in each path; extreme ratios can produce `0` shares or assets.
- **`pricePerShare` rate limiter at zero capacity** (initial state): the limiter's `_wouldExceedLimit` behavior with a zeroed bucket means the first `postPricePerShare` may succeed or trigger the limit depending on config. Operators MUST call `setPricePerShareRateLimit` before relying on the limiter.
- **Explicit non-goals (unless added later):** bridge vendor / message format; Strategy `exec` / Merkle allowlist (**001**) beyond **002**; async deposits; `IRedemptionPolicy`; any ERC-4626 standard `deposit(assets, receiver)` / `withdraw` / `redeem` entrypoints; `requestDeposit`; `cancelRedeemRequest`.

---

## References

- `docs/spec/002-strategy.md` — `IVault`, Strategy pipe
- `contracts/vault/interfaces/IVault.sol`
- `contracts/vault/interfaces/IAsyncRedemption.sol`
- `contracts/vault/interfaces/IFeeManager.sol`
- `contracts/vault/interfaces/IMultiAssetDeposit.sol`
- `contracts/vault/VaultBaseUpgradeable.sol`
- `contracts/vault/FeeManagerUpgradeable.sol`
- `contracts/vault/MultiAssetDepositUpgradeable.sol`
- `contracts/vault/AsyncRedemptionUpgradeable.sol`
- `contracts/vault/libraries/PriceRateLimiter.sol`
