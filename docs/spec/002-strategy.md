# Feature: Strategy

**Strategy** (same chain as Vault) and **SatelliteStrategy** (intermediary; often on another chain; no Vault pipe) share **`BeaconProxy`** / **`UpgradeableBeacon`** and a validator-gated **`exec`**. This document defines **`IVault`**, shared rules (**§A**), Strategy (**§B**), and SatelliteStrategy (**§C**). Concrete Vault code beyond **`IVault`** is out of scope.

**Governed** / **policy-governed** means the **deployed validator** decides whether an **`exec`** attempt is allowed (together with any **`AccessControl`** on **`exec`** documented for that deployment). This excludes the §B **`pull`/`push`** pipe, which bypasses the validator.

## Goal

1. **Strategy** — Move **`IERC20(IVault.asset())`** only via **`pullFromVault`** / **`pushToVault`**, callable only by accounts holding **`VAULT_TOKEN_LIQUIDITY_ROLE`**. Pipe bypasses the validator. One Vault, many Strategy instances (**`IVault.registerStrategy`**).
2. **SatelliteStrategy** — No §B pipe; **governed** external interaction via **`exec`** + validator; custody of other assets; one §B Strategy MAY map to many SatelliteStrategy deployments.
3. **Shared** — OpenZeppelin **one beacon per implementation** (**Strategy** vs **SatelliteStrategy**); exactly **one** validator contract per deployed instance, implementing **one** protocol-wide validator interface (**§A.2**); **Strategy** / **SatelliteStrategy** logic stays independent of Merkle vs other concrete validators behind that interface.

## Acceptance Criteria

### §A. Shared

Subsections **§A.1**–**§A.3** below.

#### §A.1 Upgradeability

Deployments MUST use OpenZeppelin **`BeaconProxy`** and **`UpgradeableBeacon`**. Use the upgradeable initializer pattern (**no** mutable state in **`constructor`**; state in **`initializer`**); storage **gaps** per project norms.

**Strategy** and **SatelliteStrategy** MUST be **different** implementation contracts → **two** beacons. Vault-linked **`BeaconProxy`** instances use the **Strategy** beacon; SatelliteStrategy uses the **SatelliteStrategy** beacon. Only **protocol admin** may upgrade each beacon (e.g. **`Ownable`** on **`UpgradeableBeacon`**). Beacons are per **implementation line**, not per instance.

**Initializer (minimum)** — Each proxy’s **`initializer`** MUST wire at least:

- **`Strategy`**: immutable **`IVault vault`**; immutable **`address validator`** implementing the agreed validator interface (**§A.2**); **`AccessControl`** / **`AccessControlUpgradeable`** admin (e.g. **`defaultAdmin`** for **`DEFAULT_ADMIN_ROLE`**); any further roles (**`VAULT_TOKEN_LIQUIDITY_ROLE`**, optional **`exec`** role) per deployment docs.
- **`SatelliteStrategy`**: immutable **`validator`**; **`defaultAdmin`** (and same optional role pattern as above). No **`vault`**.

Replacing **`validator`** after init (upgrade, two-step, **etc.**) is **not** required by this spec; if supported, it MUST be documented and access-controlled.

Implementations MAY factor shared logic (**`exec`**, validator wiring, storage gaps, **`AccessControl`**) into an **`abstract`** base contract extended by both concrete implementations; layout and inheritance are product-defined.

#### §A.2 Validator model and `exec`

There is **exactly one** **`validator`** contract address per deployed **Strategy** or **SatelliteStrategy** instance (**immutable** after initialization unless the implementation documents a governed replacement path).

All validators MUST implement **one** protocol-wide interface at the Solidity boundary (same **`isAllowed`**-style entrypoint and argument shapes for every deployment). **Strategy** and **SatelliteStrategy** depend on that interface only, not on Merkle vs other internals. The reference shape in this repo is **`IMerkleCallAllowlist`** with **`CallVerificationInput`** (`contracts/vault/interfaces/IMerkleCallAllowlist.sol`); alternate validator **implementations** MUST remain ABI-compatible at that boundary.

If a path performs an arbitrary external call **`(to, value, data)`** subject to policy, it MUST go through **one** externally visible function named **`exec`** (do **not** use **`execute`** as the canonical Solidity or documentation name):

```solidity
function exec(address to, uint256 value, bytes calldata data, bytes calldata validatorArgs) external;
```

- After successful validation, perform **`to.call{value: value}(data)`** (or equivalent); MUST **`revert`** if validation fails; follow CEI / reentrancy discipline.
- **`validatorArgs`** carries proof / rule bytes for **`isAllowed`**. Encoding is per deployment; for the **Merkle allowlist** path, **`CallVerificationInput`** and ABI rules are normative in **`docs/spec/001-merkle-call-data-allowlist.md`** (this spec does not duplicate that table).
- **`sender`** passed to **`isAllowed`** MUST be **`msg.sender`** of **`exec`**, not **`address(this)`**.
- The validator MUST NOT execute the contract’s calls; it MUST only indicate allowed / denied.

**Funding `value` on `exec`** — How **`value`** is covered (**`msg.value`** on **`exec`** vs balance already held by the contract) is **implementation-defined** and MUST be documented per deployment.

**Native ingress** — **`receive`** / **`fallback`** MAY exist to fund native balance. They MUST **not** perform validator-governed external calls without going through **`exec`**.

#### §A.3 Token custody

For **Strategy (§B)**, **`IVault.asset()`** (ERC-4626 underlying) is the only token for **`pullFromVault`** / **`pushToVault`**.

**Strategy** and **SatelliteStrategy** MAY hold other assets (ERC-20, native, ERC-721/1155, **etc.**). On **Strategy**, any **state-changing** use of held assets that is **not** **`pullFromVault`** / **`pushToVault`** for **`IVault.asset()`** MUST go through **`exec`** (validator-governed). On **SatelliteStrategy**, any **state-changing** external interaction MUST go through **`exec`**; attempts that fail validation **`revert`** (fail-closed).

**`view`** / **`pure`** helpers and **internal** accounting that do not perform external calls are **not** required to use **`exec`**. Any **external** interaction that changes token allowances, balances, or native positions in a way protocol policy cares about (**`approve`**, **`permit`**, wrap/unwrap such as WETH, swaps, **etc.**) MUST be executed **as part of** an **`exec`** path so the validator authorizes the same **`(to, value, data)`** (no “thin” public wrappers that bypass **`exec`** for those effects).

### §B. Strategy and `IVault`

Any Vault used with a §B Strategy MUST implement **`IVault`**. **`registerStrategy`** MUST atomically record **`strategy`** as registered and **`IERC20(asset()).approve(strategy, type(uint256).max)`** so **`pullFromVault`** can **`transferFrom(vault, strategy, amount)`**. Authorization for **`registerStrategy`** is implementation-defined and outside **`IVault`**’s scope.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVault {
  /// @notice §B pipe asset; MUST be standard ERC-20 (no fee-on-transfer, no rebasing). Same as ERC-4626 `asset()`.
  function asset() external view returns (address);

  /// @notice Register `strategy`, track membership, IERC20(asset()).approve(strategy, type(uint256).max). Caller auth: implementation-defined.
  function registerStrategy(address strategy) external;

  /// @notice Whether `strategy` is registered with this Vault.
  function isRegisteredStrategy(address strategy) external view returns (bool);
}
```

Strategy MUST hold an **immutable** **`IVault`**-typed reference to the Vault contract address; resolve the pipe token with **`vault.asset()`** (same as ERC-4626 **`asset()`** when the vault is ERC-4626).

**Token** — Exactly one ERC-20 in the pipe; **`IERC20(vault.asset())`** MUST be standard (balances match transfers). No protocol fees on **`pullFromVault`** / **`pushToVault`**.

**RBAC** — **`AccessControlUpgradeable`**. Only **`DEFAULT_ADMIN_ROLE`** may **`grantRole`** / **`revokeRole`**. At deploy, assign **`DEFAULT_ADMIN_ROLE`** to protocol-controlled governance (e.g. multisig, timelock). **`exec`** MAY require a dedicated **`AccessControl`** role, MAY omit a role and rely on the validator as the **sole** authorization gate for **`exec`**, or MAY combine role checks with the validator; the deployment MUST document which applies. **`VAULT_TOKEN_LIQUIDITY_ROLE`** MUST NOT gate **`exec`** unless the deployment explicitly documents that reuse.

```solidity
bytes32 public constant VAULT_TOKEN_LIQUIDITY_ROLE = keccak256("VAULT_TOKEN_LIQUIDITY_ROLE");
```

**Pipe** — Vault ↔ Strategy **`token()`** movement ONLY via **`pullFromVault`** / **`pushToVault`**, **`onlyRole(VAULT_TOKEN_LIQUIDITY_ROLE)`** (or equivalent). **`msg.sender == vault`** MUST NOT authorize these. They MUST NOT go through the validator. Vault MUST NOT expose APIs for moving **`token()`** to or from Strategy **other** than the §B pipe pattern (e.g. no **`depositToStrategy`** / **`withdrawFromStrategy`**).

**`pullFromVault(uint256 amount)`** — **`transferFrom(vault, address(this), amount)`** of **`IERC20(vault.asset())`** with allowance from **`registerStrategy`**. **`pushToVault(uint256 amount)`** — **`IERC20(vault.asset()).transfer(vault, amount)`** (plain ERC-20 transfer to **`vault`** as an address). **`IVault`** does **not** define **`deposit`**, **`mint`**, or other receive hooks; if a Vault implementation required a non-standard receipt path (e.g. **`deposit(uint256)`**), that is **outside** this spec’s **`IVault`** / **`pushToVault`** model. Both **`pullFromVault`** and **`pushToVault`** MUST **`revert`** without role.

**Other interactions** (non-pipe) MUST use **`exec`** (**§A.2**), consistent with **§A.3**.

### §C. SatelliteStrategy

No **`IVault`** pipe and no required link to a home-chain Vault or §B Strategy. **One** §B Strategy MAY have **multiple** SatelliteStrategy instances. **Policy-governed** external calls MUST use **`exec`** only (**§A.2**). SatelliteStrategy MUST NOT expose parallel unvalidated surfaces for the same class of calls. Token rules: **§A.3**.

## Edge Cases

- **`exec`** — allowed → call; denied → **`revert`**. Validator internals are out of scope here.
- If **`sender`** in policy does not match the real **`exec`** caller, the call MUST **`revert`**.
- **Several Strategy instances** — independent liquidity and **`exec`**; no cross-Strategy lock in this spec.
