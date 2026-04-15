# Feature: Vault (ERC-4626 + ERC-7540, Strategy integration)

Normative spec for **one** deployable **`Vault`**: depositor entry and accounting for a single ERC-20 **`asset`**, with **Strategies** moving liquidity via **`pullFromVault` / `pushToVault`** per **`docs/spec/002-strategy.md`**. The **`Vault`** **MUST** implement **[ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)** (sync **`deposit` / `mint`**) and **[ERC-7540](https://eips.ethereum.org/EIPS/eip-7540)** (async redemption). The **`IVault`** interface for Strategies **MUST** match **`contracts/vault/IVault.sol`**; ERC-4626 / ERC-7540 entrypoints are **in addition** to that interface.

**Status:** Decisions in this revision are resolved; reintroduce an explicit TBD table in this doc when new choices are pending.

---

## Goal

Deliver **`VaultBase`** (shared logic, **not** the beacon implementation) and a concrete **`Vault`** behind **`BeaconProxy`** (**sync** deposits, **async** withdrawals only—no other **`Vault*`** variant in scope).

1. **Deposits** — Atomic **`deposit` / `mint`**; async **`requestDeposit`** not supported (**MUST** **`revert`** if present in ABI).
2. **Exits** — **`requestRedeem`** → pending → role settlement → claimable → **`withdraw` / `redeem`** per ERC-7540.
3. **Settlement** — **`REQUEST_FULFILLER_ROLE`** **MAY** run **at any time**; each run budgets from the Vault’s **`asset` balance**; allocation ordering **MUST** come **only** from **`IRedemptionFulfillmentPolicy`** (see subsection below).
4. **Strategies** — **`registerStrategy`** + allowance per **002**; no extra Vault APIs that move **`token()`** outside **002**.
5. **Cross-chain ratio** — Expose **`postedTotalAssets` / `postedTotalSupply`** + **`RATIO_POSTER_ROLE`**.

**Architecture (fixed):** Redemption **settlement** (pending → claimable) **only** via **`REQUEST_FULFILLER_ROLE`**, using the Vault’s **on-chain `asset` balance** and a pluggable **`IRedemptionFulfillmentPolicy`**. Cross-chain fields **`postedTotalAssets` / `postedTotalSupply`** **MUST** be writable **only** by **`RATIO_POSTER_ROLE`**. The implementation **MUST** ship behind OpenZeppelin **`BeaconProxy` + `UpgradeableBeacon`** (Vault-dedicated beacon, same pattern as **002** §A.1).

### Deposits (sync, ERC-4626)

- **`deposit` / `mint`** — Pull **`asset`**, **`mint`** shares to receiver; **`previewDeposit` / `previewMint`** and deposit **`max*`** per ERC-4626 (plus deployment caps if any).
- **`requestDeposit`** — **Out of scope**; if present for ABI compatibility, **MUST** **`revert`** (e.g. **`AsyncDepositNotSupported()`**).

### Redemptions (async, ERC-7540)

- **`requestRedeem`** — **`burn`** shares from **`owner`** (no share escrow / no **`transferFrom`** to Vault). **`totalSupply`** **MUST** drop at request time. **`previewRedeem`** **MUST revert** (ERC-7540). **`previewWithdraw`** (ERC-4626) **MUST revert** as well: this spec’s exit path is **async** (**claim** via **`withdraw` / `redeem`** only); ERC-7540 does **not** mandate that rule for **`previewWithdraw`**, so it is **required here** as product behavior, not as an ERC-7540 citation.
- **`cancelRedeemRequest`** — **Not** supported; if present, **MUST** **`revert`**. **MUST NOT** emit **`CancelRedeemRequest`**.
- **`pendingRedeemRequest`**, **`claimableRedeemRequest`**, **`maxWithdraw` / `maxRedeem`** — Per ERC-7540 for the redemption leg.
- **`withdraw` / `redeem`** — **Claim** only: transfer **`asset`** for **claimable** amounts; **MUST NOT** **`burn`** shares again or require a second share movement. **`RedeemRequest`** event per ERC-7540.

### Request IDs

- **Recommended default:** **`requestId == 0`** for **`requestRedeem`** and related views (state keyed by **`controller`**).
- **Conformance with non-zero IDs:** Implementations **MAY** use **`requestId != 0`** **only if** they **still satisfy** ERC-7540 and the settlement / **`IRedemptionFulfillmentPolicy`** rules in this spec, and the scheme **MUST** be documented for integrators (e.g. deployment README or NatSpec). **Not** recommended unless there is a clear product reason.

### `REQUEST_FULFILLER_ROLE` and settlement

- **Role** — **`REQUEST_FULFILLER_ROLE`**, **`keccak256("REQUEST_FULFILLER_ROLE")`** (same normative style as **`STRATEGY_DEPLOYER_ROLE`** and **`RATIO_POSTER_ROLE`**). **Any** step that **materially** moves redemption state from **pending** toward **claimable** so users can **`withdraw` / `redeem`** **MUST** be callable **only** by accounts **holding** this role. **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** it but **MUST NOT** settle without also holding **`REQUEST_FULFILLER_ROLE`**; **no** other bypass.
- **When / budget** — Settlement **MAY** run **at any time**. Each run **MUST** cap fulfillment by the Vault’s **`IERC20(asset).balanceOf(address(this))`** at execution time (not Strategy balances). Strategies **MUST** **`pushToVault`** (or transfer) **before** settlement if their custody should fund claims.
- **Allocation** — Ordering and slices across controllers **MUST** come from **`IRedemptionFulfillmentPolicy.planFulfillment`**, not hard-coded Vault branches.

### Implementation shape

- **`VaultBase`** — **MUST** hold shared logic: **`IVault`** (**002**), **`totalAssets()`**, strategy registry + **`registerStrategy`**, **`postedTotalAssets` / `postedTotalSupply`**, redemption ledger (pending / claimable), **`REQUEST_FULFILLER_ROLE`** settlement and **`IRedemptionFulfillmentPolicy`** integration, **`AccessControl`** / role ids, and related storage. **`VaultBase`** **MUST NOT** be the **implementation contract** pointed to by the Vault’s **`UpgradeableBeacon`** (i.e. **not** the beacon’s implementation pointer); it **MAY** be **`abstract`**. Extra **libraries** / **helpers** are **implementation freedom** if **`Vault`**’s external behavior matches this spec.
- **`Vault`** — **MUST** be the **concrete** contract set on the Vault **`UpgradeableBeacon`**: extends **`VaultBase`**, implements sync deposits and async redemptions above, and the **ERC-165** rules under **ERC-165, operators**. **No** other concrete Vault **variant** for deposit modality is **in scope** (see **Edge Cases** / non-goals).
- **Beacon** — Live **`Vault`** **MUST** be **`BeaconProxy`** with **`UpgradeableBeacon`** (Vault-dedicated beacon, **not** shared with Strategy). Updating the beacon’s implementation pointer **MUST** be **restricted** to protocol admin (or equivalent) on the beacon. **`constructor`** empty of mutable state; **`initializer`** + storage **gaps** per **002** §A.1.

### `IRedemptionFulfillmentPolicy`

**Purpose:** Swap or upgrade a **policy** contract to change FIFO / sweep-until-budget / pro-rata / **etc.** without editing Vault **implementation** code.

**Interface (normative):**

```solidity
struct FulfillmentSlice {
  address controller;
  uint256 requestId;
  uint256 assetsToClaimable;
}

interface IRedemptionFulfillmentPolicy {
  /// Read-only: pending → claimable this round; sum of assetsToClaimable <= maxAssets.
  function planFulfillment(address vault, uint256 maxAssets) external view returns (FulfillmentSlice[] memory);
}
```

Names **MAY** differ if documented; semantics **MUST** match: **read-only** plan, **sum ≤ `maxAssets`**, each slice **≤** pending for that **`controller` / `requestId`**. **`planFulfillment`** **MUST NOT** write storage or be **`payable`**.

**Vault:** On settlement: set **`maxAssets` ≤** Vault **`asset` balance**; **`staticcall`** **`planFulfillment(address(this), maxAssets)`**; **validate**; **apply** pending→claimable **only** if checks pass; else **`revert`**. Vault **MUST NOT** give **`asset`** custody to the policy. Policy is **trusted for ordering**, not custody.

**Admin:** **`DEFAULT_ADMIN_ROLE`** **MUST** be able to **`setRedemptionFulfillmentPolicy(address)`** in one tx. **Initializer** **MUST** set a **non-zero** policy. **`REQUEST_FULFILLER_ROLE`** **MAY** call settlement multiple times; policies **MAY** cap loop iterations (document per policy).

### Accounting and `totalAssets`

- **`asset()`** **MUST** match **`IVault.token()`**.
- **`totalAssets()`** **MUST** equal **`IERC20(asset).balanceOf(address(this))` + Σ `IERC20(asset).balanceOf(s)`** for **every** registered strategy **`s`** with **`isRegisteredStrategy(s) == true`**. **MUST NOT** include unregistered addresses, arbitrary EOAs, or Satellite deployments unless a future spec extends the set. **MUST NOT** apply a virtual adjustment for pending vs claimable redemptions.
- **`preview*` / `convertTo*`** (where EIP applies) **MUST** follow **ERC-4626** from **`totalAssets()`** and **`totalSupply()`** only.
- **Fees** — **Out of scope**. Rounding **MUST** still follow ERC-4626 / ERC-7540 where the EIPs apply. **Unsupported `asset`** — Same constraints as **002** (no fee-on-transfer / rebasing unless explicitly documented).

### Strategy integration

- **`IVault`** (**`contracts/vault/IVault.sol`**) — **`token()`**, **`registerStrategy`**, **`isRegisteredStrategy`** only; NatSpec on **`registerStrategy`** requires **`token().approve(strategy, type(uint256).max)`** and registry behavior per **002**.
- **Implementation** — **MUST** satisfy **002** (e.g. **`EnumerableSet`** or equivalent for membership, **`approve`** as above). **`EnumerableSet`** is **not** part of the **`IVault`** interface; it is an implementation detail.
- **`STRATEGY_DEPLOYER_ROLE`** — **`keccak256("STRATEGY_DEPLOYER_ROLE")`**. **`registerStrategy`** **MUST** be callable **only** by accounts holding this role (**no** extra gating beyond **`AccessControl`** for that function). **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`STRATEGY_DEPLOYER_ROLE`**.
- **No** dedicated **`restoreStrategyAllowance`** (or equivalent) on the Vault. **`registerStrategy`** **MUST** be **idempotent** for an **already-registered** **`strategy`**: a subsequent call **MUST NOT** **`revert`** solely because the strategy is already registered, and **MUST** set **`IERC20(token()).approve(strategy, type(uint256).max)`** so a **re-call** **restores** max allowance. Recovery from a broken allowance **MUST** use **`registerStrategy`** or a Vault **implementation** upgrade, **not** a separate normative Vault API in this spec.

### Cross-chain ratio (`postedTotalAssets` / `postedTotalSupply`)

- **MUST** expose **`uint256 postedTotalAssets`** and **`uint256 postedTotalSupply`** for ERC-4626-style ratio math. **How** values are chosen off-chain / on-chain is **unspecified**; **only** **`RATIO_POSTER_ROLE`** (**`keccak256("RATIO_POSTER_ROLE")`**) **MUST** write them. **`DEFAULT_ADMIN_ROLE`** **MUST** **grant/revoke** **`RATIO_POSTER_ROLE`** only.
- **MUST** have **`view`** getters. Each successful update **MUST** **`emit`** an event that includes **`postedTotalAssets`**, **`postedTotalSupply`**, and **`uint64 postedAt`** (**`block.timestamp`**). **No** mandatory on-chain staleness in this spec.

### ERC-165, operators

- **ERC-165** — **`supportsInterface`** **MUST** return **true** for **`type(IERC4626).interfaceId`** where **`IERC4626`** is the canonical OpenZeppelin **`@openzeppelin/contracts/interfaces/IERC4626.sol`** (or an ABI-equivalent **`IERC4626`** used in this repo—the XOR id matches OZ’s interface). **EIP-4626** does **not** define a normative **`bytes4`** in the EIP text; the **authoritative value** is therefore **`type(IERC4626).interfaceId`** from that interface file. This Vault is a **mixed profile**: **sync** ERC-4626 **deposits** plus **async** ERC-7540 **redemptions** only (**no** normative **`requestDeposit`**, **no** ERC-7540 **operators**). Advertising the **EIP-7540** canonical interface ID via **`supportsInterface`** **MAY** mislead tooling that assumes a symmetric async **deposit** leg or operator support; therefore the Vault **SHOULD NOT** return **true** for that ID **unless** deployment docs explicitly document this partial **7540** surface (stubs **revert**, redeem leg only). The Vault **MUST NOT** return **true** for **[ERC-7575](https://eips.ethereum.org/EIPS/eip-7575)** interface IDs. Normative accounting is **one** **`asset`** and **Accounting and `totalAssets`**, not a 7575 share-class / registry model.
- **`name` / `symbol`** — **SHOULD** reflect **`asset`** per ERC-4626.
- **ERC-7540 operators** — **Not** supported. The Vault **MUST NOT** implement delegated **operator** flows (**`setOperator`** / **`isOperator`**, or EIP equivalents) for **`requestRedeem`**, **`withdraw`**, **`redeem`**, or related views. User-facing redemption actions **MUST** follow **owner** / **`msg.sender`** semantics per ERC-7540 **without** a separate operator registry. **`REQUEST_FULFILLER_ROLE`** is **only** for **settlement** (pending → claimable) and **MUST NOT** be treated as an ERC-7540 **operator**. If the deployed ABI includes optional operator entrypoints for interface compatibility, they **MUST** **`revert`** (e.g. **`OperatorsNotSupported()`**) unless a **future** spec enables them.

---

## Acceptance Criteria

1. **`IVault` (002)** + Strategy **`pullFromVault`** with registry and allowance; **`registerStrategy`** gated **only** by **`STRATEGY_DEPLOYER_ROLE`**, **idempotent** for already-registered strategies with **`approve(..., type(uint256).max)`** per **Strategy integration**; **no** **`restoreStrategyAllowance`**.
2. **ERC-4626** deposits and previews; **`requestDeposit`** reverts if present.
3. **ERC-7540** redemptions: **`requestRedeem`** burns shares; **`withdraw` / `redeem`** claim **`asset`** only; pending/claimable views; **`previewRedeem`** and **`previewWithdraw`** **MUST revert** (per **Redemptions (async, ERC-7540)**); cancel unsupported (revert if present); events per EIP.
4. **Settlement** — Only **`REQUEST_FULFILLER_ROLE`**; budgeted by Vault **`asset` balance**; **`IRedemptionFulfillmentPolicy`** plans allocation; admin can replace policy **`address`**.
5. **Beacon** deployment + initializer + gaps per **002** §A.1.
6. **`totalAssets()`** and **`convertTo*` / deposit `preview*`** per **Accounting and `totalAssets`** and ERC-4626 deposit rules under **Deposits (sync, ERC-4626)**.
7. Posted ratio fields, **`RATIO_POSTER_ROLE`**, getters, **`postedAt`** event.
8. **ERC-165** — **4626** **MUST** be reported via **`supportsInterface`** (**`type(IERC4626).interfaceId`**, see **ERC-165, operators**); **7575** **MUST NOT**; **7540** id **SHOULD NOT** be advertised unless deployment docs document the partial redeem-only **7540** profile (see **ERC-165, operators**).
9. **ERC-7540 operators** — **not** supported; optional operator hooks **revert** if present.
10. **`VaultBase` + `Vault`** — **`VaultBase`** exists and is **not** the implementation pointer on the Vault **`UpgradeableBeacon`**; **`Vault`** is the **only** in-scope concrete Vault (**sync** deposits, **async** withdrawals).

---

## Edge Cases

- **`totalAssets()`** is raw balances (Vault + registered Strategies) with **no** virtual adjustment for pending vs claimable redemptions—integrators **MUST NOT** assume it equals immediately withdrawable economic exposure.
- Settlement uses **only** the Vault’s **`asset` balance**; if funds sit in Strategies, fulfillment **MAY** move **zero** until **`pushToVault`** (or equivalent transfer).
- Invalid or greedy **`planFulfillment`** output **MUST** cause settlement to **`revert`** after Vault-side validation.
- Rounding follows ERC-4626 / ERC-7540 where applicable; extreme **`totalSupply()`** / **`totalAssets()`** ratios can still produce **0** shares or assets in edge inputs—callers **SHOULD** use **`preview*`** and **`max*`** as defined by the EIPs.
- **Unsupported `asset`** types (fee-on-transfer, rebasing) per **002** unless separately documented for a deployment.
- **`postedTotalAssets` / `postedTotalSupply`** carry **no** mandatory on-chain staleness guard; consumers of posted ratio **MUST** treat freshness as a deployment / operational concern.
- **Explicit non-goals (unless added later):** bridge vendor / message format; Strategy **`exec`** / Merkle allowlist (**001**) beyond **002**; async deposits; normative pause/circuit-breaker; normative fee design; **ERC-7575**; Vault **`restoreStrategyAllowance`**; **ERC-7540** delegated **operators**; any concrete **`Vault*`** other than **`Vault`** (**sync** deposits, **async** withdrawals), including alternate deposit modalities on **`VaultBase`**.

### References

- [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
- [EIP-7540](https://eips.ethereum.org/EIPS/eip-7540)
- `docs/spec/002-strategy.md` — **`IVault`**, Strategy pipe
- `contracts/vault/IVault.sol`
- `@openzeppelin/contracts/interfaces/IERC4626.sol` — **`type(IERC4626).interfaceId`** for **ERC-165** (EIP-4626 does not fix a **`bytes4`** in the EIP body)
