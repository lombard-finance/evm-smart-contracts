# Feature: Shards (exec, strategy liquidity pipe)

**Shard** (same chain as the strategy share token) and **RemoteShard** (often elsewhere; no `requestFunding` pipe) share **`BeaconProxy`** / **`UpgradeableBeacon`** and a validator-gated **`exec`**. This document defines **`IStrategy`** (strategy-side funding hook), shared rules (**§A**), Shard (**§B**), and RemoteShard (**§C**). Concrete strategy share token logic beyond **`IStrategy.requestFunding`** is specified in **`docs/spec/003-strategy.md`** (normative multi-asset / redemption surface).

**Governed** / **policy-governed** means the **deployed validator** decides whether an **`exec`** attempt is allowed (together with any **`AccessControl`** on **`exec`** documented for that deployment). This excludes the §B **`pull`/`push`** pipe, which bypasses the validator.

## Goal

1. **Shard** — Move any ERC-20 via **`pullFromStrategy`** / **`pushToStrategy`**, callable only by accounts holding **`SHARD_TRANSFER_ROLE`**. Pipe bypasses the validator. One strategy share token, many shard instances (**`IStrategy.requestFunding`** is the strategy-side hook).
2. **RemoteShard** — No §B pipe; **governed** external interaction via **`exec`** + validator; custody of other assets; one §B shard MAY map to many RemoteShard deployments.
3. **Shared** — OpenZeppelin **one beacon per implementation** (**Shard** vs **RemoteShard**); exactly **one** validator contract per deployed instance, implementing **one** protocol-wide validator interface (**§A.2**); **Shard** / **RemoteShard** logic stays independent of Merkle vs other concrete validators behind that interface.

## Acceptance Criteria

### §A. Shared

Subsections **§A.1**–**§A.3** below.

#### §A.1 Upgradeability

Deployments MUST use OpenZeppelin **`BeaconProxy`** and **`UpgradeableBeacon`**. Use the upgradeable initializer pattern (**no** mutable state in **`constructor`**; state in **`initializer`**); storage uses ERC-7201 namespaced slots.

**Shard** and **RemoteShard** MUST be **different** implementation contracts → **two** beacons. Strategy-linked **`BeaconProxy`** instances use the **Shard** beacon; RemoteShard uses the **RemoteShard** beacon. Only **protocol admin** may upgrade each beacon (e.g. **`Ownable`** on **`UpgradeableBeacon`**). Beacons are per **implementation line**, not per instance.

**Initializer (minimum)** — Each proxy's **`initializer`** MUST wire at least:

- **`Shard`**: immutable **`IStrategy strategy`**; **`IShardExecValidator validator`** implementing the agreed validator interface (**§A.2**); **`AccessControl`** admin (e.g. **`DEFAULT_ADMIN_ROLE`**); **`SHARD_TRANSFER_ROLE`** holder; optionally **`PRIVILEGED_EXECUTOR_ROLE`** per deployment docs.
- **`RemoteShard`**: **`IShardExecValidator validator`**; **`defaultAdmin`** (and same optional role pattern as above). No **`strategy`** reference for the pipe.

Replacing **`validator`** after init is supported via **`setValidator(IShardExecValidator)`** (see **§A.2**); it MUST be access-controlled (**`DEFAULT_ADMIN_ROLE`**).

Implementations MAY factor shared logic (**`exec`**, validator wiring, storage gaps, **`AccessControl`**) into an **`abstract`** base contract extended by both concrete implementations (**`ShardBaseUpgradeable`**); layout and inheritance are product-defined.

#### §A.2 Validator model and `exec`

There is **exactly one** **`validator`** contract address per deployed **Shard** or **RemoteShard** instance at any given time. The validator MAY be replaced by **`DEFAULT_ADMIN_ROLE`** via **`setValidator(IShardExecValidator newValidator)`**; a replacement MUST NOT use a zero address and MUST emit **`ValidatorUpdated(old, new)`**.

All validators MUST implement the protocol-wide **`IShardExecValidator`** interface at the Solidity boundary (`contracts/strategy/interfaces/IShardExecValidator.sol`):

```solidity
interface IShardExecValidator {
  function isAllowed(
    address sender,
    address to,
    uint256 value,
    bytes calldata data,
    bytes calldata validatorArgs
  ) external view returns (bool);
}
```

**Shard** and **RemoteShard** depend on that interface only, not on Merkle vs other internals. When the **Merkle allowlist validator** (see **`docs/spec/001-merkle-call-data-allowlist.md`**) is used, callers ABI-encode a **`CallVerificationInput`** struct into `validatorArgs`; the validator decodes it internally.

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
- Require **`address(this).balance >= value`** at call time; MUST **`revert`** (**`Shard_InvalidEthFunding`**) otherwise.
- Follow CEI / reentrancy discipline (**`nonReentrant`**).
- Allow **`to == address(this)`** by design: calldata may invoke this contract (e.g. role grants on itself), so policy / the validator MUST explicitly allow or deny self-targeted calls.
- Emit **`Executed(sender, to, value, data)`** on success.
- Return the raw `bytes` return value from the external call.

For the **validator-gated overload**:

- **`sender`** passed to **`isAllowed`** MUST be **`msg.sender`** of **`exec`**, not **`address(this)`**.
- MUST **`revert`** (**`Shard_CallNotAllowed`**) if **`validator.isAllowed`** returns `false`.
- **`validatorArgs`** carries proof / rule bytes for **`isAllowed`**. Encoding is per deployment; for the **Merkle allowlist** path, callers ABI-encode **`CallVerificationInput`** as `validatorArgs`.

The validator MUST NOT execute the contract's calls; it MUST only indicate allowed / denied.

**`PRIVILEGED_EXECUTOR_ROLE`** — accounts holding this role MAY use the no-`validatorArgs` overload; the validator is not consulted. This role is for trusted operators that need to bypass policy for operational reasons.

**Funding `value` on `exec`** — How **`value`** is covered (**`msg.value`** on **`exec`** vs native balance already held by the contract) is **implementation-defined** and MUST be documented per deployment.

**Native ingress** — A **`receive`** function MUST exist to accept plain ETH transfers so the shard balance can be pre-funded for `exec`. It MUST **not** perform validator-governed external calls.

#### §A.3 Token custody

For **Shard (§B)**, **`strategy.asset()`** is the typical pipe token, but **`pullFromStrategy`** and **`pushToStrategy`** accept any ERC-20 token argument. Any token may be held by the shard.

**Shard** and **RemoteShard** MAY hold other assets (ERC-20, native, ERC-721/1155, **etc.**). On **Shard**, any **state-changing** use of held assets that is **not** **`pullFromStrategy`** / **`pushToStrategy`** MUST go through **`exec`** (validator-governed). On **RemoteShard**, any **state-changing** external interaction MUST go through **`exec`**; attempts that fail validation **`revert`** (fail-closed).

**`view`** / **`pure`** helpers and **internal** accounting that do not perform external calls are **not** required to use **`exec`**. Any **external** interaction that changes token allowances, balances, or native positions in a way protocol policy cares about (**`approve`**, **`permit`**, wrap/unwrap such as WETH, swaps, **etc.**) MUST be executed **as part of** an **`exec`** path so the validator authorizes the same **`(to, value, data)`** (no "thin" public wrappers that bypass **`exec`** for those effects).

### §B. Shard and `IStrategy`

Any strategy share token used with a §B shard MUST implement **`IStrategy`** for the funding surface. The hook for liquidity is **`requestFunding`**: when called by a registered shard, the strategy transfers the requested token amount directly to the calling shard. There is **no** `approve` / `transferFrom` pattern between strategy and shard; the strategy pushes tokens on demand when a registered shard calls `requestFunding`.

```solidity
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IStrategy {
  /// @notice Implementation-defined semantic version string.
  function version() external view returns (string memory);

  /// @notice Transfer `amount` of `token` from the strategy to the calling shard.
  /// @dev Callable only by registered shards (reverts otherwise). Token must not be the strategy share token.
  function requestFunding(IERC20 token, uint256 amount) external;
}
```

_(Full `IStrategy` includes events/errors for pause, shard registry, pricing — see `contracts/strategy/interfaces/IStrategy.sol`.)_

Shard MUST hold an **immutable** **`IStrategy`**-typed reference to the strategy contract address (stored in ERC-7201 namespaced storage for beacon-proxy safety).

**Funding pipe:**

- **`pullFromStrategy(IERC20 token, uint256 amount)`** — Calls **`strategy.requestFunding(token, amount)`**, triggering the strategy to transfer `amount` of `token` to this shard. Requires **`SHARD_TRANSFER_ROLE`**.
- **`pushToStrategy(IERC20 token, uint256 amount)`** — **`token.safeTransfer(address(strategy), amount)`** (plain ERC-20 transfer of `token` to the strategy address). Requires **`SHARD_TRANSFER_ROLE`**. Accepts any ERC-20, not only `strategy.asset()`.
- Both emit **`PulledFromStrategy`** / **`PushedToStrategy`** events.
- Both MUST **`revert`** without role.
- Neither MUST go through the validator.

**RBAC** — **`AccessControlUpgradeable`**. Only **`DEFAULT_ADMIN_ROLE`** may **`grantRole`** / **`revokeRole`**. At deploy, assign **`DEFAULT_ADMIN_ROLE`** to protocol-controlled governance (e.g. multisig, timelock). **`SHARD_TRANSFER_ROLE`** MUST NOT gate **`exec`** unless the deployment explicitly documents that reuse.

```solidity
bytes32 public constant SHARD_TRANSFER_ROLE = keccak256("SHARD_TRANSFER_ROLE");
bytes32 public constant PRIVILEGED_EXECUTOR_ROLE   = keccak256("PRIVILEGED_EXECUTOR_ROLE");
```

**`registerShard` / `deregisterShard`** — Authorization and behavior are strategy-implementation-defined and outside **`IStrategy`**'s minimal interface. Implementations MUST emit **`ShardRegistered`** and **`ShardDeregistered`** events. Registration does **not** establish a token allowance; the strategy transfers directly on `requestFunding`. See **`docs/spec/003-strategy.md`** for normative behavior of the concrete strategy share token.

**Other interactions** (non-pipe) MUST use **`exec`** (**§A.2**), consistent with **§A.3**.

### §C. RemoteShard

No **`IStrategy`** pipe and no required link to a home-chain strategy or §B shard. **One** §B shard MAY have **multiple** RemoteShard instances. **Policy-governed** external calls MUST use **`exec`** only (**§A.2**). RemoteShard MUST NOT expose parallel unvalidated surfaces for the same class of calls. Token rules: **§A.3**.

## Edge Cases

- **`exec`** (validator-gated) — allowed → call; denied → **`revert`** (**`Shard_CallNotAllowed`**). Validator internals are out of scope here.
- **`exec`** (privileged) — role check → call; no role → **`revert`**. Validator not consulted.
- If **`address(this).balance < value`** when forwarding ETH, both overloads **`revert`** (**`Shard_InvalidEthFunding`**).
- **`to == address(this)`** is permitted in both overloads; callers should understand that self-calls execute as the shard (e.g. `grantRole` on itself). Policy SHOULD explicitly model this surface.
- **Several Shard instances** — independent liquidity and **`exec`**; no cross-shard lock in this spec.
- **`setValidator`** — replaces the active validator for future `exec` calls; existing in-flight calls are unaffected (reentrancy guard prevents overlap). Zero address is rejected.
