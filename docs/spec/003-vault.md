# Feature: Vault (ERC-4626 + ERC-7540, Strategy integration)

Normative spec for **one** deployable vault (**`ERC7540AsyncRedeemVault`**): depositor entry and accounting for a single ERC-20 **`asset`**, with **Strategies** moving liquidity via **`pullFromVault` / `pushToVault`** per **`docs/spec/002-strategy.md`**. The vault **MUST** implement **[ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)** (sync **`deposit` / `mint`**) and **[ERC-7540](https://eips.ethereum.org/EIPS/eip-7540)** (async redemption). The **`IVault`** interface for Strategies **MUST** match **`contracts/interfaces/vault/IVault.sol`**; ERC-4626 / ERC-7540 entrypoints are **in addition** to that interface.

---

## Goal

Deliver a **`VaultBase`** core (strategy registry + ratio fields + **`IVault`**, **not** the beacon implementation), ERC-4626 / ERC-7540 behavior in layered abstract contracts, and a concrete **`ERC7540AsyncRedeemVault`** behind **`BeaconProxy`** (**sync** deposits, **async** withdrawals only—no other vault variant in scope).

1. **Deposits** — Atomic **`deposit` / `mint`**; async **`requestDeposit`** not supported (**MUST** **`revert`** if present in ABI).
2. **Exits** — **`requestRedeem`** → pending → permissionless settlement → claimable → **`withdraw` / `redeem`** per ERC-7540.
3. **Settlement** — **`fulfillRedemptions`** (or equivalent) **MAY** be called **by any account** **at any time**; each run budgets from the Vault’s **`asset` balance**; allocation ordering **MUST** come **only** from **`IRedemptionSettlementPolicy`** (see subsection below).
4. **Strategies** — **`registerStrategy`** + allowance per **002**; no extra Vault APIs that move **`asset()`** outside **002**.
5. **Cross-chain ratio** — Expose **`postedTotalAssets` / `postedTotalSupply`** + **`RATIO_POSTER_ROLE`**.

**Architecture (fixed):** Redemption **settlement** (pending → claimable) is **permissionless** (no dedicated fulfiller role), using the Vault’s **on-chain `asset` balance** and a pluggable **`IRedemptionSettlementPolicy`**. Cross-chain fields **`postedTotalAssets` / `postedTotalSupply`** **MUST** be writable **only** by **`RATIO_POSTER_ROLE`**. The implementation **MUST** ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (Vault-dedicated beacon, same pattern as **002** §A.1).

### Deposits (sync, ERC-4626)

- **`deposit` / `mint`** — Pull **`asset`**, **`mint`** shares to receiver; **`previewDeposit` / `previewMint`** and deposit **`max*`** per ERC-4626 (plus deployment caps if any).
- **`requestDeposit`** — **Out of scope**; if present for ABI compatibility, **MUST** **`revert`** (e.g. **`ERC7540RequestDepositNotSupported()`**).

### Redemptions (async, ERC-7540)

- **`requestRedeem`** — **`burn`** shares from **`owner`** (no share escrow / no **`transferFrom`** to Vault). **`totalSupply`** **MUST** drop at request time. **`previewRedeem`** **MUST revert** (ERC-7540). **`previewWithdraw`** (ERC-4626) **MUST revert** as well: this spec’s exit path is **async** (**claim** via **`withdraw` / `redeem`** only); ERC-7540 does **not** mandate that rule for **`previewWithdraw`**, so it is **required here** as product behavior, not as an ERC-7540 citation.
- **`cancelRedeemRequest`** — **Not** supported; if present, **MUST** **`revert`**. **MUST NOT** emit **`CancelRedeemRequest`**.
- **`pendingRedeemRequest`**, **`claimableRedeemRequest`**, **`maxWithdraw` / `maxRedeem`** — Per ERC-7540 for the redemption leg.
- **`withdraw` / `redeem`** — **Claim** only: transfer **`asset`** for **claimable** amounts; **MUST NOT** **`burn`** shares again or require a second share movement. **`RedeemRequest`** event per ERC-7540.

### Request IDs

- **Recommended default:** **`requestId == 0`** for **`requestRedeem`** and related views (state keyed by **`controller`**).
- **Conformance with non-zero IDs:** Implementations **MAY** use **`requestId != 0`** **only if** they **still satisfy** ERC-7540 and the settlement / **`IRedemptionSettlementPolicy`** rules in this spec, and the scheme **MUST** be documented for integrators (e.g. deployment README or NatSpec). **Not** recommended unless there is a clear product reason.

### Settlement (pending → claimable)

- **Caller** — Settlement **MUST NOT** require a protocol-specific fulfiller role; **any** account **MAY** invoke settlement (ERC-7540 does not prescribe a privileged fulfiller).
- **When / budget** — Settlement **MAY** run **at any time**. Each run **MUST** cap fulfillment by the Vault’s **`IERC20(asset).balanceOf(address(this))`** at execution time (not Strategy balances). Strategies **MUST** **`pushToVault`** (or transfer) **before** settlement if their custody should fund claims.
- **Allocation** — Ordering and slices across controllers **MUST** come from **`IRedemptionSettlementPolicy.settlementPlan`**, not hard-coded Vault branches.

### Implementation shape

- **`VaultBase`** — **MUST** hold **`IVault`** (**002**), strategy registry + **`registerStrategy`**, **`postedTotalAssets` / `postedTotalSupply`**, **`totalAssets()`** aggregation (vault + registered strategies), and **`AccessControl`** / **`ReentrancyGuard`** for those concerns. It **MUST NOT** be the **`UpgradeableBeacon`** implementation pointer; it **MAY** be **`abstract`**. Storage **MUST** use ERC-7201-style namespaced slots (no requirement for legacy **`__gap`** arrays on new layouts).
- **Layered modules** — Sync **`deposit` / `mint`**, ERC-4626 wiring, and async redemption (pending / claimable, permissionless settlement, **`IRedemptionSettlementPolicy`**, claim **`withdraw` / `redeem`**, **ERC-165** for **4626**) **MUST** compose into the single in-scope concrete vault; exact inheritance split is **implementation freedom** if external behavior matches this spec.
- **`ERC7540AsyncRedeemVault`** — **MUST** be the **concrete** contract set on the Vault **`UpgradeableBeacon`**: **sync** deposits and **async** redemptions as specified, and the **ERC-165** rules under **ERC-165, operators**. **No** other concrete vault **variant** for deposit modality is **in scope** (see **Edge Cases** / non-goals).
- **Beacon** — Live vault **MUST** be **`BeaconProxy`** with **`UpgradeableBeacon`** (Vault-dedicated beacon, **not** shared with Strategy). Updating the beacon’s implementation pointer **MUST** be **restricted** to protocol admin (or equivalent) on the beacon. **`constructor`** empty of mutable state; **`initializer`** per **002** §A.1.

### `IRedemptionSettlementPolicy`

**Purpose:** Swap or upgrade a **policy** contract to change FIFO / sweep-until-budget / pro-rata / **etc.** without editing Vault **implementation** code.

**Interface (normative):**

```solidity
struct RedemptionSettlementSlice {
  address controller;
  uint256 requestId;
  uint256 assets;
}

interface IRedemptionSettlementPolicy {
  /// Read-only: pending → claimable this round; sum of assets <= maxAssets.
  function settlementPlan(address vault, uint256 maxAssets) external view returns (RedemptionSettlementSlice[] memory);
}
```

Names **MAY** differ if documented; semantics **MUST** match: **read-only** plan, **sum ≤ `maxAssets`**, each slice **≤** pending for that **`controller` / `requestId`**. **`settlementPlan`** **MUST NOT** write storage or be **`payable`**.

**Vault:** On settlement: set **`maxAssets` ≤** Vault **`asset` balance**; **`staticcall`** **`settlementPlan(address(this), maxAssets)`**; **validate**; **apply** pending→claimable **only** if checks pass; else **`revert`**. Vault **MUST NOT** give **`asset`** custody to the policy. Policy is **trusted for ordering**, not custody.

**Admin:** **`DEFAULT_ADMIN_ROLE`** **MUST** be able to **`setSettlementPolicy(address)`** (or ABI-equivalent) in one tx. **Initializer** **MUST** set a **non-zero** policy. **Anyone** **MAY** call settlement multiple times; policies **MAY** cap loop iterations (document per policy).

### Accounting and `totalAssets`

- **`asset()`** (ERC-4626) **MUST** match **`IVault.asset()`** (same underlying token for the §B pipe).
- **`totalAssets()`** **MUST** equal **`IERC20(asset).balanceOf(address(this))` + Σ `IERC20(asset).balanceOf(s)`** for **every** registered strategy **`s`** with **`isRegisteredStrategy(s) == true`**. **MUST NOT** include unregistered addresses, arbitrary EOAs, or Satellite deployments unless a future spec extends the set. **MUST NOT** apply a virtual adjustment for pending vs claimable redemptions.
- **`preview*` / `convertTo*`** (where EIP applies) **MUST** follow **ERC-4626** from **`totalAssets()`** and **`totalSupply()`** only.
- **Fees** — **Out of scope**. Rounding **MUST** still follow ERC-4626 / ERC-7540 where the EIPs apply. **Unsupported `asset`** — Same constraints as **002** (no fee-on-transfer / rebasing unless explicitly documented).

### Strategy integration

- **`IVault`** (**`contracts/interfaces/vault/IVault.sol`**) — **`asset()`** (same as ERC-4626), **`registerStrategy`**, **`isRegisteredStrategy`** only; NatSpec on **`registerStrategy`** requires **`IERC20(asset()).approve(strategy, type(uint256).max)`** and registry behavior per **002**.
- **Implementation** — **MUST** satisfy **002** (e.g. **`EnumerableSet`** or equivalent for membership, **`approve`** as above). **`EnumerableSet`** is **not** part of the **`IVault`** interface; it is an implementation detail.
- **`STRATEGY_DEPLOYER_ROLE`** — **`keccak256("STRATEGY_DEPLOYER_ROLE")`**. **`registerStrategy`** **MUST** be callable **only** by accounts holding this role (**no** extra gating beyond **`AccessControl`** for that function). **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`STRATEGY_DEPLOYER_ROLE`**.
- **No** dedicated **`restoreStrategyAllowance`** (or equivalent) on the Vault. **`registerStrategy`** **MUST** be **idempotent** for an **already-registered** **`strategy`**: a subsequent call **MUST NOT** **`revert`** solely because the strategy is already registered, and **MUST** set **`IERC20(token()).approve(strategy, type(uint256).max)`** so a **re-call** **restores** max allowance. Recovery from a broken allowance **MUST** use **`registerStrategy`** or a Vault **implementation** upgrade, **not** a separate normative Vault API in this spec.

### Cross-chain ratio (`postedTotalAssets` / `postedTotalSupply`)

- **MUST** expose **`uint256 postedTotalAssets`** and **`uint256 postedTotalSupply`** for ERC-4626-style ratio math. **How** values are chosen off-chain / on-chain is **unspecified**; **only** **`RATIO_POSTER_ROLE`** (**`keccak256("RATIO_POSTER_ROLE")`**) **MUST** write them. **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`RATIO_POSTER_ROLE`** only.
- **MUST** have **`view`** getters. Each successful update **MUST** **`emit`** an event that includes **`postedTotalAssets`**, **`postedTotalSupply`**, and **`uint64 postedAt`** (**`block.timestamp`**). **No** mandatory on-chain staleness in this spec.

### ERC-165, operators

- **ERC-165** — **`supportsInterface`** **MUST** return **true** for **`type(IERC4626).interfaceId`** where **`IERC4626`** is the canonical OpenZeppelin **`@openzeppelin/contracts/interfaces/IERC4626.sol`** (or an ABI-equivalent **`IERC4626`** used in this repo—the XOR id matches OZ’s interface). **EIP-4626** does **not** define a normative **`bytes4`** in the EIP text; the **authoritative value** is therefore **`type(IERC4626).interfaceId`** from that interface file. This vault is a **mixed profile**: **sync** ERC-4626 **deposits** plus **async** ERC-7540 **redemptions** only (**no** normative **`requestDeposit`**; async **deposit** overloads **revert**). **`supportsInterface`** **MUST** return **true** for the ERC-7540 asynchronous vault **redeem-leg** identifier **`0x620ee8e4`** so tooling can detect the async **redeem** / claim surface; integrators **MUST** treat async **deposits** as **unsupported** (not merely idle). The vault **MUST NOT** return **true** for **[ERC-7575](https://eips.ethereum.org/EIPS/eip-7575)** interface IDs. Normative accounting is **one** **`asset`** and **Accounting and `totalAssets`**, not a 7575 share-class / registry model.
- **`name` / `symbol`** — **SHOULD** reflect **`asset`** per ERC-4626.
- **ERC-7540 operators** — For **`withdraw` / `redeem`** (claim path), the implementation **MUST** follow ERC-7540: third argument is the **`controller`**, and the caller **MUST** be **`controller`** or an **`operator`** approved via **`setOperator` / `isOperator`**. Settlement (pending → claimable) **MUST NOT** be gated as if it were an ERC-7540 **operator** capability.

---

## Acceptance Criteria

1. **`IVault` (002)** + Strategy **`pullFromVault`** with registry and allowance; **`registerStrategy`** gated **only** by **`STRATEGY_DEPLOYER_ROLE`**, **idempotent** for already-registered strategies with **`approve(..., type(uint256).max)`** per **Strategy integration**; **no** **`restoreStrategyAllowance`**.
2. **ERC-4626** deposits and previews; **`requestDeposit`** reverts if present.
3. **ERC-7540** redemptions: **`requestRedeem`** burns shares; **`withdraw` / `redeem`** claim **`asset`** only; pending/claimable views; **`previewRedeem`** and **`previewWithdraw`** **MUST revert** (per **Redemptions (async, ERC-7540)**); cancel unsupported (revert if present); events per EIP.
4. **Settlement** — Permissionless; budgeted by Vault **`asset` balance**; **`IRedemptionSettlementPolicy`** plans allocation; admin can replace policy **`address`**.
5. **Beacon** deployment + initializer per **002** §A.1.
6. **`totalAssets()`** and **`convertTo*` / deposit `preview*`** per **Accounting and `totalAssets`** and ERC-4626 deposit rules under **Deposits (sync, ERC-4626)**.
7. Posted ratio fields, **`RATIO_POSTER_ROLE`**, getters, **`postedAt`** event.
8. **ERC-165** — **4626** **MUST** be reported via **`supportsInterface`** (**`type(IERC4626).interfaceId`**, see **ERC-165, operators**); **7575** **MUST NOT**; ERC-7540 **redeem-leg** id **`0x620ee8e4`** **MUST** be **true** (see **ERC-165, operators**).
9. **ERC-7540 operators** — **`setOperator` / `isOperator`** for claim-path **`withdraw` / `redeem`** per ERC-7540.
10. **`VaultBase` + `ERC7540AsyncRedeemVault`** — **`VaultBase`** (core) exists and is **not** the implementation pointer on the Vault **`UpgradeableBeacon`**; **`ERC7540AsyncRedeemVault`** is the **only** in-scope concrete vault (**sync** deposits, **async** withdrawals).

---

## Edge Cases

- **`totalAssets()`** is raw balances (Vault + registered Strategies) with **no** virtual adjustment for pending vs claimable redemptions—integrators **MUST NOT** assume it equals immediately withdrawable economic exposure.
- Settlement uses **only** the Vault’s **`asset` balance**; if funds sit in Strategies, fulfillment **MAY** move **zero** until **`pushToVault`** (or equivalent transfer).
- Invalid or greedy **`settlementPlan`** output **MUST** cause settlement to **`revert`** after Vault-side validation.
- Rounding follows ERC-4626 / ERC-7540 where applicable; extreme **`totalSupply()`** / **`totalAssets()`** ratios can still produce **0** shares or assets in edge inputs—callers **SHOULD** use **`preview*`** and **`max*`** as defined by the EIPs.
- **Unsupported `asset`** types (fee-on-transfer, rebasing) per **002** unless separately documented for a deployment.
- **`postedTotalAssets` / `postedTotalSupply`** carry **no** mandatory on-chain staleness guard; consumers of posted ratio **MUST** treat freshness as a deployment / operational concern.
- **Explicit non-goals (unless added later):** bridge vendor / message format; Strategy **`exec`** / Merkle allowlist (**001**) beyond **002**; async deposits; normative pause/circuit-breaker; normative fee design; **ERC-7575**; Vault **`restoreStrategyAllowance`**; any concrete vault other than **`ERC7540AsyncRedeemVault`** (**sync** deposits, **async** withdrawals), including alternate deposit modalities not built on this modular **`VaultBase`** stack.

### References

- [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
- [EIP-7540](https://eips.ethereum.org/EIPS/eip-7540)
- `docs/spec/002-strategy.md` — **`IVault`**, Strategy pipe
- `contracts/interfaces/vault/IVault.sol`
- `@openzeppelin/contracts/interfaces/IERC4626.sol` — **`type(IERC4626).interfaceId`** for **ERC-165** (EIP-4626 does not fix a **`bytes4`** in the EIP body)
