# Feature: **Merkle-based Allowlist for Call Data Validation**

Specify the **Merkle-based allowlist for call-data validation**: the feature, its rules, encodings, verification procedure, and recommended interface. The sections below state the design normatively.

## Goal

The validator contract **validates** only (does not execute) a call identified by:

* `address sender`
* `address to`
* `uint256 value`
* `bytes data`

using:

* an on-chain Merkle root of allowlist rule **leaves**,
* the **canonical rule body (`ruleEncoded`) supplied in calldata on each verification** (not stored in the validator),
* a Merkle **proof** that the leaf derived from that rule is under `allowlistRoot`.

A caller MUST NOT be able to validate a call against a rule that is not committed in the tree: the contract MUST derive **`leaf` from `ruleEncoded` only** (§8) and MUST verify **`MerkleProof.verify(proof, allowlistRoot, leaf)`** before applying the matching algorithm.

The design MUST scale to very large allowlists by making on-chain cost depend only on:

* Merkle proof length, and
* number of calldata constraints in the supplied `ruleEncoded`,

and not on total number of rules.

---

## Acceptance Criteria

### 1. Contract role and scope

The contract MUST support verification of whether an actual call tuple:

`(sender, to, value, data)`

matches a rule whose **leaf** (computed from the supplied `ruleEncoded`, §8) is included in the currently active allowlist root under the supplied **Merkle proof** (§9).

The `sender` argument is the **logical sender** of the call being validated, **supplied by the integrating contract** (or its caller). It MUST NOT be interpreted as `msg.sender` of the `isAllowed` call; those addresses MAY differ (e.g. vault, router, or module forwards the tuple it intends to authorize).

The contract MUST NOT execute calls or forward value. It ONLY exposes read-only verification (e.g. `isAllowed`).

The contract MUST NOT scan all rules on-chain.

The validator MUST be a **non-upgradeable** contract (no upgradeable proxy and no pattern that swaps implementation logic in place). The domain separator uses `address(this)` and `block.chainid`; upgradeability would complicate that binding and is explicitly excluded.

---

### 2. Active root model

The contract MUST store at least one active Merkle root:

```text
bytes32 allowlistRoot
```

The contract MUST provide a mechanism to update the root. **Who may update the root is out of scope for this spec** (no required ACL). The current implementation allows **any address** to update the root; integrators MUST understand that trust model.

The contract MUST emit an event on root update:

```text
event AllowlistRootUpdated(bytes32 oldRoot, bytes32 newRoot);
```

The recommended Solidity-facing interface names this updater **`setAllowlistRoot(bytes32 newRoot)`** and declares **`AllowlistRootUpdated`** (see **Recommended Solidity-facing interface** below). Implementations SHOULD use those names; the mechanism MAY add modifiers or a different entry point only if behavior remains equivalent (single active root, event on change).

There is exactly one active root at a time. Proofs MUST be verified against `allowlistRoot` only.

**Zero root:** `allowlistRoot == bytes32(0)` is **invalid configuration** (empty / uninitialized). The contract MUST treat it as **no allowlist**: `isAllowed` MUST return `false` for all inputs until the root is set to a nonzero value.

---

### 3. Canonical rule model

Each rule MUST define constraints over:

* `sender`
* `to`
* `value`
* `data`

Each scalar field (`sender`, `to`, `value`) MUST support:

* exact match
* wildcard match (`any`)

`data` MUST support:

* wildcard full match
* exact length check, optional
* zero or more masked 32-byte windows anchored at byte offsets

The canonical logical rule is:

```text
Rule {
    uint8 version;
    uint8 flags;
    address sender;
    address to;
    uint256 value;
    uint32 dataLength;
    uint16 constraintCount;
    Constraint[constraintCount] constraints;
}
```

Where each calldata constraint is:

```text
Constraint {
    uint16 offset;
    bytes32 mask;
    bytes32 expected;
}
```

**`offset` range:** each constraint’s `offset` is a `uint16` (0..65535). This range is **normative** and sufficient for intended contract calldata lengths; this spec does not define constraints at byte offsets above 65535.

---

### 4. Flags

The `flags` field MUST use the following bit layout:

* bit `0` (`0x01`): `sender` is exact
* bit `1` (`0x02`): `to` is exact
* bit `2` (`0x04`): `value` is exact
* bit `3` (`0x08`): `dataLength` is exact
* bits `4..7`: reserved, MUST be zero

Semantics:

* if a field’s exact bit is set, the actual field MUST equal the encoded field value
* if a field’s exact bit is not set, that field is wildcard and the encoded value MUST be zero in canonical encoding

Canonical zeroing rules:

* if `sender` is wildcard, encoded `sender` MUST be `address(0)`
* if `to` is wildcard, encoded `to` MUST be `address(0)`
* if `value` is wildcard, encoded `value` MUST be `0`
* if `dataLength` is wildcard, encoded `dataLength` MUST be `0`

This prevents multiple encodings for the same logical rule. The same rule MAY be checked via `isAllowed` arbitrarily many times; there is no on-chain replay or consumption mechanism.

---

### 5. Constraint semantics

Each constraint operates on one **32-byte word** read from `data` starting at a **byte offset** into `data` (not into the EVM transaction calldata beyond the `data` argument; the `data` parameter to `isAllowed` is the full contract call data for matching purposes).

Let `offset` be the constraint’s `offset` field. Let `b` be the byte sequence of length `L = min(32, max(0, data.length - offset))` consisting of `data[offset .. offset + L)` when `offset < data.length`, else empty. The word `word` MUST be the `bytes32` formed by **left-aligning** those `L` bytes in big-endian word order (first byte of `b` is the most significant among the calldata-derived bytes) and **right-padding** with zero bytes to 32 bytes:

* if `data.length <= offset`, `word` is `bytes32(0)`
* if `data.length >= offset + 32`, `word` is exactly `data[offset .. offset + 32]` in that byte order as a `bytes32`
* otherwise, `word` is those remaining bytes left-aligned in the 32-byte word, zeros in all less-significant byte positions

Matching condition:

```text
(word & mask) == expected
```

Canonical rules:

* `mask == 0` is forbidden
* `expected & ~mask` MUST equal zero
* constraints MUST be strictly sorted by ascending `offset`
* duplicate `offset` entries are forbidden

A rule with `constraintCount == 0` means calldata is fully wildcard except for optional exact length.

#### ABI layout (calldata)

Standard contract calldata for a function call MUST be understood as:

* bytes `[0, 4)` — the 4-byte function selector
* bytes `[4, 4+32)` — the first ABI-encoded argument word (each static typed argument occupies 32 bytes; dynamic types use offsets and payloads per Solidity ABI)

Therefore, for the common case of **only static 32-byte-aligned arguments** after the selector:

* the selector aligns with the start of `data`; a constraint on the selector alone SHOULD use **`offset = 0`** and a `mask` that selects the selector bytes within the loaded 32-byte word (see §13)
* the first argument word after the selector SHOULD use **`offset = 4`**
* the second argument word SHOULD use **`offset = 36`** (`4 + 32`)

More generally, the **n**th static 32-byte word of the argument list (0-based **`n`**) after the selector usually starts at:

```text
offset = 4 + 32 * n
```

This formula applies to typical packed ABI heads; tuples, dynamic `bytes`/`string`, and nonstandard encodings MAY require different offsets. Integrators MUST compute offsets from the actual ABI encoding they intend to allow.

Implementations and off-chain builders MUST align `mask` / `expected` with the same byte ordering as Solidity’s `bytes32(bytes.concat(data[offset:offset+L], bytes(32-L)))` with `L = min(32, max(0, data.length - offset))` when `offset < data.length`, and `bytes32(0)` when `offset >= data.length`.

**Note:** Comparison to EVM `calldataload` is **informative only**: matching applies to the `data` bytes passed into `isAllowed`, not to the outer transaction calldata of the `isAllowed` invocation.

---

### 6. Data length semantics

If flag `0x08` is set, actual `data.length` MUST equal `dataLength`.

If flag `0x08` is not set, `dataLength` is ignored and MUST be zero in canonical encoding.

A constraint at byte `offset` remains valid even when exact length is not enforced; reads beyond the end of `data` use the zero-padding rule in §5.

Example:

* `data.length = 40`
* constraint at `offset = 36`
* the word consists of 4 bytes from `data[36..40]` **left-aligned** in the `bytes32`, with 28 zero bytes in the less-significant positions

---

### 7. Canonical binary encoding

A rule MUST be encoded as:

```text
byte offset in rule  size  field
0                    1     version
1                    1     flags
2                    20    sender
22                   20    to
42                   32    value
74                   4     dataLength
78                   2     constraintCount
80                   66*n  constraints
```

Each constraint is encoded as:

```text
byte offset in constraint  size  field
0                          2     offset
2                          32    mask
34                         32    expected
```

Total encoded length:

```text
80 + 66 * constraintCount
```

**Solidity alignment:** the canonical `ruleEncoded` payload MUST be byte-for-byte identical to the concatenation of:

1. `abi.encodePacked(version, flags, sender, to, value, dataLength, constraintCount)`
2. For each constraint in order: `abi.encodePacked(offset, mask, expected)` where `offset` is `uint16`

Types MUST match Solidity ABI packing: `uint8`, `uint8`, `address`, `address`, `uint256`, `uint32`, `uint16`, then per constraint `uint16`, `bytes32`, `bytes32`. The contract and off-chain builder MUST produce the same bytes as a Solidity implementation using that sequence.

`version` for this rule encoding MUST be **`0x01`**.

Any rule not matching this exact structure is invalid; `isAllowed` MUST return `false` (see §10).

---

### 8. Leaf hash

The rule leaf MUST use OpenZeppelin **standard Merkle tree** leaf hashing (double `keccak256` over `abi.encode`, then `bytes.concat`), so that off-chain builders can use `@openzeppelin/merkle-tree` **`StandardMerkleTree`** without a custom leaf template.

**Byte identity:** the `bytes` value hashed into the leaf MUST be **byte-for-byte identical** to the `ruleEncoded` payload that passes canonical validation (§7). There MUST be no second canonicalization step: after parse/validate, `leafFromRule(ruleEncoded)` MUST use exactly those octets.

Domain separator:

```text
domainSeparator = keccak256(
    abi.encodePacked(
        bytes4(0x414c4c57), // ASCII "ALLW" — fixed domain tag (allowlist); separates this preimage from unrelated hashes
        uint8(1),
        block.chainid,
        address(this)
    )
)
```

**`abi.encodePacked` preimage (normative types and widths):** off-chain code MUST reproduce Solidity’s packing byte-for-byte. Fields are concatenated in this order **before** the outer `keccak256`:

```text
field              Solidity type   width (bytes)   encoding
----------------------------------------------------------------
magic              bytes4          4               0x414c4c57 (big-endian bytes4)
domain layout tag  uint8           1               0x01
chain id           uint256         32              block.chainid as unsigned integer, big-endian (MSB first)
validator          address         20              address(this), 20-byte value (no left padding in packed encoding)
```

In Solidity, **`block.chainid` is a `uint256`**. In `abi.encodePacked`, that value is **32 bytes**, **big-endian** (same as encoding `uint256` in packed form). JavaScript, Python, and other off-chain builders MUST **not** use a 8-byte or variable-width integer for this slot—use a **32-byte big-endian** representation of the chain ID (e.g. match `ethers.AbiCoder` / `viem` packed encoding of `uint256(chainId)`, or pad `chainId.toString(16)` to 64 hex digits).

**Validator address and tree timing:** `domainSeparator` includes **`address(this)`**, so every leaf and the Merkle root depend on the **exact** validator contract address on that chain (and on `chainId`). Off-chain builders MUST use the same address the deployed contract will use when hashing. **A correct tree cannot be produced without that address**—typically meaning the tree is built **after** deployment, unless the address is known beforehand (e.g. **CREATE2** with a fixed salt/factory, or another pre-committed deployment address). If the validator is deployed or redeployed to a different address, **`domainSeparator`, leaves, root, and proofs MUST all be recomputed** and `allowlistRoot` updated.

Leaf hash (matches Solidity in OpenZeppelin [merkle-tree README](https://github.com/OpenZeppelin/merkle-tree) “Validating a Proof in Solidity” for typed leaves):

```text
leaf = keccak256(
    bytes.concat(
        keccak256(
            abi.encode(
                uint8(0),           // leaf kind / padding tag (MUST be zero for rules in this spec)
                domainSeparator,
                bytes rulePayload    // MUST equal ruleEncoded octets from §7
            )
        )
    )
)
```

Solidity-equivalent:

```solidity
bytes32 leaf = keccak256(
    bytes.concat(keccak256(abi.encode(uint8(0), domainSeparator, ruleEncoded)))
);
```

**OpenZeppelin JavaScript (normative pattern):** for a fixed `(chainId, validatorAddress)`—the **deployed** validator on that chain (see **Validator address and tree timing** above)—used when computing `domainSeparator`, build the tree with one row per allowlisted rule:

```js
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// domainSeparator: bytes32 per §8 (bytes4 0x414c4c57, uint8(1), chainId, validatorAddress)
// validatorAddress MUST equal deployed address(this); otherwise root and proofs will not verify
const values = rules.map((ruleEncoded) => [0, domainSeparator, ruleEncoded]);
const tree = StandardMerkleTree.of(values, ["uint8", "bytes32", "bytes"]);
```

The `leaf` for a row MUST equal `keccak256(bytes.concat(keccak256(abi.encode(uint8(0), domainSeparator, ruleEncoded))))` in Solidity for that row’s `ruleEncoded`. Proofs from `tree.getProof(i)` MUST verify with `MerkleProof.verifyCalldata` against `tree.root` and that `leaf`.

Requirements:

* the same logical rule MUST always produce the same leaf
* **`address(this)` in the domain separator** binds leaves to the validator deployment; tree building requires that address (see **Validator address and tree timing** above)
* **`block.chainid` MUST be included in the domain separator** so leaves and proofs are not reusable across chains (cross-chain replay of the same rule bytes MUST fail verification here)
* inner-node hashing MUST use OpenZeppelin **sorted-pair** `_hashPair` (§9); leaf hashing MUST follow this section so **`StandardMerkleTree`** remains the reference off-chain implementation

---

### 9. Merkle tree scheme (OpenZeppelin)

The implementation MUST use OpenZeppelin Contracts **`MerkleProof`** (`utils/cryptography/MerkleProof.sol`) for verification, e.g. `verifyCalldata(proof, allowlistRoot, leaf)` (or the memory `verify` equivalent).

OZ `MerkleProof` uses **sorted pairs** at each level:

```text
_hashPair(a, b) = keccak256(abi.encodePacked(min(a,b), max(a,b)))
```

(equivalently: `keccak256` over the two 32-byte words in **sorted** order.)

**Proof format:** `proof` is the list of sibling hashes from the leaf toward the root, in the order consumed by `MerkleProof.processProofCalldata` / `processProof`.

The off-chain tree builder MUST use **`StandardMerkleTree`** from `@openzeppelin/merkle-tree` (or produce the **identical** root, leaves, and proofs): same tree construction as that library (including how leaf hashes are ordered into a complete binary tree), **sorted-pair** parent hashing (`_hashPair`), and **leaf** values exactly as in §8 (`keccak256(bytes.concat(keccak256(abi.encode(uint8(0), domainSeparator, ruleEncoded))))`). Other tools MAY be used only if they match those semantics byte-for-byte.

Verification MUST return `false` when the rebuilt root does not equal `allowlistRoot`.

---

### 10. Verification procedure

The contract MUST expose a verification function that takes the **call tuple** plus a **`CallVerificationInput`** value bundling the **rule bytes** and **Merkle proof** for this invocation. The rule body is **provided in calldata each time** (inside `input.ruleEncoded`); only `allowlistRoot` is persisted on-chain.

**Normative ABI:** integrators and implementations MUST use the following shape (see **Recommended Solidity-facing interface**). This is the **canonical** `isAllowed` surface; it MUST NOT be replaced by a flat parameter list for the same logical function, because the **function selector** differs from a signature that lists `bytes` and `bytes32[]` as separate trailing parameters.

```solidity
struct CallVerificationInput {
    bytes ruleEncoded;
    bytes32[] merkleProof;
}

function isAllowed(
    address sender,
    address to,
    uint256 value,
    bytes calldata data,
    CallVerificationInput calldata input
) external view returns (bool);
```

The **`leaf` MUST NOT be taken as an unconstrained input**: implementations MUST compute `leaf = leafFromRule(input.ruleEncoded)` per §8 from **`input.ruleEncoded` only**, then verify the proof against that `leaf`. (Letting the caller supply `leaf` separately would allow a mismatch between preimage and proof unless redundant checks are enforced.)

#### Semantics of `isAllowed`

`isAllowed` returns **`true`** if and only if **all** of the following hold:

1. **Active root** — `allowlistRoot != bytes32(0)` (§2).
2. **`input.ruleEncoded` valid** — parses per §7, passes canonical validation (§4–§6), and `version == 0x01`. The `sender` argument is compared to the rule per §11; it is **not** `msg.sender` (see §1).
3. **Merkle inclusion** — with `leaf = leafFromRule(input.ruleEncoded)` (§8), `MerkleProof.verifyCalldata(input.merkleProof, allowlistRoot, leaf)` per §9.
4. **Call matches rule** — `(sender, to, value, data)` satisfies the matching algorithm (§11) against **`input.ruleEncoded`**.

Thus a rule not present in the tree under the active root cannot be validated: either the proof fails, or the recomputed `leaf` is wrong for the given **`input.ruleEncoded`**.

There is **no** on-chain execution, consumption, or replay guard: the same rule MAY be validated any number of times.

#### Evaluation order

Implementations SHOULD follow: check root → parse/canonical validate **`input.ruleEncoded`** → compute `leaf` → verify Merkle proof (**`input.merkleProof`**) → match tuple. Early exit with `false` on any failure is permitted.

**Malformed or invalid input** (wrong length, bad flags, bad constraints, failed Merkle verify, or failed match) MUST result in **`false`** (do not revert from `isAllowed` for these cases).

---

### 11. Matching algorithm

Given parsed rule `r`:

#### Sender

* if `r.flags & 0x01 != 0`, require `sender == r.sender`

#### To

* if `r.flags & 0x02 != 0`, require `to == r.to`

#### Value

* if `r.flags & 0x04 != 0`, require `value == r.value`

#### Data length

* if `r.flags & 0x08 != 0`, require `data.length == r.dataLength`

#### Constraints

For each constraint `c`:

* load `word` as the zero-padded 32-byte value from `data` at byte offset `c.offset` per §5
* require `(word & c.mask) == c.expected`

If all checks pass, the rule matches.

---

### 12. Off-chain compiler requirements

An off-chain builder MUST:

* normalize wildcard fields to canonical zero values
* sort constraints by ascending `offset`
* reject duplicate or empty-mask constraints
* encode using the canonical binary layout
* compute `domainSeparator` for the target `chainId` and the **deployed** validator `address` (§8); that address MUST be known before leaves/root/proofs are final (unless pre-known via CREATE2 or equivalent)
* compute leaves exactly as §8 / `StandardMerkleTree` (`["uint8", "bytes32", "bytes"]` rows)
* build the Merkle tree with `@openzeppelin/merkle-tree` **`StandardMerkleTree`** (§9)
* for a candidate call, select a matching rule, encode **`ruleEncoded`**, build **`merkleProof`** for its leaf, and pass **`CallVerificationInput { ruleEncoded, merkleProof }`** with the call tuple for each `isAllowed` invocation (§10)

Off-chain selection of which rule to use is out of scope for correctness, but in scope for performance.

---

### 13. Example rule patterns

#### A. Any sender, exact `to`, exact `value = 0`, any calldata

* set exact bits for `to` and `value`
* no calldata constraints
* `dataLength` wildcard

#### B. Exact sender, any `to`, any `value`, any calldata

* set exact bit for `sender`
* other scalar fields wildcard
* no calldata constraints

#### C. Exact 4-byte selector (`offset = 0`)

* one constraint with **`offset = 0`**, loading the first 32 bytes of `data` (selector in bytes `0..4`, remainder per ABI may include the start of the first argument)
* use a `mask` that selects only the selector bits within that `bytes32` (EVM / Solidity: selector occupies the **most significant** 4 bytes of the word loaded from calldata offset `0`)
* `expected` MUST satisfy `expected & ~mask == 0` and match the allowed selector under that mask

#### D. Any sender, exact `to`, `value = 0`, second ABI argument is an exact `address` (`offset = 36`)

* exact bits for `to` and `value`
* one constraint with **`offset = 36`** (second 32-byte word after the standard 4-byte selector)
* for a 32-byte ABI `address` slot, mask the **low** 20 bytes of the word (the address payload)

Example mask:

```text
0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff
```

Example expected value (illustrative `address` `0x1234567890123456789012345678901234567890` right-padded in its 32-byte ABI slot):

```text
0x0000000000000000000000001234567890123456789012345678901234567890
```

#### E. First ABI argument word (`offset = 4`)

* for a call whose first argument is a single 32-byte word immediately after the selector, constrain it with **`offset = 4`** and set `mask` / `expected` for the allowed value

---

### 14. Gas efficiency and `constraintCount` cap

The implementation MUST have on-chain verification cost proportional to:

* `O(log N)` for Merkle proof, where `N` is rule count
* `O(C)` for calldata constraint count, where `C` is number of constraints in the supplied `ruleEncoded`

The implementation MUST NOT have cost proportional to total allowlist size.

**`MAX_CONSTRAINTS` (normative for `version == 0x01`):** implementations MUST define a constant upper bound. For this rule version:

```text
MAX_CONSTRAINTS = 64
```

**Encoding length check:** for a valid rule, `ruleEncoded.length` MUST equal `80 + 66 * constraintCount`; any other length → `false`.

**Both MUST hold:** a rule is invalid if **either** `constraintCount > MAX_CONSTRAINTS` **or** the length mismatch applies. Example: `constraintCount = 65` and `ruleEncoded.length = 4370` satisfies the length formula for that count but is still **invalid** because of the cap.

**Check order (SHOULD, matches recommended pseudocode):** after `constraintCount` is known from the header (successful parse), implementations SHOULD validate **`constraintCount <= MAX_CONSTRAINTS` before** testing the length equality. That order makes the cap an explicit early guard and matches **Recommended validation pseudocode**; final acceptance still requires both checks to pass.

**Rationale:** bounds loop work in constraint matching, keeps calldata size predictable, and aligns off-chain tree builders with on-chain limits. If a future encoding raises the cap, bump the rule `version` (§7) accordingly.

---

## Edge Cases

### Malformed flags

* reserved bits set (flags & `0xF0` != 0) → canonical validation fails → `isAllowed` returns `false`
* wildcard fields with nonzero encoded values → same

### Duplicate or unsorted constraints

* duplicate `offset` or non-ascending `offset` → MUST fail canonical validation → `isAllowed` returns `false`

### Empty-mask constraints

* `mask == 0` → `isAllowed` returns `false`

### Non-masked expected bits

* if `expected & ~mask != 0` → `isAllowed` returns `false`

### Short calldata

* matching uses the zero-padded word semantics in §5
* constraints on absent bytes can still match only if expected masked bits are zero

### Exact length plus sparse constraints

* both checks MUST hold if length flag is set

### Empty calldata

* MUST be supported
* exact-length-zero rules MUST work

### Overlapping logical rules

* multiple different valid rules MAY match the same call
* any valid proven rule MUST be accepted

### Duplicate leaves in Merkle tree

* **Off-chain responsibility:** builders SHOULD deduplicate identical leaves when building the tree
* if not deduplicated, proofs may still work, but uniqueness is not guaranteed

### Root rotation race

* proof against a non-current root → Merkle verify fails → `isAllowed` returns `false`

### Zero allowlist root

* `allowlistRoot == bytes32(0)` → deny all (§2); `isAllowed` returns `false`

### Spoofed or uncommitted rule

* if `ruleEncoded` is not in the tree, Merkle verification against `allowlistRoot` MUST fail → `false`. The contract MUST bind the proof to `leafFromRule(ruleEncoded)` (§10).

---

## Recommended Solidity-facing interface

```solidity
/// @dev Rule body + Merkle proof supplied on each verification (§10).
struct CallVerificationInput {
    bytes ruleEncoded;
    bytes32[] merkleProof;
}

interface IMerkleCallAllowlist {
    event AllowlistRootUpdated(bytes32 oldRoot, bytes32 newRoot);

    function allowlistRoot() external view returns (bytes32);

    /// @notice Sets the active Merkle root. Access control is implementation-defined (§2).
    function setAllowlistRoot(bytes32 newRoot) external;

    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        CallVerificationInput calldata input
    ) external view returns (bool);
}
```

---

## Recommended validation pseudocode

`input` is **`CallVerificationInput`** (§10). `rule` is the parsed struct from **`input.ruleEncoded`**.

```text
if allowlistRoot == bytes32(0) -> return false
if !parse(input.ruleEncoded) -> return false
if !validateCanonical(rule) -> return false
if rule.constraintCount > MAX_CONSTRAINTS -> return false
if input.ruleEncoded.length != 80 + 66 * rule.constraintCount -> return false
leaf = leafFromRule(input.ruleEncoded)
if !MerkleProof.verifyCalldata(input.merkleProof, allowlistRoot, leaf) -> return false
if !match(rule, sender, to, value, data) -> return false
return true
```
