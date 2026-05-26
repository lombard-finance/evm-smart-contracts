# scripts/strategy

Tooling for the `MerkleCallAllowlist` contract.

---

## Ruleset file resolution

Both scripts locate the ruleset file the same way, in priority order:

1. **`--rules <path>`** — use this file directly.
2. **`--chain-id` + `--contract`** — derive the path automatically:
   ```
   ${STRATEGY_RULESET_ROOT}/<chainId-32-byte-hex>/<validatorAddress>.[json|yaml]
   ```
   `STRATEGY_RULESET_ROOT` defaults to `scripts/strategy/ruleset/` when not set.

---

## merkleTreeBuilder.ts

Builds a Merkle tree from a ruleset file and either prints the root or returns a proof for a named rule.

The tree is bound to a specific chain and deployed validator address (via `domainSeparator`). The root and proofs are not portable across chains or deployments.

### Arguments

| Argument      | Required                        | Description                                 |
| ------------- | ------------------------------- | ------------------------------------------- |
| `--chain-id`  | yes                             | Chain ID of the target network              |
| `--contract`  | yes                             | Deployed `MerkleAllowlistValidator` address |
| `--mode`      | yes                             | `build` or `proof`                          |
| `--rules`     | one of `--rules` / `--contract` | Path to the ruleset file                    |
| `--rule-name` | proof mode only                 | Name of the rule to prove                   |

### Rule file format

A JSON or YAML object mapping rule names to rule definitions. All active rules contribute to the tree.

```yaml
allow_transfer:
  destinationType: "ERC20"   # optional — documents what `to` is; validated against vocabulary
  to: "0xTokenAddress"
  value: "0"
  selector: "transfer(address,uint256)"
  constraints:
    - offset: 32
      mask: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      expected: "0x0000000000000000000000000000000000000000000000000000000000000001"

old_rule:
  disabled: true             # excluded from the Merkle tree; keep the rule for reference
  to: "0xOldAddress"
  value: "0"
```

Flags are inferred from field presence: absent or empty string → wildcard (no flag); present and non-empty → exact match (flag set). `dataLength: 0` is a valid exact-length constraint and sets the flag. Optional **`selector`** pins `data[0:4]` and sets flag **`0x10`**. Write it as `name(types)` (`transfer(address,uint256)`), no `function` prefix, or hex `bytes4` (`0xa9059cbb`). Omit / `""` for wildcard; use literal **`0x00000000`** only when pinning an all-zero selector (distinct from wildcard in tooling). Constraint **`offset`** values are relative to **`data[4:]`** (ABI arguments).

#### Optional metadata fields

These two fields are never encoded into the Merkle leaf and have no effect on proofs or on-chain verification.

| Field             | Type    | Description                                                                                      |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `disabled`        | boolean | When `true`, the rule is excluded from the tree entirely. Use to retire a rule without deleting it. Rules with `disabled: true` are listed separately in the build output. |
| `destinationType` | string  | Human-readable label for the `to` address (e.g. `AAVE_v3`, `ERC20`). Validated at build time against the vocabulary in `scripts/strategy/destinationTypes.ts`; the build fails if the value is not in the list. Omit when the target is a wildcard or the type is unknown. |

Known `destinationType` values (from `destinationTypes.ts`): `ERC20`, `AAVE_v3`, `AAVE_v4`, `Morpho`, `Uniswap_v2`, `Uniswap_v3`, `Compound_v2`, `Compound_v3`, `Curve`, `Balancer`, `BoringVault`. Add new entries to the vocabulary file when integrating a new protocol.

---

### Build mode

Encodes all rules, builds the tree, and prints the Merkle root to set on-chain via `setAllowlistRoot`.

```sh
# explicit file
npx ts-node scripts/strategy/merkleTreeBuilder.ts \
  --rules    scripts/strategy/ruleset/test.json \
  --chain-id 1 \
  --contract 0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --mode     build

# derive from validator address
npx ts-node scripts/strategy/merkleTreeBuilder.ts \
  --chain-id 1 \
  --contract 0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892 \
  --mode     build
```

```
Domain separator: 0x99d4bf261afc133e9e1c2ba4707d41660dee6b305369cc98f67de614bd3f02c2
Rules processed:  erc20_transfer, erc20_approve, erc20_transfer_to_fixed_recipient
Rules skipped:    old_rule
Merkle root:      0x34b12fa4bc360c2f9849795ba1002029a943bde5143c59ed971f861ec9b397a4
```

The `Rules skipped` line is omitted when no rules have `disabled: true`.

---

### Proof mode

Returns `ruleEncoded` and `merkleProof` for a specific rule — pass these directly as `CallVerificationInput` to `isAllowed()`.

```sh
npx ts-node scripts/strategy/merkleTreeBuilder.ts \
  --rules     scripts/strategy/ruleset/test.json \
  --chain-id  1 \
  --contract  0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --mode      proof \
  --rule-name rule_02
```

```json
{
  "ruleName": "rule_02",
  "root": "0x7970ec92937f565df24602f0ae1539f4e1f3ab3ad2938b985947d4032c6abb14",
  "ruleEncoded": "0x01060000000000000000000000000000000000000000b0f70c0bd6fd87dbeb7c10dc692a2a610681707200000000000000000000000000000000000000000000000000000000000000000000000000010000ffffffff00000000000000000000000000000000000000000000000000000000a9059cbb00000000000000000000000000000000000000000000000000000000",
  "merkleProof": [
    "0x14bc6a2774e2065bb05667bd736e5dd11af4207d1de47123d59cfa1bc59fee2d",
    "0xf55ae5ce34d19bf14f6bc1423f8ea78b2e1f4c162e3313f4b6aa959fc000561e"
  ]
}
```

---

## findRule.ts

Given a transaction's parameters, locates the matching rule from the ruleset and returns the Merkle proof plus a ready-to-broadcast `exec()` transaction. No need to know the rule name in advance.

### Arguments

| Argument     | Required | Description                                                         |
| ------------ | -------- | ------------------------------------------------------------------- |
| `--chain-id` | yes      | Chain ID of the target network (decimal or hex)                     |
| `--contract` | yes      | Deployed `MerkleAllowlistValidator` address                         |
| `--to`       | optional | Call target address (default: zero address)                         |
| `--sender`   | optional | `msg.sender` of the exec call (default: zero address)               |
| `--value`    | optional | ETH value in wei (default: `0`; use for native coin transfers)      |
| `--calldata` | optional | Calldata hex string (default: `0x`; omit for native coin transfers) |
| `--shard`    | optional | Shard contract address — sets `execTx.to` in the output             |
| `--rules`    | optional | Explicit path to the ruleset file (overrides derived path)          |

### Ruleset file path convention

```
${STRATEGY_RULESET_ROOT}/<chainId as 32-byte hex>/<validatorAddress>.[json|yaml]
```

For example, chain ID `1` and validator `0x251a604E...` resolves to:

```
scripts/strategy/ruleset/0x0000000000000000000000000000000000000000000000000000000000000001/0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892.json
```

### Example — ERC-20 transfer

```sh
npx ts-node scripts/strategy/findRule.ts \
  --chain-id 1 \
  --contract 0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892 \
  --to      0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --calldata 0xa9059cbb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000064
```

```json
{
  "ruleName": "erc20_transfer",
  "root": "0x34b12fa4bc360c2f9849795ba1002029a943bde5143c59ed971f861ec9b397a4",
  "ruleEncoded": "0x01020000000000000000000000000000000000000000b0f70c0bd6fd87dbeb7c10dc692a2a610681707200000000000000000000000000000000000000000000000000000000000000000000000000010000ffffffff00000000000000000000000000000000000000000000000000000000a9059cbb00000000000000000000000000000000000000000000000000000000",
  "merkleProof": [
    "0x82cc6271a83a9be4dbe0549e41519f93e6bfa877850d5aa87fa05fdbe2e267c6",
    "0xd92e43d83811f84dc6497e96c942734bb9fc3c53f7bab2a66704b2c51de9a42a"
  ],
  "execTx": {
    "to": null,
    "value": "0x00",
    "data": "0x730d12c1..."
  }
}
```

Pass `--shard <address>` to populate `execTx.to` with the shard contract that exposes `exec()`:

```sh
npx ts-node scripts/strategy/findRule.ts \
  --chain-id 1 \
  --contract  0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892 \
  --to        0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --calldata  0xa9059cbb... \
  --shard     0xYourShardAddress
```

`execTx` is always present. When `--shard` is omitted `execTx.to` is `null` — fill it in before broadcasting. `execTx.data` encodes `exec(to, value, calldata, validatorArgs)` where `validatorArgs` is `abi.encode(CallVerificationInput{ruleEncoded, merkleProof})`.

The `root` must be set on-chain via `setAllowlistRoot` before the `exec()` call will succeed.
