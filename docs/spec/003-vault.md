# Feature: Vault (ERC-4626 + ERC-7540, Strategy integration)

Normative spec for **one** deployable vault (**`ERC7540AsyncRedeemVault`**): depositor entry and accounting for a single ERC-20 **`asset`**, with **Strategies** moving liquidity via **`pullFromVault` / `pushToVault`** per **`docs/spec/002-strategy.md`**. The vault **MUST** implement **[ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)** (sync **`deposit` / `mint`**) and **[ERC-7540](https://eips.ethereum.org/EIPS/eip-7540)** (async redemption). The **`IVault`** interface for Strategies **MUST** match **`contracts/interfaces/vault/IVault.sol`**; ERC-4626 / ERC-7540 entrypoints are **in addition** to that interface.

---

## Goal

Deliver a **`VaultBase`** core (strategy registry + `pricePerShare` ratio field + **`IVault`**, **not** the beacon implementation), ERC-4626 / ERC-7540 behavior in layered abstract contracts, and a concrete **`ERC7540AsyncRedeemVault`** behind **`BeaconProxy`** (**sync** deposits, **async** withdrawals only—no other vault variant in scope).

1. **Deposits** — Atomic **`deposit` / `mint`**; async **`requestDeposit`** not supported (**MUST** **`revert`** if present in ABI).
2. **Exits** — **`requestRedeem`** → pending → **`fulfillRedeemRequests`** (operator-authorized, direct settlement) per ERC-7540.
3. **Redemption fulfillment** — **`fulfillRedeemRequests(uint256[] requestIds)`** **MUST** transfer **`asset`** directly to each request's **`owner`** in a single pass; caller **MUST** be an ERC-7540 **`operator`** for the **`controller`** of each supplied request ID. There is **no** separate claimable state; ERC-4626 **`withdraw` / `redeem`** are **disabled** and **MUST revert**.
4. **Strategies** — **`registerStrategy`** + allowance per **002**; no extra Vault APIs that move **`asset()`** outside **002**.
5. **Exchange rate** — Expose **`pricePerShare`** (asset units per `10 ** decimals()` shares) + **`PRICE_PER_SHARE_POSTER_ROLE`**; **`totalAssets()`** is derived from this rate, not from raw balances.

**Architecture (fixed):** Redemption **fulfillment** is invoked **by an ERC-7540 operator** of the relevant **`controller`**, directly paying asset to each request's owner in one tx. Cross-chain pricing field **`pricePerShare`** **MUST** be writable **only** by **`PRICE_PER_SHARE_POSTER_ROLE`**. The implementation **MUST** ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (Vault-dedicated beacon, same pattern as **002** §A.1).

### Deposits (sync, ERC-4626)

- **`deposit` / `mint`** — Pull **`asset`**, **`mint`** shares to receiver; **`previewDeposit` / `previewMint`** and deposit **`max*`** per ERC-4626 (plus deployment caps if any).
- **`requestDeposit`** — **Out of scope**; if present for ABI compatibility, **MUST** **`revert`** (e.g. **`ERC7540RequestDepositNotSupported()`**).

### Redemptions (async, ERC-7540)

- **`requestRedeem(shares, controller, owner)`** — Burns **`shares`** from **`owner`** immediately (**no** share escrow). **`totalSupply`** **MUST** drop at request time. The **`controller`** **MUST** be registered and currently accepting requests (**`acceptsRedeemRequests[controller] == true`**); otherwise **MUST revert** (**`RedeemRequestsNotAccepted`**). **`shares`** **MUST NOT** exceed **`maxRedeemShares[controller]`** (**`ERC4626ExceededMaxRedeem`**). If **`msg.sender != owner`**, allowance **MUST** be spent via **`_spendAllowance`**. Asset amount is computed via **`_convertToAssets`** (floor) at request time. Returns a unique non-zero **`requestId`**.
- **`previewRedeem`** **MUST revert** (**`ERC7540PreviewDisabled`**). **`previewWithdraw`** **MUST revert** as well: the exit path is **async** (direct settlement via **`fulfillRedeemRequests`**).
- **`withdraw` / `redeem`** (ERC-4626) — **Disabled**; **MUST revert** (**`ERC7540ERC4626ClaimDisabled`**). There is no ERC-4626 claim step.
- **`maxWithdraw`** — **Disabled**; **MUST revert** (**`ERC7540ERC4626ClaimDisabled`**).
- **`maxRedeem(controller)`** — Returns **`maxRedeemShares[controller]`**, the per-controller share cap set by the controller via **`setMaxRedeem`**.
- **`cancelRedeemRequest`** — **Not** supported; if present, **MUST** **`revert`**. **MUST NOT** emit **`CancelRedeemRequest`**.
- **`pendingRedeemRequest(requestId, controller)`** — Returns **`pendingShares`** for **`requestId`** (the **`controller`** parameter is accepted for ERC-7540 interface compliance but **ignored** in lookups; state is keyed by **`requestId`** only).
- **`claimableRedeemRequest`** — Always returns **`0`**; there is no claimable buffer (requests go pending → fulfilled, no intermediate claimable state).

### Request IDs

- Each **`requestRedeem`** call assigns a new non-zero **`requestId`** via a monotonic counter (**`++nextRequestId`**, starting from **`1`**).
- **`pendingRedeemRequest(requestId, controller)`** and **`fulfillRedeemRequests`** operate per **`requestId`**.

### Controller management

Controllers are externally managed addresses that gate redemption requests. **`CONTROLLER_MANAGER_ROLE`** (**`keccak256("CONTROLLER_MANAGER_ROLE")`**) **MUST** be held to call any management function.

- **`registerRedeemController(address controller)`** — Adds **`controller`** to the tracked set; **MUST revert** if already tracked (**`ERC7540RedeemControllerAlreadyTracked`**). Does **not** automatically allow requests.
- **`allowRedeemRequests(address controller)`** — Sets **`acceptsRedeemRequests[controller] = true`**; **MUST revert** if controller is not tracked or already allowed.
- **`stopRedeemRequests(address controller)`** — Sets **`acceptsRedeemRequests[controller] = false`**; pending requests are **not** affected. **MUST revert** if already stopped.
- **`removeRedeemController(address controller)`** — Removes controller from tracking; **MUST revert** if not tracked or if **`pendingAssets`** or **`pendingShares`** are non-zero (**`ERC7540RemoveControllerHasPending`**). Clears **`acceptsRedeemRequests`**, **`operators`**, and **`maxRedeemShares`** for the controller.
- **`acceptsRedeemRequests(address controller)`** — View; returns whether **`controller`** currently accepts new redeem requests.

### `setMaxRedeem` / `maxRedeem`

- **`setMaxRedeem(uint256 maxShares)`** — Called by **`msg.sender`** acting as a registered controller; updates **`maxRedeemShares[msg.sender]`**. Emits **`MaxRedeemSet(controller, maxShares)`**. **MUST revert** if caller is not a tracked controller.
- **`maxRedeem(controller)`** — Returns **`maxRedeemShares[controller]`**. **`requestRedeem`** enforces this cap: a request for **`shares > maxRedeemShares[controller]`** **MUST revert** (**`ERC4626ExceededMaxRedeem`**).

### Redemption fulfillment

- **`fulfillRedeemRequests(uint256[] calldata requestIds)`** — Caller **MUST** be an ERC-7540 **operator** for the **`controller`** of each supplied request ID; **MUST revert** otherwise (**`ERC7540UnauthorizedClaimCaller`**). For each **`requestId`**: subtracts **`pendingShares`** and **`pendingAssets`** from the controller's aggregate, deletes the request record, and transfers **`pendingAssets`** directly to the request **`owner`** via **`safeTransfer`**. Emits **`RedeemRequestsFulfilled(requestIds)`**.
- **Scope** — There is **no** per-controller budget cap enforced by the Vault; the caller controls which request IDs to include. The Vault's asset balance **MUST** be sufficient to cover all transfers or the tx will revert at the ERC-20 level.
- **No `IRedemptionPolicy`** — Allocation is fully determined by the operator-supplied **`requestIds`** list; there is no pluggable policy contract.

### ERC-7540 operators

- **`setOperator(address operator, bool approved)`** — Caller **MUST** be a registered controller (**`controllers.contains(msg.sender)`**); **MUST revert** otherwise (**`ERC7540RedeemControllerNotTracked`**). Approves or revokes **`operator`** for **`msg.sender`**. Emits **`OperatorSet(controller, operator, approved)`**.
- **`isOperator(address controller, address operator)`** — View; returns membership in **`operators[controller]`**.

### Implementation shape

- **`VaultBase`** — **MUST** hold **`IVault`** (**002**), strategy registry + **`registerStrategy`**, **`pricePerShare`** + **`postPricePerShare`**, **`totalAssets()`** derivation from the price rate, and **`AccessControl`** / **`ReentrancyGuard`** for those concerns. It **MUST NOT** be the **`UpgradeableBeacon`** implementation pointer; it **MAY** be **`abstract`**. Storage **MUST** use ERC-7201-style namespaced slots (no requirement for legacy **`__gap`** arrays on new layouts).
- **Layered modules** — Sync **`deposit` / `mint`**, ERC-4626 wiring, and async redemption (**`fulfillRedeemRequests`** with operator auth, direct settlement, **ERC-165** for **4626**) **MUST** compose into the single in-scope concrete vault; exact inheritance split is **implementation freedom** if external behavior matches this spec.
- **`ERC7540AsyncRedeemVault`** — **MUST** be the **concrete** contract set on the Vault **`UpgradeableBeacon`**: **sync** deposits and **async** redemptions as specified, and the **ERC-165** rules under **ERC-165, operators**. **No** other concrete vault **variant** for deposit modality is **in scope**.
- **Beacon** — Live vault **MUST** be **`BeaconProxy`** with **`UpgradeableBeacon`** (Vault-dedicated beacon, **not** shared with Strategy). Updating the beacon's implementation pointer **MUST** be **restricted** to protocol admin (or equivalent) on the beacon. **`constructor`** empty of mutable state; **`initializer`** per **002** §A.1.

### Accounting and `totalAssets`

- **`asset()`** (ERC-4626) **MUST** match **`IVault.asset()`** (same underlying token for the §B pipe).
- **`pricePerShare`** — Stored exchange rate: **asset wei per `10 ** decimals()` share units**. **MUST** be set to a non-zero value via **`postPricePerShare`** before the vault is usable (zero price returns 0 for all conversions).
- **`totalAssets()`** **MUST** equal **`_convertToAssets(totalSupply(), Floor)`**, i.e. **`totalSupply() * pricePerShare / 10 ** decimals()`** (floor rounding). It is **not** a raw ERC-20 balance sum of the Vault and registered Strategies. The rate is posted externally and reflects the economic NAV of the strategy portfolio.
- **`_convertToShares(assets, rounding)`** = **`assets * 10 ** decimals() / pricePerShare`** (using the posted rate).
- **`_convertToAssets(shares, rounding)`** = **`shares * pricePerShare / 10 ** decimals()`** (using the posted rate).
- **`preview*` / `convertTo*`** (where EIP applies) **MUST** follow **ERC-4626** from **`totalAssets()`** and **`totalSupply()`** only.
- **Fees** — **Out of scope**. Rounding **MUST** still follow ERC-4626 / ERC-7540 where the EIPs apply.

### Strategy integration

- **`IVault`** (**`contracts/interfaces/vault/IVault.sol`**) — **`asset()`** (same as ERC-4626), **`registerStrategy`**, **`isRegisteredStrategy`** only; NatSpec on **`registerStrategy`** requires **`IERC20(asset()).approve(strategy, type(uint256).max)`** and registry behavior per **002**.
- **Implementation** — **MUST** satisfy **002** (e.g. **`EnumerableSet`** or equivalent for membership, **`forceApprove`** as above). **`EnumerableSet`** is **not** part of the **`IVault`** interface; it is an implementation detail.
- **`STRATEGY_DEPLOYER_ROLE`** — **`keccak256("STRATEGY_DEPLOYER_ROLE")`**. **`registerStrategy`** **MUST** be callable **only** by accounts holding this role (**no** extra gating beyond **`AccessControl`** for that function). **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`STRATEGY_DEPLOYER_ROLE`**.
- **`registerStrategy`** is **idempotent** for an already-registered strategy: a subsequent call **MUST NOT** **`revert`** solely because the strategy is already registered (the `EnumerableSet.add` no-ops silently), and **MUST** call **`IERC20(asset()).forceApprove(strategy, type(uint256).max)`** so a re-call restores max allowance. Recovery from a broken allowance **MUST** use **`registerStrategy`** or a Vault **implementation** upgrade, **not** a separate normative Vault API in this spec.
- **No** dedicated **`restoreStrategyAllowance`** (or equivalent) on the Vault.

### Cross-chain ratio (`pricePerShare`)

- **MUST** expose **`uint256 pricePerShare`** (asset wei per `10 ** decimals()` vault shares) as a **`view`** getter. **Only** **`PRICE_PER_SHARE_POSTER_ROLE`** (**`keccak256("PRICE_PER_SHARE_POSTER_ROLE")`**) **MUST** write it via **`postPricePerShare(uint256 newPricePerShare)`**. **MUST revert** if **`newPricePerShare == 0`** (**`ZeroPricePerShare`**).
- Each successful update **MUST** emit **`PricePerShareUpdated(uint256 pricePerShare, uint256 nav, uint64 postedAt)`** where **`nav`** = **`totalSupply() * newPricePerShare / 10 ** decimals()`** (floor) and **`postedAt`** = **`block.timestamp`**.
- **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`PRICE_PER_SHARE_POSTER_ROLE`**.
- **No** mandatory on-chain staleness guard in this spec.

### ERC-165, operators

- **ERC-165** — **`supportsInterface`** **MUST** return **true** for **`type(IERC4626).interfaceId`** where **`IERC4626`** is the canonical OpenZeppelin **`@openzeppelin/contracts/interfaces/IERC4626.sol`**. **`supportsInterface`** **MUST** return **true** for the ERC-7540 asynchronous vault **redeem-leg** identifier **`0x620ee8e4`** and the ERC-7540 **operator** identifier **`0xe3bc4e65`**. The vault **MUST NOT** return **true** for **[ERC-7575](https://eips.ethereum.org/EIPS/eip-7575)** interface IDs.
- **`name` / `symbol`** — **SHOULD** reflect **`asset`** per ERC-4626.
- **ERC-7540 operators** — For **`fulfillRedeemRequests`**, the caller **MUST** be an **`operator`** approved via **`setOperator` / `isOperator`** for the **`controller`** of each request. The **`controller`** itself is **not** a permitted caller for **`fulfillRedeemRequests`** unless also registered as an operator.

---

## Acceptance Criteria

1. **`IVault` (002)** + Strategy **`pullFromVault`** with registry and allowance; **`registerStrategy`** gated **only** by **`STRATEGY_DEPLOYER_ROLE`**, **idempotent** for already-registered strategies with **`forceApprove(..., type(uint256).max)`** per **Strategy integration**; **no** **`restoreStrategyAllowance`**.
2. **ERC-4626** deposits and previews; **`requestDeposit`** reverts if present.
3. **ERC-7540** redemptions: **`requestRedeem`** burns shares immediately; **`controller`** must be registered and accepting requests; shares capped by **`maxRedeemShares[controller]`**; **`previewRedeem`** and **`previewWithdraw`** **MUST revert**; cancel unsupported (revert if present); **`withdraw`** / **`redeem`** / **`maxWithdraw`** **MUST revert** (**`ERC7540ERC4626ClaimDisabled`**); **`claimableRedeemRequest`** always returns **`0`**; events per EIP.
4. **Controller management** — **`CONTROLLER_MANAGER_ROLE`** gates **`registerRedeemController`**, **`allowRedeemRequests`**, **`stopRedeemRequests`**, **`removeRedeemController`**; state transitions and guards per **Controller management**.
5. **`setMaxRedeem`** callable by registered controllers; **`maxRedeem`** returns the stored cap; **`requestRedeem`** enforces it.
6. **Redemption fulfillment** — **`fulfillRedeemRequests(uint256[] requestIds)`** gated by operator membership for each request's controller; directly transfers **`asset`** to each request's **`owner`**; no claimable state; no **`IRedemptionPolicy`**.
7. **Beacon** deployment + initializer per **002** §A.1.
8. **`totalAssets()`** = **`totalSupply() * pricePerShare / 10 ** decimals()`** (floor); **`convertTo*` / deposit `preview*`** per **Accounting and `totalAssets`** and ERC-4626 deposit rules.
9. **`pricePerShare`** field, **`PRICE_PER_SHARE_POSTER_ROLE`**, **`postPricePerShare`** setter, **`PricePerShareUpdated`** event per **Cross-chain ratio**.
10. **ERC-165** — **`0x620ee8e4`** (async redeem) and **`0xe3bc4e65`** (operators) **MUST** be **true**; ERC-4626 interface ID **MUST** be **true**; **ERC-7575 MUST NOT**.
11. **ERC-7540 operators** — **`setOperator` / `isOperator`** per **ERC-7540 operators**; **`setOperator`** only callable by registered controllers.
12. **`VaultBase` + `ERC7540AsyncRedeemVault`** — **`VaultBase`** (core) exists and is **not** the implementation pointer on the Vault **`UpgradeableBeacon`**; **`ERC7540AsyncRedeemVault`** is the **only** in-scope concrete vault (**sync** deposits, **async** withdrawals).

---

## Edge Cases

- **`totalAssets()`** is derived from **`pricePerShare`** (a posted rate), not from raw ERC-20 balances. If **`pricePerShare == 0`** (uninitialized), all conversions return **`0`**.
- Redemption fulfillment uses the Vault's live asset balance at transfer time; the ERC-20 transfer will revert if the Vault holds insufficient **`asset`**. Strategies **MUST** **`pushToVault`** (or equivalent transfer) **before** the operator calls **`fulfillRedeemRequests`** if their custody should fund settlements.
- **`removeRedeemController`** will revert if any **`pendingAssets`** or **`pendingShares`** remain for the controller; all open requests **MUST** be fulfilled first.
- **`setOperator`** is callable **only** by registered controllers; unregistered addresses **MUST** call **`registerRedeemController`** first.
- Rounding follows ERC-4626 / ERC-7540 where applicable; extreme **`totalSupply()`** / **`pricePerShare`** ratios can still produce **0** shares or assets in edge inputs—callers **SHOULD** use **`preview*`** and **`max*`** as defined by the EIPs.
- **Unsupported `asset`** types (fee-on-transfer, rebasing) per **002** unless separately documented for a deployment.
- **`pricePerShare`** carries **no** mandatory on-chain staleness guard; consumers **MUST** treat freshness as a deployment / operational concern.
- **Explicit non-goals (unless added later):** bridge vendor / message format; Strategy **`exec`** / Merkle allowlist (**001**) beyond **002**; async deposits; normative pause/circuit-breaker; normative fee design; **ERC-7575**; Vault **`restoreStrategyAllowance`**; **`IRedemptionPolicy`**; any concrete vault other than **`ERC7540AsyncRedeemVault`** (**sync** deposits, **async** withdrawals).

### References

- [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
- [EIP-7540](https://eips.ethereum.org/EIPS/eip-7540)
- `docs/spec/002-strategy.md` — **`IVault`**, Strategy pipe
- `contracts/vault/interfaces/IVault.sol`
- `contracts/vault/interfaces/IERC7540Redemption.sol`
- `contracts/vault/VaultBaseUpgradeable.sol`
- `contracts/vault/ERC7540RedemptionUpgradeable.sol`
- `@openzeppelin/contracts/interfaces/IERC4626.sol` — **`type(IERC4626).interfaceId`** for **ERC-165** (EIP-4626 does not fix a **`bytes4`** in the EIP body)
