# Vault

This folder contains the vault contracts and supporting infrastructure.

---

## MultiAssetWithAsyncRedemptionVault

The main vault product. Users deposit **any supported token** (LBTC, staked LBTC, or other configured assets) and receive **vault shares** in return. Redemptions are asynchronous — users request a withdrawal and a controller processes it before they can claim their underlying assets.

**Deposit** — accepts multiple input tokens, each with its own pricing adapter and an optional fee (in basis points). The adapter converts the deposit token into the vault's base asset before shares are minted.

```solidity
// Admin registers a new deposit asset
vault.addDepositAsset(tokenAddress, converterAdapter, feeBps);

// User deposits and receives shares
uint256 shares = vault.deposit(tokenAddress, amount, receiver);
```

**Redeem** — follows [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540). Users submit a `requestRedeem`; a registered controller fulfils it and assets are transferred to the owner immediately — no separate claim step required.

```solidity
// User requests redemption
vault.requestRedeem(shares, controller, owner);
// Controller fulfils — assets transferred to owner on the spot
vault.fulfillRedeemRequests([requestId1, requestId2]);
```

**Roles**

| Role                      | Controls                               |
| ------------------------- | -------------------------------------- |
| `DEFAULT_ADMIN_ROLE`      | Add/remove deposit assets, set fees    |
| `CONTROLLER_MANAGER_ROLE` | Register and manage redeem controllers |
| `TREASURY_ROLE`           | Collect accrued deposit fees           |
| `STRATEGY_DEPLOYER_ROLE`  | Deploy capital into strategies         |

---

## MerkleAllowlistValidator

A read-only validator that answers: _"Is this call allowed under our published policy?"_ It does **not** execute calls or move ETH.

Normative detail lives in [`docs/spec/001-merkle-call-data-allowlist.md`](../../docs/spec/001-merkle-call-data-allowlist.md). This README is a short product-oriented overview plus examples.

### How it works

1. Off-chain you define **many allowed call patterns** ("rules") and build a **Merkle tree** over them.
2. On-chain the contract stores only the **Merkle root** (a single hash). A **zero root** means "deny everything" until you set a real root.
3. Each check supplies: the **call** you want to validate `(sender, to, value, data)` plus **one rule** (`ruleEncoded`) and a **Merkle proof** that this rule is in the tree.
4. The contract verifies the proof, then checks that the call **matches** that rule (optional fixed sender / target / ETH / payload length, plus optional **payload spot-checks**).

The `sender` passed to `isAllowed` is the **logical** caller your product cares about (e.g. vault/module context), **not** necessarily `msg.sender` of the `isAllowed` call.

### What you can put in a rule

| You can fix or leave open            | Notes                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sender**                           | Exact address, or any.                                                                                                                            |
| **Target contract (`to`)**           | Exact address, or any.                                                                                                                            |
| **ETH sent with the call (`value`)** | Exact amount, or any.                                                                                                                             |
| **Length of `data`**                 | Exact byte length, or any.                                                                                                                        |
| **Inside `data` (calldata)**         | Up to **64** checks: at a **byte offset**, read a 32-byte window (zero-padded if the payload ends early) and require `(word & mask) == expected`. |

**Payload checks** are how you pin things like **function selector** (usually offset **0**) and **ABI argument words** (often offsets **4**, **36**, … for static types after the 4-byte selector).

**Limits (version `0x01`):**

- At most **64** payload checks per rule.
- Each offset is **0…65535**.
- Checks must use **strictly increasing** offsets; **duplicate offsets** are invalid.
- **`mask` must be non-zero**; bits set in `expected` outside `mask` are invalid.

### Flags (which fields are fixed)

`flags` is a bitmask; only the low 4 bits are used:

| Bit | Value  | Meaning when set                                  |
| --- | ------ | ------------------------------------------------- |
| 0   | `0x01` | `sender` must equal the address in the rule       |
| 1   | `0x02` | `to` must equal the address in the rule           |
| 2   | `0x04` | `value` must equal the value in the rule          |
| 3   | `0x08` | `data.length` must equal `dataLength` in the rule |

If a bit is **clear**, that field is **wildcard** and the canonical encoding **must** store zero there (`address(0)`, `value == 0`, or `dataLength == 0`).

### Merkle leaf (for builders)

Leaves must match **OpenZeppelin `StandardMerkleTree`** with values:

`[uint8(0), domainSeparator, ruleEncoded]`

where `domainSeparator` is fixed per **chain** and **validator contract address** (query `domainSeparator()` after deploy). You **cannot** build the final tree until you know that address (unless you use a known address e.g. CREATE2).

### Examples (TypeScript / ethers)

Below, `encodeMerkleRule` matches the packed layout used in tests (version `0x01`, big-endian `dataLength` and constraint counts as in spec).

#### Helper (same idea as `test/MerkleCallAllowlist.ts`)

```typescript
import { ethers } from 'ethers';

interface RuleConstraint {
  offset: number;
  mask: string;
  expected: string;
}

function encodeMerkleRule(p: {
  flags: number;
  sender: string;
  to: string;
  value: bigint;
  dataLength: number;
  constraints: RuleConstraint[];
}): string {
  const types: string[] = ['uint8', 'uint8', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    0x01,
    p.flags,
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

```typescript
const ruleA = encodeMerkleRule({
  flags: 0x02, // exact `to` only
  sender: ethers.ZeroAddress,
  to: targetContract,
  value: 0n,
  dataLength: 0,
  constraints: []
});
```

#### Example B — Fix selector only (e.g. ERC-20 `transfer(address,uint256)` = `0xa9059cbb`)

The 32-byte word at offset `0` has the 4-byte selector in the **top** 4 bytes; the rest must be masked off.

```typescript
const SELECTOR_MASK = '0xffffffff00000000000000000000000000000000000000000000000000000000';
const transferSelectorWord = '0xa9059cbb00000000000000000000000000000000000000000000000000000000';

const ruleB = encodeMerkleRule({
  flags: 0x02,
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: [{ offset: 0, mask: SELECTOR_MASK, expected: transferSelectorWord }]
});
```

#### Example C — Fix selector + full first argument word (e.g. recipient address)

First static argument usually starts at byte **4** (after the 4-byte selector). Encode the word the same way Solidity ABI places it (32-byte slot).

```typescript
const SELECTOR_MASK = '0xffffffff00000000000000000000000000000000000000000000000000000000';
const transferSelectorWord = '0xa9059cbb00000000000000000000000000000000000000000000000000000000';

const firstArgWord = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [recipient]); // 32-byte hex string

const ALL_ONES = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const ruleC = encodeMerkleRule({
  flags: 0x02,
  sender: ethers.ZeroAddress,
  to: tokenAddress,
  value: 0n,
  dataLength: 0,
  constraints: [
    { offset: 0, mask: SELECTOR_MASK, expected: transferSelectorWord },
    { offset: 4, mask: ALL_ONES, expected: firstArgWord }
  ]
});
```

#### Building the tree and calling `isAllowed`

Use `@openzeppelin/merkle-tree`'s `StandardMerkleTree.of` with type `['uint8', 'bytes32', 'bytes']` and rows `[0, domainSeparator, ethers.getBytes(ruleEncoded)]`. Set the contract root to `tree.root`, then obtain `proof` with `tree.getProof(...)` for that row. See `test/MerkleCallAllowlist.ts` for a full flow.

---

## Files

| File                                      | Role                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `MultiAssetWithAsyncRedemptionVault.sol`  | Main vault (multi-asset deposit + async redemption)       |
| `MultiAssetDepositUpgradeable.sol`        | Multi-token deposit logic with converter adapters         |
| `ERC7540RedemptionUpgradeable.sol`        | Async redemption (ERC-7540)                               |
| `VaultBaseUpgradeable.sol`                | Shared base (access control, ERC-4626 core)               |
| `validators/MerkleAllowlistValidator.sol` | Merkle call allowlist validator                           |
| `interfaces/IMerkleCallAllowlist.sol`     | Interface + `CallVerificationInput` struct                |
| `converters/`                             | Asset converter adapters (Chainlink, direct, staked LBTC) |
| `strategies/`                             | Strategy contracts for capital deployment                 |
