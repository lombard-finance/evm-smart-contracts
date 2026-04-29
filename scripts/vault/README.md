# scripts/vault

Tooling for the `MerkleCallAllowlist` contract.

---

## merkleTreeBuilder.ts

Builds a Merkle tree from a JSON rule set and either prints the root or returns a proof for a named rule.

The tree is bound to a specific chain and deployed validator address (via `domainSeparator`). Both must be provided as arguments; the root and proofs are not portable across chains or deployments.

### Arguments

| Argument | Required | Description |
|---|---|---|
| `--rules` | yes | Path to the rule set JSON file |
| `--chain-id` | yes | Chain ID of the target network |
| `--contract` | yes | Deployed `MerkleCallAllowlist` address |
| `--mode` | yes | `build` or `proof` |
| `--rule-name` | proof mode only | Name of the rule to prove |

### Rule file format

A JSON object mapping rule names to rule definitions. All rules contribute to the tree.

```json
{
  "allow_transfer": {
    "flags": { "senderSet": false, "toSet": true, "valueSet": true, "dataLengthSet": false },
    "sender": "",
    "to": "0xTokenAddress",
    "value": "0",
    "dataLength": 0,
    "constraints": [
      {
        "offset": 0,
        "mask":     "0xffffffff00000000000000000000000000000000000000000000000000000000",
        "expected": "0xa9059cbb00000000000000000000000000000000000000000000000000000000"
      }
    ]
  }
}
```

Empty strings for `sender`, `to`, and `value` are treated as wildcards (encoded as zero).

---

### Build mode

Encodes all rules, builds the tree, and prints the Merkle root to set on-chain via `setAllowlistRoot`.

```sh
npx ts-node scripts/vault/merkleTreeBuilder.ts \
  --rules scripts/vault/ruleset/test.json \
  --chain-id 1 \
  --contract 0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --mode build
```

```
Domain separator:  0x6b6221a7d5d7bba4f6a2a844ae65f84fe31e6ac82abea719a06d512d761db05d
Rules processed:   rule_01, rule_02, rule_03
Merkle root:       0xcc1058d694901cfe9ee72b0dc86a6f3cdb156d4dba17fac084ede7061983dbc7
```

---

### Proof mode

Returns `ruleEncoded` and `merkleProof` for a specific rule — pass these directly as `CallVerificationInput` to `isAllowed()`.

```sh
npx ts-node scripts/vault/merkleTreeBuilder.ts \
  --rules scripts/vault/ruleset/test.json \
  --chain-id 1 \
  --contract 0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072 \
  --mode proof \
  --rule-name rule_02
```

```json
{
  "ruleName": "rule_02",
  "root": "0xcc1058d694901cfe9ee72b0dc86a6f3cdb156d4dba17fac084ede7061983dbc7",
  "ruleEncoded": "0x03060000000000000000000000000000000000000000b0f70c0bd6fd87dbeb7c10dc692a2a610681707200000000000000000000000000000000000000000000000000000000000000000000000000010000ffffffff00000000000000000000000000000000000000000000000000000000a9059cbb00000000000000000000000000000000000000000000000000000000",
  "merkleProof": [
    "0x489ff84e41cef472dcd022f4a9e8cbfb6e05572b0e6355a81d38c23744f116f0",
    "0x743364eafa5897e74807dbe33a768be16e0099525027bc977c662736c8ddf1bd"
  ]
}
```
