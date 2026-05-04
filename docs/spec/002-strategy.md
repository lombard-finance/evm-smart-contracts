# Feature: Strategy

**Strategy** (same chain as Vault) and **SatelliteStrategy** (intermediary; often on another chain; no Vault pipe) share **`BeaconProxy`** / **`UpgradeableBeacon`** and a validator-gated **`exec`**. This document defines **`IVault`**, shared rules (**§A**), Strategy (**§B**), and SatelliteStrategy (**§C**). Concrete Vault code beyond **`IVault`** is out of scope.

**Governed** / **policy-governed** means the **deployed validator** decides whether an **`exec`** attempt is allowed (together with any **`AccessControl`** on **`exec`** documented for that deployment). This excludes the §B **`pull`/`push`** pipe, which bypasses the validator.

## Goal

1. **Strategy** — Move any ERC-20 via **`pullFromVault`** / **`pushToVault`**, callable only by accounts holding **`VAULT_TOKEN_LIQUIDITY_ROLE`**. Pipe bypasses the validator. One Vault, many Strategy instances (**`IVault.requestFunding`** is the vault-side hook).
2. **SatelliteStrategy** — No §B pipe; **governed** external interaction via **`exec`** + validator; custody of other assets; one §B Strategy MAY map to many SatelliteStrategy deployments.
3. **Shared** — OpenZeppelin **one beacon per implementation** (**Strategy** vs **SatelliteStrategy**); exactly **one** validator contract per deployed instance, implementing **one** protocol-wide validator interface (**§A.2**); **Strategy** / **SatelliteStrategy** logic stays independent of Merkle vs other concrete validators behind that interface.

## Acceptance Criteria

### §A. Shared

Subsections **§A.1**–**§A.3** below.

#### §A.1 Upgradeability

Deployments MUST use OpenZeppelin **`BeaconProxy`** and **`UpgradeableBeacon`**. Use the upgradeable initializer pattern (**no** mutable state in **`constructor`**; state in **`initializer`**); storage uses ERC-7201 namespaced slots.

**Strategy** and **SatelliteStrategy** MUST be **different** implementation contracts → **two** beacons. Vault-linked **`BeaconProxy`** instances use the **Strategy** beacon; SatelliteStrategy uses the **SatelliteStrategy** beacon. Only **protocol admin** may upgrade each beacon (e.g. **`Ownable`** on **`UpgradeableBeacon`**). Beacons are per **implementation line**, not per instance.

**Initializer (minimum)** — Each proxy's **`initializer`** MUST wire at least:

- **`Strategy`**: immutable **`IVault vault`**; **`IStrategyExecValidator validator`** implementing the agreed validator interface (**§A.2**); **`AccessControl`** admin (e.g. **`DEFAULT_ADMIN_ROLE`**); **`VAULT_TOKEN_LIQUIDITY_ROLE`** holder; optionally **`PRIVILEGED_EXECUTOR_ROLE`** per deployment docs.
- **`SatelliteStrategy`**: **`IStrategyExecValidator validator`**; **`defaultAdmin`** (and same optional role pattern as above). No **`vault`**.

Replacing **`validator`** after init is supported via **`setValidator(IStrategyExecValidator)`** (see **§A.2**); it MUST be access-controlled (**`DEFAULT_ADMIN_ROLE`**).

Implementations MAY factor shared logic (**`exec`**, validator wiring, storage gaps, **`AccessControl`**) into an **`abstract`** base contract extended by both concrete implementations (**`StrategyBaseUpgradeable`**); layout and inheritance are product-defined.

#### §A.2 Validator model and `exec`

There is **exactly one** **`validator`** contract address per deployed **Strategy** or **SatelliteStrategy** instance at any given time. The validator MAY be replaced by **`DEFAULT_ADMIN_ROLE`** via **`setValidator(IStrategyExecValidator newValidator)`**; a replacement MUST NOT use a zero address and MUST emit **`ValidatorUpdated(old, new)`**.

All validators MUST implement the protocol-wide **`IStrategyExecValidator`** interface at the Solidity boundary (`contracts/vault/interfaces/IStrategyExecValidator.sol`):

```solidity
interface IStrategyExecValidator {
  function isAllowed(
    address sender,
    address to,
    uint256 value,
    bytes calldata data,
    bytes calldata validatorArgs
  ) external view returns (bool);
}
```

**Strategy** and **SatelliteStrategy** depend on that interface only, not on Merkle vs other internals. When the **Merkle allowlist validator** (see **`docs/spec/001-merkle-call-data-allowlist.md`**) is used, callers ABI-encode a **`CallVerificationInput`** struct into `validatorArgs`; the validator decodes it internally.

If a path performs an arbitrary external call **`(to, value, data)`** subject to policy, it MUST go through **one** of the two **`exec`** overloads:

**Validator-gated overload** (no special role required beyond the validator's own policy):

```solidity
function exec(
  address to,
  uint256 value,
  bytes calldata data,
  bytes calldata validatorArgs
) external payable returns (bytes memory);
```

**Privileged overload** (bypasses the validator entirely; requires **`PRIVILEGED_EXECUTOR_ROLE`**):

```solidity
function exec(address to, uint256 value, bytes calldata data) external payable returns (bytes memory);
```

Both overloads:

- Are **`payable`**; ETH from **`msg.value`** is credited to the contract balance before the forwarded call.
- After successful authorization (or role check for the privileged overload), perform **`payable(to).call{value: value}(data)`**; MUST **`revert`** if the call fails.
- Require **`address(this).balance >= value`** at call time; MUST **`revert`** (**`Strategy_InvalidEthFunding`**) otherwise.
- Follow CEI / reentrancy discipline (**`nonReentrant`**).
- Allow **`to == address(this)`** by design: calldata may invoke this contract (e.g. role grants on itself), so policy / the validator MUST explicitly allow or deny self-targeted calls.
- Emit **`Executed(sender, to, value, data)`** on success.
- Return the raw `bytes` return value from the external call.

For the **validator-gated overload**:

- **`sender`** passed to **`isAllowed`** MUST be **`msg.sender`** of **`exec`**, not **`address(this)`**.
- MUST **`revert`** (**`Strategy_CallNotAllowed`**) if **`validator.isAllowed`** returns `false`.
- **`validatorArgs`** carries proof / rule bytes for **`isAllowed`**. Encoding is per deployment; for the **Merkle allowlist** path, callers ABI-encode **`CallVerificationInput`** as `validatorArgs`.

The validator MUST NOT execute the contract's calls; it MUST only indicate allowed / denied.

**`PRIVILEGED_EXECUTOR_ROLE`** — accounts holding this role MAY use the no-`validatorArgs` overload; the validator is not consulted. This role is for trusted operators that need to bypass policy for operational reasons.

**Funding `value` on `exec`** — How **`value`** is covered (**`msg.value`** on **`exec`** vs native balance already held by the contract) is **implementation-defined** and MUST be documented per deployment.

**Native ingress** — A **`receive`** function MUST exist to accept plain ETH transfers so the strategy balance can be pre-funded for `exec`. It MUST **not** perform validator-governed external calls.

#### §A.3 Token custody

For **Strategy (§B)**, **`vault.asset()`** is the typical pipe token, but **`pullFromVault`** and **`pushToVault`** accept any ERC-20 token argument. Any token may be held by the strategy.

**Strategy** and **SatelliteStrategy** MAY hold other assets (ERC-20, native, ERC-721/1155, **etc.**). On **Strategy**, any **state-changing** use of held assets that is **not** **`pullFromVault`** / **`pushToVault`** MUST go through **`exec`** (validator-governed). On **SatelliteStrategy**, any **state-changing** external interaction MUST go through **`exec`**; attempts that fail validation **`revert`** (fail-closed).

**`view`** / **`pure`** helpers and **internal** accounting that do not perform external calls are **not** required to use **`exec`**. Any **external** interaction that changes token allowances, balances, or native positions in a way protocol policy cares about (**`approve`**, **`permit`**, wrap/unwrap such as WETH, swaps, **etc.**) MUST be executed **as part of** an **`exec`** path so the validator authorizes the same **`(to, value, data)`** (no "thin" public wrappers that bypass **`exec`** for those effects).

### §B. Strategy and `IVault`

Any Vault used with a §B Strategy MUST implement **`IVault`**. The Vault-side hook for liquidity is **`requestFunding`**: when called by a registered strategy, the Vault transfers the requested token amount directly to the calling strategy. There is **no** `approve` / `transferFrom` pattern between Vault and Strategy; the Vault pushes tokens on demand when a registered strategy calls `requestFunding`.

```solidity
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IVault {
  /// @notice Implementation-defined semantic version string.
  function version() external view returns (string memory);

  /// @notice Transfer `amount` of `token` from the vault to the calling strategy.
  /// @dev Callable only by registered strategies (reverts otherwise). Token must not be the vault share token.
  function requestFunding(IERC20 token, uint256 amount) external;
}
```

Strategy MUST hold an **immutable** **`IVault`**-typed reference to the Vault contract address (stored in ERC-7201 namespaced storage for beacon-proxy safety).

**Funding pipe:**

- **`pullFromVault(IERC20 token, uint256 amount)`** — Calls **`vault.requestFunding(token, amount)`**, triggering the Vault to transfer `amount` of `token` to this strategy. Requires **`VAULT_TOKEN_LIQUIDITY_ROLE`**.
- **`pushToVault(IERC20 token, uint256 amount)`** — **`token.safeTransfer(address(vault), amount)`** (plain ERC-20 transfer of `token` to the vault address). Requires **`VAULT_TOKEN_LIQUIDITY_ROLE`**. Accepts any ERC-20, not only `vault.asset()`.
- Both emit **`PulledFromVault`** / **`PushedToVault`** events.
- Both MUST **`revert`** without role.
- Neither MUST go through the validator.

**RBAC** — **`AccessControlUpgradeable`**. Only **`DEFAULT_ADMIN_ROLE`** may **`grantRole`** / **`revokeRole`**. At deploy, assign **`DEFAULT_ADMIN_ROLE`** to protocol-controlled governance (e.g. multisig, timelock). **`VAULT_TOKEN_LIQUIDITY_ROLE`** MUST NOT gate **`exec`** unless the deployment explicitly documents that reuse.

```solidity
bytes32 public constant VAULT_TOKEN_LIQUIDITY_ROLE = keccak256("VAULT_TOKEN_LIQUIDITY_ROLE");
bytes32 public constant PRIVILEGED_EXECUTOR_ROLE   = keccak256("PRIVILEGED_EXECUTOR_ROLE");
```

**`registerStrategy` / `deregisterStrategy`** — Authorization and behavior are Vault-implementation-defined and outside **`IVault`**'s scope. Vault implementations MUST emit **`StrategyRegistered`** and **`StrategyDeregistered`** events. Registration does **not** establish a token allowance; the Vault transfers directly on `requestFunding`. See **`docs/spec/003-vault.md`** for normative Vault behavior.

**Other interactions** (non-pipe) MUST use **`exec`** (**§A.2**), consistent with **§A.3**.

### §C. SatelliteStrategy

No **`IVault`** pipe and no required link to a home-chain Vault or §B Strategy. **One** §B Strategy MAY have **multiple** SatelliteStrategy instances. **Policy-governed** external calls MUST use **`exec`** only (**§A.2**). SatelliteStrategy MUST NOT expose parallel unvalidated surfaces for the same class of calls. Token rules: **§A.3**.

## Edge Cases

- **`exec`** (validator-gated) — allowed → call; denied → **`revert`** (**`Strategy_CallNotAllowed`**). Validator internals are out of scope here.
- **`exec`** (privileged) — role check → call; no role → **`revert`**. Validator not consulted.
- If **`address(this).balance < value`** when forwarding ETH, both overloads **`revert`** (**`Strategy_InvalidEthFunding`**).
- **`to == address(this)`** is permitted in both overloads; callers should understand that self-calls execute as the strategy (e.g. `grantRole` on itself). Policy SHOULD explicitly model this surface.
- **Several Strategy instances** — independent liquidity and **`exec`**; no cross-Strategy lock in this spec.
- **`setValidator`** — replaces the active validator for future `exec` calls; existing in-flight calls are unaffected (reentrancy guard prevents overlap). Zero address is rejected.
