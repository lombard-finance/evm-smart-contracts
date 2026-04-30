import { execSync } from 'child_process';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { MerkleAllowlistValidator } from '../../typechain-types';
import rulesJson from '../../scripts/vault/ruleset/test.json';

/** Disambiguates `isAllowed` from the `bytes validatorArgs` overload (ethers v6). */
async function merkleIsAllowed(
  contract: MerkleAllowlistValidator,
  sender: string,
  to: string,
  value: bigint,
  data: string,
  input: { ruleEncoded: string; merkleProof: string[] }
): Promise<boolean> {
  const fn = contract.getFunction('isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))');
  return fn.staticCall(sender, to, value, data, input) as Promise<boolean>;
}

export interface RuleConstraint {
  offset: number;
  mask: string;
  expected: string;
}

/** Canonical `ruleEncoded` per docs/spec/001-merkle-call-data-allowlist.md §7. */
export function encodeMerkleRule(p: {
  version?: number;
  flags: number;
  sender: string;
  to: string;
  value: bigint;
  dataLength: number;
  constraints: RuleConstraint[];
}): string {
  const types: string[] = ['uint8', 'uint8', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    p.version ?? 0x01,
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

function treeWithRule(contract: MerkleAllowlistValidator, ruleHex: string) {
  return (async () => {
    const ds = await contract.domainSeparator();
    const row: [number, string, Uint8Array] = [0, ds, ethers.getBytes(ruleHex)];
    return StandardMerkleTree.of([row], ['uint8', 'bytes32', 'bytes']);
  })();
}

describe('MerkleAllowlistValidator', function () {
  let c: MerkleAllowlistValidator;

  beforeEach(async function () {
    const [owner] = await ethers.getSigners();
    const f = await ethers.getContractFactory('MerkleAllowlistValidator');
    c = (await f.deploy(owner.address)) as MerkleAllowlistValidator;
    await c.waitForDeployment();
  });

  it('domainSeparator matches packed preimage (§8)', async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const packed = ethers.solidityPacked(
      ['bytes4', 'uint8', 'uint256', 'address'],
      ['0x414c4c57', 1, chainId, await c.getAddress()]
    );
    expect(await c.domainSeparator()).to.equal(ethers.keccak256(packed));
  });

  it('returns false when allowlistRoot is zero', async function () {
    const rule = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: []
    });
    const tree = await treeWithRule(c, rule);
    const ds = await c.domainSeparator();
    const proof = tree.getProof([0, ds, ethers.getBytes(rule)] as [number, string, Uint8Array]);
    expect(await c.allowlistRoot()).to.equal(ethers.ZeroHash);
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0xabcd', {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(false);
  });

  it('accepts a valid rule and proof (pattern A: exact to + value 0, wildcard calldata)', async function () {
    const [, user] = await ethers.getSigners();
    const target = await user.getAddress();

    const rule = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: target,
      value: 0n,
      dataLength: 0,
      constraints: []
    });

    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);

    const ds = await c.domainSeparator();
    const proof = tree.getProof([0, ds, ethers.getBytes(rule)] as [number, string, Uint8Array]);

    const calldata = ethers.hexlify(ethers.randomBytes(100));
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, target, 0n, calldata, {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(true);
  });

  it('rejects wrong Merkle proof', async function () {
    const [, user] = await ethers.getSigners();
    const target = await user.getAddress();
    const rule = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: target,
      value: 0n,
      dataLength: 0,
      constraints: []
    });
    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);

    const badProof = [ethers.hexlify(ethers.randomBytes(32))];

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, target, 0n, '0x', {
        ruleEncoded: rule,
        merkleProof: badProof
      })
    ).to.equal(false);
  });

  it('rejects wrong to / value / sender vs rule', async function () {
    const [, user, other] = await ethers.getSigners();
    const target = await user.getAddress();
    const rule = encodeMerkleRule({
      flags: 0x07,
      sender: await other.getAddress(),
      to: target,
      value: 1n,
      dataLength: 0,
      constraints: []
    });
    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);
    const ds = await c.domainSeparator();
    const proof = tree.getProof([0, ds, ethers.getBytes(rule)] as [number, string, Uint8Array]);

    expect(
      await merkleIsAllowed(c, await other.getAddress(), target, 2n, '0x', {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(false);

    expect(
      await merkleIsAllowed(c, await other.getAddress(), await c.getAddress(), 1n, '0x', {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(false);
  });

  it('rejects wrong data length when flag 0x08 set', async function () {
    const rule = encodeMerkleRule({
      flags: 0x0e,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 4,
      constraints: []
    });
    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);
    const ds = await c.domainSeparator();
    const proof = tree.getProof([0, ds, ethers.getBytes(rule)] as [number, string, Uint8Array]);

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x010203', {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(false);

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x01020304', {
        ruleEncoded: rule,
        merkleProof: proof
      })
    ).to.equal(true);
  });

  it('rejects non-canonical rules before Merkle (nonzero root)', async function () {
    await c.setAllowlistRoot(ethers.hexlify(ethers.randomBytes(32)));

    const badVersion = encodeMerkleRule({
      version: 2,
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: []
    });
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: badVersion,
        merkleProof: []
      })
    ).to.equal(false);

    const reservedFlags = encodeMerkleRule({
      flags: 0x16,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: []
    });
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: reservedFlags,
        merkleProof: []
      })
    ).to.equal(false);

    const wildcardSenderBroken = encodeMerkleRule({
      flags: 0x06,
      sender: await c.getAddress(),
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: []
    });
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: wildcardSenderBroken,
        merkleProof: []
      })
    ).to.equal(false);

    const maskZero = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: [{ offset: 0, mask: ethers.ZeroHash, expected: ethers.ZeroHash }]
    });
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: maskZero,
        merkleProof: []
      })
    ).to.equal(false);

    const fullMask = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const unsorted = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: await c.getAddress(),
      value: 0n,
      dataLength: 0,
      constraints: [
        { offset: 36, mask: fullMask, expected: ethers.ZeroHash },
        { offset: 4, mask: fullMask, expected: ethers.ZeroHash }
      ]
    });
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: unsorted,
        merkleProof: []
      })
    ).to.equal(false);
  });

  it('rejects constraintCount above MAX_CONSTRAINTS', async function () {
    await c.setAllowlistRoot(ethers.hexlify(ethers.randomBytes(32)));
    const fullMask = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const types: string[] = ['uint8', 'uint8', 'address', 'address', 'uint256', 'uint32', 'uint16'];
    const values: Array<string | bigint | number> = [3, 6, ethers.ZeroAddress, await c.getAddress(), 0n, 0, 65];
    for (let i = 0; i < 65; i++) {
      types.push('uint16', 'bytes32', 'bytes32');
      values.push(i, fullMask, ethers.ZeroHash);
    }
    const tooMany = ethers.solidityPacked(types, values);
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, await c.getAddress(), 0n, '0x', {
        ruleEncoded: tooMany,
        merkleProof: []
      })
    ).to.equal(false);
  });

  // ─── ruleset/test.json ───────────────────────────────────────────────────────
  // Mirrors the examples in scripts/vault/README.md.
  // The tree is rebuilt each test against the freshly deployed contract so the
  // domain separator (chain + address) is always correct.

  describe('ruleset: test.json', function () {
    type TreeRow = [number, string, Uint8Array];

    const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
    const SENDER = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
    const RECIPIENT = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';
    const TRANSFER_SELECTOR = '0xa9059cbb';

    let tree: StandardMerkleTree<TreeRow>;
    let encoded: Record<string, string>;
    let ds: string;

    function encodeJsonRule(rule: (typeof rulesJson)[keyof typeof rulesJson]): string {
      const flags =
        (rule.flags.senderSet ? 0x01 : 0) |
        (rule.flags.toSet ? 0x02 : 0) |
        (rule.flags.valueSet ? 0x04 : 0) |
        (rule.flags.dataLengthSet ? 0x08 : 0);
      return encodeMerkleRule({
        flags,
        sender: rule.sender !== '' ? rule.sender : ethers.ZeroAddress,
        to: rule.to !== '' ? rule.to : ethers.ZeroAddress,
        value: 'value' in rule && rule.value !== '' ? BigInt(rule.value as string) : 0n,
        dataLength: rule.dataLength,
        constraints: rule.constraints
      });
    }

    function proofFor(name: string): { ruleEncoded: string; merkleProof: string[] } {
      const ruleEncoded = encoded[name];
      const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
      return { ruleEncoded, merkleProof: tree.getProof(row) };
    }

    beforeEach(async function () {
      ds = await c.domainSeparator();
      const rows: TreeRow[] = [];
      encoded = {};
      for (const [name, rule] of Object.entries(rulesJson)) {
        const ruleEncoded = encodeJsonRule(rule);
        encoded[name] = ruleEncoded;
        rows.push([0, ds, ethers.getBytes(ruleEncoded)]);
      }
      tree = StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']);
      await c.setAllowlistRoot(tree.root);
    });

    it('rule_01: allows any calldata to the fixed target', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_01');
      const calldata = ethers.hexlify(ethers.randomBytes(100));
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(
        true
      );
    });

    it('rule_01: rejects wrong target address', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_01');
      expect(
        await merkleIsAllowed(c, ethers.ZeroAddress, ethers.ZeroAddress, 0n, '0x', { ruleEncoded, merkleProof })
      ).to.equal(false);
    });

    it('rule_02: allows transfer() selector to target with value=0', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_02');
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.ZeroHash, 1n]
      );
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(
        true
      );
    });

    it('rule_02: rejects wrong selector', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_02');
      const calldata = ethers.solidityPacked(['bytes4', 'bytes32', 'uint256'], ['0xdeadbeef', ethers.ZeroHash, 1n]);
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(
        false
      );
    });

    it('rule_02: rejects nonzero ETH value', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_02');
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.ZeroHash, 1n]
      );
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 1n, calldata, { ruleEncoded, merkleProof })).to.equal(
        false
      );
    });

    it('rule_03: allows transfer() to exact recipient from exact sender', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_03');
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 1n]
      );
      expect(await merkleIsAllowed(c, SENDER, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(true);
    });

    it('rule_03: rejects wrong sender', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_03');
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 1n]
      );
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(
        false
      );
    });

    it('rule_03: rejects wrong recipient in calldata', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_03');
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.zeroPadValue(ethers.ZeroAddress, 32), 1n]
      );
      expect(await merkleIsAllowed(c, SENDER, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(false);
    });

    it('script: root from --mode build and proof from --mode proof are accepted by the contract', async function () {
      this.timeout(60000);

      const addr = await c.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const base =
        `npx ts-node scripts/vault/merkleTreeBuilder.ts` +
        ` --rules scripts/vault/ruleset/test.json --chain-id ${chainId} --contract ${addr}`;

      const buildOut = execSync(`${base} --mode build`).toString();
      const root = buildOut.match(/Merkle root:\s+(0x[0-9a-fA-F]{64})/)?.[1] as string;

      const proofOut = execSync(`${base} --mode proof --rule-name rule_02`).toString();
      const { ruleEncoded, merkleProof } = JSON.parse(proofOut) as {
        ruleEncoded: string;
        merkleProof: string[];
      };

      // Override the root set by beforeEach with the one produced by the script —
      // proves that both sources produce an identical root for the same inputs.
      await c.setAllowlistRoot(root);

      // rule_02: exact to + value=0 + transfer() selector
      const calldata = ethers.solidityPacked(
        ['bytes4', 'bytes32', 'uint256'],
        [TRANSFER_SELECTOR, ethers.ZeroHash, 1n]
      );
      expect(await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, { ruleEncoded, merkleProof })).to.equal(
        true
      );
    });
  });
});
