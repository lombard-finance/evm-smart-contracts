# scripts/strategy — AGENTS.md

Guidance for building **rulesets** for `MerkleAllowlistValidator`. A ruleset is a JSON or YAML file describing the set of `(sender, to, value, data)` calls a shard's `exec()` is allowed to make. The off-chain tooling here ([merkleTreeBuilder.ts](merkleTreeBuilder.ts), [findRule.ts](findRule.ts), [merkleUtils.ts](merkleUtils.ts)) builds a Merkle tree over those rules; the root is set on-chain via `setAllowlistRoot`.

Read [README.md](README.md) for CLI usage. This file is the spec for **authoring** ruleset files.

---

## Ruleset location

Live rulesets are **not** stored under `scripts/strategy/ruleset/` in this repo. They live in a separate ruleset tree; set **`STRATEGY_RULESET_ROOT`** to that directory's absolute path when running `merkleTreeBuilder.ts` or `findRule.ts` (required unless you pass `--rules`).

Layout under `STRATEGY_RULESET_ROOT`:

```
<STRATEGY_RULESET_ROOT>/<chainId-as-32-byte-hex>/<validatorAddress>.[json|yaml]
```

- `<chainId-as-32-byte-hex>` is `'0x' + chainId.toString(16).padStart(64, '0')` — e.g. mainnet (1) → `0x00…0001`, BNB testnet chapel (84532) → `0x00…014a34`.
- `<validatorAddress>` is the deployed `MerkleAllowlistValidator` address (checksum case as deployed).
- `.yaml` or `.json` are both valid; pick `.yaml` for human-edited rules with comments and `.json` for machine-generated.
- The Merkle root is bound to `(chainId, validatorAddress)` via the domain separator. **A ruleset is not portable across chains or deployments** — building the tree against the wrong chainId/validator yields a root that won't verify any proofs.

Illustrative examples in this repo (use `--rules`, not derived paths). `test.json` / `test.yaml` set `destinationType`, so also export `STRATEGY_DESTINATION_TYPES_PATH` (e.g. to `test/strategy/fixtures/destinationTypes.yaml` when running tests locally):

- [ruleset/test.json](ruleset/test.json)
- [ruleset/test.yaml](ruleset/test.yaml)

The `destinationType` vocabulary lives in the same external ruleset repository as **`destinationTypes.yaml`**. Set **`STRATEGY_DESTINATION_TYPES_PATH`** to that file's absolute path when building rulesets that use `destinationType` (required whenever any rule in the file sets the field).

---

## Rule file shape

Top-level: an object mapping **rule name → rule definition**. Rule names are local labels (used by `--rule-name` and in `findRule.ts` output) and don't enter the leaf hash, so rename freely.

```yaml
my_rule_name:
  sender: '0x…' # optional — pin msg.sender of the exec call
  to: '0x…' # optional — pin the call target
  value: '0' # optional — pin msg.value (wei, decimal string)
  dataLength: '68' # optional — pin exact calldata byte length (decimal string)
  selector: 'transfer(address,uint256)' # optional — pin selector (sets flag 0x10); signature or 0x + 8 hex (use `0x00000000` explicitly to pin all-zero selector; omit/`""` for wildcard)
  constraints: # optional — (offset, mask, expected); offset is into data[4:] (ABI args)
    - offset: 0
      mask: '0xffffffffffff…' # e.g. first 32-byte argument word
      expected: '0x0000…'
```

All six fields are optional. A rule with no fields and no constraints matches **any** call; that's almost always not what you want.

### Field semantics — wildcard vs exact match

Each header field encodes both _whether_ to check it (a flag bit) and _what_ to check against. Flags are inferred from field presence:

| Field        | Flag set when…                                                                       | Flag _not_ set when…                                  |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `sender`     | present and non-empty string                                                         | omitted, or `""`                                      |
| `to`         | present and non-empty string                                                         | omitted, or `""`                                      |
| `value`      | present and non-empty **decimal string**                                             | omitted, or `""`                                      |
| `dataLength` | present (any in-range decimal string, including `"0"`)                               | omitted                                               |
| `selector`   | present and non-empty after trim (signature or `0x` + 8 hex, including `0x00000000`) | omitted, `""`, or whitespace-only (treated as absent) |

When the flag is **not set**, the validator wildcards that field. When it **is** set, the exact value is enforced. Quirks to remember:

- `value: "0"` pins value to zero. `value: ""` (or omitted) wildcards it. These differ on-chain.
- `dataLength: "0"` is a valid exact length (matches calls with empty calldata) and _does_ set the flag.
- `value` and `dataLength` must be **quoted decimal strings** (bare numbers are rejected — see Pitfalls).
- Empty string is the canonical "wildcard" marker for `value` / addresses / `selector` — don't write `null`, `false`, or other falsy values. For `dataLength`, omit the key to wildcard (do not use `""`).

When the flag is unset, the on-chain canonical check **also requires the underlying field to be zero** (zero address, `0`, `0`). The encoder enforces this by defaulting unset fields to zero, so just omitting the key is correct — never set `sender: "0x000…"` to mean "wildcard"; either omit it or use `""`.

### Constraints

Each constraint is a calldata predicate: `(calldata_word_at(4 + offset) & mask) == expected` — i.e. offsets are **into `data[4:]`** (ABI-encoded arguments), not into the full calldata including the selector.

- `offset` — byte offset into **`data[4:]`** where a full 32-byte word is read (`data[4 + offset .. 4 + offset + 32)`). Fewer than 32 bytes remaining → constraint fails. Type is `uint16` so max is 65535.
- `mask` — 32-byte hex. **Must be non-zero.** Use to select which bits of the word to check.
- `expected` — 32-byte hex. **Must satisfy `expected & ~mask == 0`** (no bits set outside the mask). The encoder doesn't check this; the on-chain canonical check rejects it and the rule will never match.
- Constraints **must be sorted by strictly ascending `offset`** with no duplicates. The on-chain canonical check rejects out-of-order or duplicate offsets.
- Maximum **64 constraints** per rule (`MAX_CONSTRAINTS`).

Both `mask` and `expected` are read as `bytes32` (left-aligned). Always write them as full 32-byte (`0x` + 64 hex chars) values.

### PPS-completeness pins (`--validate-pps`)

When building with `--validate-pps`, venue rules must carry enough information for vault-manager's `CalculatePPS`. For `CcipBridge` and `Morpho_blue`, required calldata fields count as pinned only when:

1. `mask` is the **full 32-byte word** (`0xff…ff` — case-insensitive), and
2. `expected` has at least one non-zero nibble.

Partial masks (1-bit, address-only lower 20 bytes, etc.) still leave the word largely unconstrained on-chain and **do not** satisfy the gate, even if `expected` is non-zero. Use a full-word mask for every PPS-required offset (`CcipBridge`: chainSelector / token / recipient; `Morpho_blue`: all five `MarketParams` fields).

---

## Encoding ABI-encoded arguments as constraints

Use the optional **`selector`** field to pin the 4-byte function selector (`FLAG_SELECTOR` / `0x10`). Constraints only cover **argument** bytes.

ABI layout for `function f(arg0, arg1, arg2, …)`:

```
[0..4)    function selector  → use ruleset field `selector`, not a constraint
[4..36)   arg0 (32 bytes)
[36..68)  arg1
[68..100) arg2
…
```

Constraint **`offset`** is relative to byte **4** of `data`:

| Pin                    | constraint `offset`      | Notes                                                   |
| ---------------------- | ------------------------ | ------------------------------------------------------- |
| **Function selector**  | _(use `selector` field)_ | `selector: 'transfer(address,uint256)'` or hex `bytes4` |
| **Address argument N** | `32 * N`                 | e.g. first arg → `0`, second arg → `32`                 |
| **uint256 argument N** | `32 * N`                 | full word mask / expected                               |

For calls with **dynamic** args (`bytes`, `string`, arrays), argument layout is not linear — derive offsets from `ethers.Interface.encodeFunctionData` and subtract **4** from byte indices into full calldata to get constraint `offset`.

Static ABI encoding uses **one 32-byte word per argument** after the selector (`uint16`, `bool`, etc. are still right-aligned inside that word).

### Dynamic arguments — soundness (required)

The validator compares **independent** 32-byte windows; it does **not** check that ABI head words (offset/length) point at the same tail bytes you constrained. Solidity decoders accept in-bounds but non-canonical dynamic offsets, so a rule that only pins bytes **inside** a dynamic payload can still pass `isAllowed` while the callee decodes that argument from **elsewhere** in calldata.

**When you constrain any byte inside a dynamic argument, you must also:**

1. **Pin the ABI head word(s)** for that argument — the dynamic **offset** (and **length** where the type has one, e.g. array length or `bytes`/`string` length prefix).
2. **Pin `dataLength`** when the allowed call has a fixed total calldata size (recommended whenever the encoding shape is known).

Offset math from `encodeFunctionData` tells you _where_ to place constraints; it does **not** replace pinning heads. See `docs/spec/001-merkle-call-data-allowlist.md` §5.1 and `MerkleAllowlistValidator` NatSpec.

**Example sketch** — `foo(bytes calldata x)` with canonical encoding; you want to allow only `x = 0xabcd`:

- Pin `dataLength` to the full encoded length.
- Pin the head at the argument’s offset word (points to the tail).
- Pin the tail length word and the constrained payload bytes (or mask only the bytes you care about).
- Do **not** rely on tail constraints alone.

Re-verify with `findRule.ts` using the **exact** calldata you intend to execute, not a hand-edited hex fragment.

### Common selectors (cross-check before using)

The ruleset file uses the **signature string**; tooling hashes it to `bytes4` (same as Solidity). Examples:

- `transfer(address,uint256)` → `0xa9059cbb`
- `approve(address,uint256)` → `0x095ea7b3`
- `transferFrom(address,address,uint256)` → `0x23b872dd`

Spaces around commas may be stripped (`transfer(address, uint256)` ≡ `transfer(address,uint256)`). Do not prefix with `function`.

### Worked recipe — "approve a fixed spender on a specific token"

```yaml
approve_spender_on_USDC:
  to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' # USDC token
  selector: 'approve(address,uint256)'
  constraints:
    - offset: 0 # arg0 = spender, fixed (first word after selector)
      mask: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      expected: '0x0000000000000000000000007C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce'
```

Note the **address-arg expected value** is left-padded to 32 bytes with 12 zero bytes (24 hex zeros). This is how the ABI encodes addresses, so the constraint must match the same layout.

### Worked recipe — "any sender, any token, but only ERC-20 transfer"

Wildcards `to` and `sender`, pin only the selector:

```yaml
erc20_transfer_anywhere:
  selector: 'transfer(address,uint256)'
```

### Worked recipe — "native ETH transfer of fixed amount"

No calldata; pin `to`, `value`, and require empty calldata:

```yaml
send_eth_to_treasury:
  to: '0x…treasury'
  value: '1000000000000000000' # 1 ETH in wei
  dataLength: '0'
```

### Worked recipe — "allow anything from a specific signer"

Bypass-style rule used for trusted EOAs/safes (see `allow_all_*` rules in live rulesets under `STRATEGY_RULESET_ROOT`):

```yaml
allow_all_from_safe:
  sender: '0x55EAB50d87f4237699AD60E0F8645e45B07e7fb0'
```

Use sparingly — this delegates the whole policy to the off-chain signer.

---

## Authoring workflow

1. **Place the file** at `$STRATEGY_RULESET_ROOT/<chainId-hex>/<validator>.{json,yaml}` in the live ruleset tree (outside this repo).
2. **Iterate locally** — export `STRATEGY_RULESET_ROOT` before running tooling, or pass `--rules <path>` for a single file (e.g. the in-repo test fixtures).
3. **Build the root** to confirm it parses:
   ```sh
   STRATEGY_RULESET_ROOT=/path/to/rulesets \
   STRATEGY_DESTINATION_TYPES_PATH=/path/to/destinationTypes.yaml \
   yarn ts-node scripts/strategy/merkleTreeBuilder.ts \
     --chain-id <chainId> --contract <validator> --mode build
   ```
   Output prints the resolved path, every rule name parsed, and the Merkle root. If a rule typo is silently wildcarding something, you'll see it here.
4. **Set the root on-chain** via `setAllowlistRoot(newRoot)` (validator owner only).
5. **Sanity-check a real call** with `findRule.ts` — it both proves the call is covered and emits an `exec()` tx ready to broadcast:
   ```sh
   STRATEGY_RULESET_ROOT=/path/to/rulesets \
   STRATEGY_DESTINATION_TYPES_PATH=/path/to/destinationTypes.yaml \
   yarn ts-node scripts/strategy/findRule.ts \
     --chain-id <chainId> --contract <validator> \
     --to <target> --sender <caller> --value <wei> --calldata <hex> --shard <shard>
   ```
   If `findRule.ts` says "no rule matches", the rule is mis-specified for the call you're trying to allow (see **Pitfalls** → `findRule` / calldata length).

### Debugging “no rule matches” in `findRule.ts`

Check in order:

1. **`sender` / `to` / `value`** — must match the simulated exec context (defaults are zero if omitted).
2. **`dataLength`** — calldata byte length must match exactly (e.g. ERC-20 `approve` is **68** bytes: 4 + 32 + 32). Truncated ABI hex (e.g. selector + first arg only) fails here even if constraints look right.
3. **Constraints** — offsets are **argument-relative** (subtract 4 from full-calldata byte indices). Check `(word & mask) === expected` for each word.
4. **`selector`** — if present, the call’s first 4 bytes must match.

To build correct hex for steps 2–4, encode the real call off-chain, e.g. `new ethers.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [spender, amount])`, and pass the full result to `--calldata`.

When changing rules: any rule edit changes the root. The validator allows only **one root at a time** — rotate via `setAllowlistRoot` and outstanding proofs against the old root stop verifying immediately.

---

## Validation rules — what the validator rejects

The on-chain `_isCanonicallyValidRule` rejects malformed encodings. The encoder here produces canonical bytes when used correctly, but be aware:

- Rule version byte must be `0x01` (handled by encoder).
- Reserved flag bits (`0xE0`, bits 5–7) must be zero (handled — encoder only sets the five defined flag bits and reserves the top three).
- Header field with flag _unset_ must have zero in its bytes — i.e. don't ever encode a non-zero `sender` while leaving the sender flag off. Achieved automatically by omitting/empty-stringing the field.
- Constraint count ≤ 64.
- Constraint offsets strictly ascending.
- Each `mask != 0`.
- Each `expected & ~mask == 0`.
- Total encoded length must equal `84 + 66 * constraintCount`.

If any of these fail, the validator returns `false` on `isAllowed` (no revert) — it just looks like a denied call. Use `merkleTreeBuilder.ts --mode build` and then attempt `findRule.ts` against a known-good call to flush these out.

---

## Encoded-rule layout reference

Useful when debugging proof bytes by hand:

```
header (84 bytes):
  [0..1)    version           (uint8, always 0x01)
  [1..2)    flags             (uint8, bits: 0x01 sender | 0x02 to | 0x04 value | 0x08 dataLength | 0x10 selector)
  [2..6)    selector          (bytes4 — zero when selector flag unset)
  [6..26)   sender            (address, 20 bytes — zero when flag unset)
  [26..46)  to                (address, 20 bytes — zero when flag unset)
  [46..78)  value             (uint256 BE, 32 bytes — zero when flag unset)
  [78..82)  dataLength        (uint32 BE, 4 bytes — zero when flag unset)
  [82..84)  constraintCount   (uint16 BE, 2 bytes)

each constraint (66 bytes, repeated `constraintCount` times):
  [base..base+2)    offsetArgSpace (uint16 BE) — byte offset into data[4:], not full calldata
  [base+2..base+34) mask           (bytes32)
  [base+34..base+66) expected      (bytes32)
```

Domain separator (binds the leaf to chain + validator):

```
keccak256(abi.encodePacked(
  bytes4("ALLW"),  // 0x414c4c57
  uint8(1),        // domain layout version
  uint256(chainId),
  address(validator)
))
```

Leaf:

```
keccak256(bytes.concat(keccak256(abi.encode(uint8(0), domainSeparator, ruleEncoded))))
```

Tree: `StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes'])` from `@openzeppelin/merkle-tree`, where each row is `[0, domainSeparator, ruleEncoded]`. Don't try to build the tree by hand — use `buildTree` from [merkleUtils.ts](merkleUtils.ts).

---

## Pitfalls

- **Dynamic args: tail-only constraints** — pinning payload bytes without the ABI offset/length head words does not bind what the callee decodes. Always add head constraints and `dataLength` when the call shape is fixed (§ **Dynamic arguments — soundness** above).
- **Weak PPS pins** — a non-zero `expected` with a partial `mask` passes on-chain matching for only the masked bits, but `--validate-pps` rejects it. Required venue fields need `mask: 0xff…ff` (see § **PPS-completeness pins**).
- **`mask` / `expected` hex length** — off-chain `encodeRule` packs them as Solidity `bytes32`. Each must be **`0x` + exactly 64 hex characters** (32 bytes). If `merkleTreeBuilder` fails with `invalid value for bytes32`, you are one or more nibbles short — pad with trailing `0` until the string is 64 hex digits (same layout as the **selector row** in the table above).
- **`findRule` / calldata length** — `txMatchesRule` requires `calldata.length === dataLength` when the rule pins length. A common mistake is pasting **partial** calldata (wrong byte count). Symptom: “no rule matches” with no other error. Fix: full ABI-encoded call, or drop `dataLength` from the rule if policy allows (usually avoid).
- **`value` / `dataLength` as numbers** — bare YAML/JSON numbers are rejected (`Number` rounds above `2^53−1`; `>>> 0` wraps negatives). Use quoted decimals: `value: "…"`, `dataLength: "68"`. Leading zeros, hex, and out-of-range values are also rejected.
- **Address case in `expected`** — checksum case in the YAML is fine for readability, but the on-chain comparison is byte-for-byte against calldata. Calldata-encoded addresses are lowercased by the EVM (no checksum), so the `expected` must match the same bits regardless of how you wrote it. Ethers `BigInt(mask)` parsing handles both cases.
- **Forgetting the 12-byte zero pad for address args** — addresses in ABI args are right-aligned in a 32-byte word: `0x` + 24 zeros + 40 hex address chars.
- **Out-of-order constraints** — sort by `offset` ascending in the source file. The encoder doesn't reorder.
- **Duplicate keys** — YAML and `loadRulesFile` (JSON) reject duplicate map keys; do not rely on last-key-wins.
- **Missing `STRATEGY_RULESET_ROOT`** — derived path resolution fails without it. Set the env var to the live ruleset root, or use `--rules` for an explicit file.
- **Missing `STRATEGY_DESTINATION_TYPES_PATH`** — build fails when any rule sets `destinationType`. Point it at `destinationTypes.yaml` in the live ruleset repository.
- **Wrong validator address** — the path must use the deployed validator's address as it appears on-chain. A typo means tooling builds against the wrong domain separator and proofs won't verify.
- **Forgetting to call `setAllowlistRoot`** — building a tree off-chain doesn't change anything on-chain. The root must be pushed by the validator owner.
- **Stale ruleset after edits** — every rule edit changes the root. Re-run `--mode build` and update the on-chain root before the new rule can be exercised.
