import hardhat from 'hardhat';
const { ethers } = hardhat;
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { ERC20__factory, MerkleAllowlistValidator } from '../../typechain-types';
import { e18, randomBigInt } from '../helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
  packRuleSelector,
  packedSelectorToBytes4,
  buildTree,
  encodeRule,
  loadRulesFile,
  parseRuleDataLength,
  parseRuleValue,
  RulesFile,
  validateForPPS
} from '../../scripts/strategy/merkleUtils';
import { getKnownDestinationTypes } from '../../scripts/strategy/destinationTypes';

process.env.STRATEGY_DESTINATION_TYPES_PATH ??= path.join(__dirname, 'fixtures/destinationTypes.yaml');

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
  selector?: string;
  sender: string;
  to: string;
  value: bigint;
  dataLength: number;
  constraints: RuleConstraint[];
}): string {
  const types: string[] = ['uint8', 'uint8', 'bytes4', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    p.version ?? 0x01,
    p.flags,
    packedSelectorToBytes4(packRuleSelector(p.selector)),
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
    const leafType = await contract.LEAF_TYPE();
    const row: [bigint, string, Uint8Array] = [leafType, ds, ethers.getBytes(ruleHex)];
    return StandardMerkleTree.of([row], ['uint8', 'bytes32', 'bytes']);
  })();
}

describe('MerkleAllowlistValidator', function () {
  let c: MerkleAllowlistValidator;
  let owner: HardhatEthersSigner;
  let signer: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, signer] = await ethers.getSigners();
    const f = await ethers.getContractFactory('MerkleAllowlistValidator');
    c = (await f.deploy(owner.address)) as MerkleAllowlistValidator;
    await c.waitForDeployment();
  });

  describe('packRuleSelector', function () {
    it('wildcard is empty string (not 0x00000000)', function () {
      expect(packRuleSelector(undefined)).to.equal('');
      expect(packRuleSelector('')).to.equal('');
      expect(packedSelectorToBytes4('')).to.equal('0x00000000');
    });

    it('human-readable signature matches hex bytes4', function () {
      expect(packRuleSelector('transfer(address,uint256)')).to.equal('0xa9059cbb');
      expect(packRuleSelector('0xa9059cbb')).to.equal('0xa9059cbb');
    });

    it('explicit hex 0x00000000 is distinct from wildcard', function () {
      expect(packRuleSelector('0x00000000')).to.equal('0x00000000');
      expect(packRuleSelector(undefined)).to.not.equal(packRuleSelector('0x00000000'));
    });

    it('normalizes whitespace in name(types) signature', function () {
      expect(packRuleSelector('transfer(address, uint256)')).to.equal('0xa9059cbb');
      expect(packRuleSelector('approve(address,uint256)')).to.equal('0x095ea7b3');
    });
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
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);
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
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);
    console.log('proof', JSON.stringify(proof));
    console.log(JSON.stringify(tree.getProof(0)));

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
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);

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
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);

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

  it('rejects truncated calldata when past-end constraint has zero expected', async function () {
    const to = await c.getAddress();
    const iface = ERC20__factory.createInterface();
    const fullMask = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const rule = encodeMerkleRule({
      flags: 0x16,
      selector: 'transfer(address,uint256)',
      sender: ethers.ZeroAddress,
      to,
      value: 0n,
      dataLength: 0,
      constraints: [{ offset: 64, mask: fullMask, expected: ethers.ZeroHash }]
    });
    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);
    const ds = await c.domainSeparator();
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);
    const input = { ruleEncoded: rule, merkleProof: proof };
    const selectorOnly = iface.encodeFunctionData('transfer', [signer.address, 1n]).slice(0, 10);

    expect(await merkleIsAllowed(c, signer.address, to, 0n, selectorOnly, input)).to.equal(false);
  });

  it('rejects partial-word calldata when constraint reads past the end (zero expected)', async function () {
    // The constraint reads the word at calldata offset 0 (i.e. byte 4 after the
    // selector) and requires it to be zero. Calldata is selector + 16 zero bytes,
    // so only a partial word is present at the constraint offset. _wordAt would
    // right-pad the missing 16 bytes with zero and spuriously match expected==0;
    // the full-word check must reject this even though the offset is in-bounds.
    const to = await c.getAddress();
    const fullMask = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const selector = ethers.id('transfer(address,uint256)').slice(0, 10);
    const rule = encodeMerkleRule({
      flags: 0x16,
      selector: 'transfer(address,uint256)',
      sender: ethers.ZeroAddress,
      to,
      value: 0n,
      dataLength: 0,
      constraints: [{ offset: 0, mask: fullMask, expected: ethers.ZeroHash }]
    });
    const tree = await treeWithRule(c, rule);
    await c.setAllowlistRoot(tree.root);
    const ds = await c.domainSeparator();
    const proof = tree.getProof([0n, ds, ethers.getBytes(rule)] as [bigint, string, Uint8Array]);
    const input = { ruleEncoded: rule, merkleProof: proof };
    // selector + 16 zero bytes: in-bounds at offset 4 but fewer than 32 bytes remain.
    const partial = selector + '00'.repeat(16);

    expect(await merkleIsAllowed(c, signer.address, to, 0n, partial, input)).to.equal(false);
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
      flags: 0x20,
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
        { offset: 32, mask: fullMask, expected: ethers.ZeroHash },
        { offset: 0, mask: fullMask, expected: ethers.ZeroHash }
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
    const types: string[] = ['uint8', 'uint8', 'bytes4', 'address', 'address', 'uint256', 'uint32', 'uint16'];
    const values: Array<string | bigint | number> = [
      1,
      0x06,
      '0x00000000',
      ethers.ZeroAddress,
      await c.getAddress(),
      0n,
      0,
      65
    ];
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
  // Mirrors the examples in scripts/strategy/README.md.
  // The tree is rebuilt each test against the freshly deployed contract so the
  // domain separator (chain + address) is always correct.

  interface RuleJsonEntry {
    sender?: string;
    to?: string;
    value?: string;
    dataLength?: string;
    selector?: string;
    constraints?: RuleConstraint[];
    disabled?: boolean;
    destinationType?: string;
    [key: string]: unknown;
  }

  describe('ruleset: test.json', function () {
    type TreeRow = [number, string, Uint8Array];

    const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
    const SENDER = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
    const RECIPIENT = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';
    const TRANSFER_SELECTOR = '0xa9059cbb';

    let tree: StandardMerkleTree<TreeRow>;
    let encoded: Record<string, string>;
    let ds: string;

    function proofFor(name: string): { ruleEncoded: string; merkleProof: string[] } {
      const ruleEncoded = encoded[name];
      const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
      return { ruleEncoded, merkleProof: tree.getProof(row) };
    }

    beforeEach(async function () {
      const rulesJson = JSON.parse(readFileSync('./scripts/strategy/ruleset/test.json', 'utf8'));
      ds = await c.domainSeparator();
      const rows: TreeRow[] = [];
      encoded = {};
      for (const [name, rule] of Object.entries(rulesJson as Record<string, RuleJsonEntry>)) {
        if (rule.disabled === true) continue;
        const ruleEncoded = encodeRule(rule);
        encoded[name] = ruleEncoded;
        rows.push([0, ds, ethers.getBytes(ruleEncoded)]);
      }
      tree = StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']);
      await c.setAllowlistRoot(tree.root);
    });

    it('rule_01: allows any calldata to the fixed target', async function () {
      const { ruleEncoded, merkleProof } = proofFor('rule_01');
      console.log(merkleProof);
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
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts` +
        ` --rules scripts/strategy/ruleset/test.json --chain-id ${chainId} --contract ${addr}`;

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

  describe('ruleset coverage', function () {
    type TreeRow = [number, string, Uint8Array];

    const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
    const SENDER = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
    const RECIPIENT = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';

    let tree: StandardMerkleTree<TreeRow>;
    let encoded: Record<string, string>;
    let ds: string;

    function proofFor(name: string): { ruleEncoded: string; merkleProof: string[] } {
      const ruleEncoded = encoded[name];
      const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
      return { ruleEncoded, merkleProof: tree.getProof(row) };
    }

    beforeEach(async function () {
      const rulesJson = JSON.parse(readFileSync('./test/strategy/fixtures/test-data.json', 'utf8'));
      ds = await c.domainSeparator();
      const rows: TreeRow[] = [];
      encoded = {};
      for (const [name, rule] of Object.entries(rulesJson as Record<string, RuleJsonEntry>)) {
        if (rule.disabled === true) continue;
        const ruleEncoded = encodeRule(rule);
        encoded[name] = ruleEncoded;
        rows.push([0, ds, ethers.getBytes(ruleEncoded)]);
      }
      tree = StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']);
      await c.setAllowlistRoot(tree.root);
    });

    it('setAllowlistRoot only owner can', async () => {
      const oldRoot = tree.root;
      const newRoot = ethers.hexlify(ethers.randomBytes(32));
      // prettier-ignore
      await expect(c.connect(owner).setAllowlistRoot(newRoot))
        .to.emit(c, 'AllowlistRootUpdated')
        .withArgs(oldRoot, newRoot);
    });

    it('setAllowlistRoot rejects when called by not an owner', async () => {
      const newRoot = ethers.hexlify(ethers.randomBytes(32));
      // prettier-ignore
      await expect(c.connect(signer).setAllowlistRoot(newRoot))
        .to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount')
        .withArgs(signer);
    });

    const args = [
      // by calldata
      {
        name: 'any calldata - random bytes',
        func: 'any_calldata',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ethers.hexlify(ethers.randomBytes(256)),
        allowed: true
      },
      {
        name: 'any calldata - 0 bytes',
        func: 'any_calldata',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => '0x',
        allowed: true
      },
      {
        name: 'zero calldata - valid',
        func: 'transfer_native_fixed_value',
        sender: SENDER,
        to: TO,
        value: e18,
        callData: () => '0x',
        allowed: true
      },
      {
        name: 'zero calldata - invalid',
        func: 'transfer_native_fixed_value',
        sender: SENDER,
        to: TO,
        value: e18,
        callData: () => '0x01',
        allowed: false
      },
      {
        name: 'fixed selector',
        func: 'transfer_func_any_length',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      {
        name: 'fixed selector - invalid',
        func: 'transfer_func_any_length',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transferFrom', [SENDER, RECIPIENT, e18]),
        allowed: false
      },

      // by value
      {
        name: 'transfer native any value - valid',
        func: 'transfer_native_any_value',
        sender: SENDER,
        to: TO,
        value: randomBigInt(9),
        callData: () => '0x',
        allowed: true
      },
      {
        name: 'zero value allowed - valid',
        func: 'transfer_token',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      {
        name: 'zero value allowed - invalid',
        func: 'transfer_token',
        sender: SENDER,
        to: TO,
        value: 1n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },

      // by sender
      {
        name: 'transfer any sender - random address',
        func: 'transfer_any_sender',
        sender: ethers.Wallet.createRandom().address,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      {
        name: 'transfer any sender - zero address',
        func: 'transfer_any_sender',
        sender: ethers.ZeroAddress,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },

      // any contract
      {
        name: 'transfer any contract - random address',
        func: 'transfer_any_contract',
        sender: SENDER,
        to: ethers.Wallet.createRandom().address,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      {
        name: 'transfer token and native - invalid sender',
        func: 'transfer_token_and_native',
        sender: ethers.Wallet.createRandom().address,
        to: TO,
        value: e18,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'transfer token and native - invalid recipient',
        func: 'transfer_token_and_native',
        sender: SENDER,
        to: ethers.Wallet.createRandom().address,
        value: e18,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'transfer token and native - invalid value',
        func: 'transfer_token_and_native',
        sender: SENDER,
        to: TO,
        value: e18 - 1n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'transfer token and native- length is greater',
        func: 'transfer_token_and_native',
        sender: SENDER,
        to: TO,
        value: e18,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]) + 'aa',
        allowed: false
      },
      {
        name: 'transfer token and native - length is less',
        func: 'transfer_token_and_native',
        sender: SENDER,
        to: TO,
        value: e18,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]).slice(0, -2),
        allowed: false
      },
      {
        name: 'transfer token and native - valid',
        func: 'transfer_token_and_native',
        sender: SENDER,
        to: TO,
        value: e18,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      {
        name: 'sender can do anything',
        func: 'everything_allowed_to_sender',
        sender: SENDER,
        to: ethers.Wallet.createRandom().address,
        value: randomBigInt(9),
        callData: () => ethers.hexlify(ethers.randomBytes(256)),
        allowed: true
      },
      {
        name: 'anyone can do anything',
        func: 'no_rules',
        sender: ethers.Wallet.createRandom().address,
        to: ethers.Wallet.createRandom().address,
        value: randomBigInt(9),
        callData: () => ethers.hexlify(ethers.randomBytes(256)),
        allowed: true
      },
      {
        name: 'maximum number of constraints',
        func: 'max_constraint',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: true
      },
      // invalid constraint
      {
        name: 'constraint invalid offset',
        func: 'invalid_constraints_offset',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'constraint offset out of calldata',
        func: 'constraint_offset_out_of_calldata',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'empty constraint mask',
        func: 'empty_constraint_mask',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      },
      {
        name: 'mask does not match expected',
        func: 'mask_does_not_match_expected',
        sender: SENDER,
        to: TO,
        value: 0n,
        callData: () => ERC20__factory.createInterface().encodeFunctionData('transfer', [RECIPIENT, e18]),
        allowed: false
      }
    ];

    args.forEach(arg => {
      it(`isAllowed ${arg.name}`, async () => {
        const { ruleEncoded, merkleProof } = proofFor(arg.func);
        const sender = arg.sender;
        const to = arg.to;
        const value = arg.value;
        const calldata = arg.callData();
        expect(
          await c['isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))'](sender, to, value, calldata, {
            ruleEncoded,
            merkleProof
          })
        ).to.equal(arg.allowed);
      });
    });

    const invalidEncodedRules = [
      {
        name: 'valid',
        rule: 'no_rules',
        ruleChanger: (rule: string): string => rule,
        allowed: true
      },
      {
        name: 'too short',
        rule: 'no_rules',
        ruleChanger: (rule: string): string => rule.slice(0, -2),
        allowed: false
      },
      {
        name: 'too long',
        rule: 'no_rules',
        ruleChanger: (rule: string): string => rule + 'aa',
        allowed: false
      },
      {
        name: 'TO disabled but not empty',
        rule: 'transfer_any_sender',
        ruleChanger: (rule: string): string => '0x010c' + rule.slice(6),
        allowed: false
      },
      {
        name: 'Value disabled but not 0',
        rule: 'transfer_native_fixed_value',
        ruleChanger: (rule: string): string => '0x010b' + rule.slice(6),
        allowed: false
      },
      {
        name: 'Length disabled but not 0',
        rule: 'transfer_any_sender',
        ruleChanger: (rule: string): string => '0x0106' + rule.slice(6),
        allowed: false
      }
    ];
    invalidEncodedRules.forEach(arg => {
      it(`isAllowed rule ${arg.name}`, async () => {
        let { ruleEncoded, merkleProof } = proofFor(arg.rule);
        ruleEncoded = arg.ruleChanger(ruleEncoded);
        const sender = ethers.Wallet.createRandom().address;
        const to = ethers.Wallet.createRandom().address;
        const value = randomBigInt(9);
        const calldata = ethers.hexlify(ethers.randomBytes(256));
        expect(
          await c['isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))'](sender, to, value, calldata, {
            ruleEncoded,
            merkleProof
          })
        ).to.equal(arg.allowed);
      });
    });

    it('Invalid proof', async () => {
      const { ruleEncoded } = proofFor('no_rules');
      const { merkleProof } = proofFor('everything_allowed_to_sender');
      const sender = ethers.Wallet.createRandom().address;
      const to = ethers.Wallet.createRandom().address;
      const value = randomBigInt(9);
      const calldata = ethers.hexlify(ethers.randomBytes(256));
      expect(
        await c['isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))'](sender, to, value, calldata, {
          ruleEncoded,
          merkleProof
        })
      ).to.equal(false);
    });
  });
});

// ─── Cross-script consistency ─────────────────────────────────────────────────
// Verifies that merkleTreeBuilder and findRule produce identical leaves for the
// same rule when given the same ruleset and validator address.
// Uses a dedicated fixture with mixed selector formats and constrained rules.

describe('script consistency: merkleTreeBuilder vs findRule', function () {
  const RULES_FILE = path.join(process.cwd(), 'test/strategy/fixtures/cross-script-ruleset.json');
  const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
  const TRANSFER_SELECTOR = '0xa9059cbb';
  const APPROVE_SELECTOR = '0x095ea7b3';
  const RECIPIENT = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';
  const FIXED_AMOUNT = 1000000n;

  let c: MerkleAllowlistValidator;

  beforeEach(async function () {
    const [owner] = await ethers.getSigners();
    const f = await ethers.getContractFactory('MerkleAllowlistValidator');
    c = (await f.deploy(owner.address)) as MerkleAllowlistValidator;
    await c.waitForDeployment();
  });

  it('both scripts produce the same root, ruleEncoded, and valid proofs', async function () {
    this.timeout(60000);

    const addr = await c.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const base = `--rules ${RULES_FILE} --chain-id ${chainId} --contract ${addr}`;

    // Calldata matching allow_transfer (selector only, no recipient pin)
    const calldata = ethers.solidityPacked(['bytes4', 'bytes32', 'uint256'], [TRANSFER_SELECTOR, ethers.ZeroHash, 1n]);

    const builderOut = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_transfer`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };

    const finderOut = JSON.parse(
      execSync(`npx ts-node scripts/strategy/findRule.ts ${base} --to ${TO} --calldata ${calldata}`).toString()
    ) as { ruleName: string; root: string; ruleEncoded: string; merkleProof: string[] };

    expect(finderOut.ruleName).to.equal('allow_transfer');
    expect(finderOut.root).to.equal(builderOut.root);
    expect(finderOut.ruleEncoded).to.equal(builderOut.ruleEncoded);

    await c.setAllowlistRoot(builderOut.root);

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, {
        ruleEncoded: builderOut.ruleEncoded,
        merkleProof: builderOut.merkleProof
      })
    ).to.equal(true, 'merkleTreeBuilder proof rejected');
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, calldata, {
        ruleEncoded: finderOut.ruleEncoded,
        merkleProof: finderOut.merkleProof
      })
    ).to.equal(true, 'findRule proof rejected');
  });

  it('findRule matches native coin transfer by value with empty calldata', async function () {
    this.timeout(60000);

    const addr = await c.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const base = `--rules ${RULES_FILE} --chain-id ${chainId} --contract ${addr}`;
    const value = 1000000000000000000n; // 1 ETH

    const builderOut = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_native_transfer`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };

    // No --calldata; --to and --value identify the native transfer rule
    const finderOut = JSON.parse(
      execSync(`npx ts-node scripts/strategy/findRule.ts ${base} --to ${TO} --value ${value}`).toString()
    ) as { ruleName: string; root: string; ruleEncoded: string; merkleProof: string[] };

    expect(finderOut.ruleName).to.equal('allow_native_transfer');
    expect(finderOut.root).to.equal(builderOut.root);
    expect(finderOut.ruleEncoded).to.equal(builderOut.ruleEncoded);

    await c.setAllowlistRoot(builderOut.root);

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, value, '0x', {
        ruleEncoded: finderOut.ruleEncoded,
        merkleProof: finderOut.merkleProof
      })
    ).to.equal(true, 'findRule native transfer proof rejected');
  });

  it('findRule rejects truncated calldata when a constraint window is incomplete', async function () {
    this.timeout(60000);

    const FULL_WORD_RULES = path.join(process.cwd(), 'test/strategy/fixtures/findrule-full-word.json');
    const addr = await c.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const base = `--rules ${FULL_WORD_RULES} --chain-id ${chainId} --contract ${addr}`;

    const full = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 0n]
    );
    const ok = JSON.parse(
      execSync(`npx ts-node scripts/strategy/findRule.ts ${base} --to ${TO} --calldata ${full}`).toString()
    ) as { ruleName: string };
    expect(ok.ruleName).to.equal('transfer_zero_amount');

    const truncated = TRANSFER_SELECTOR;
    expect(() =>
      execSync(`npx ts-node scripts/strategy/findRule.ts ${base} --to ${TO} --calldata ${truncated}`, {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    ).to.throw();
  });

  it('accepts proof built from hex selector-only rules', async function () {
    this.timeout(60000);

    const addr = await c.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const base = `--rules ${RULES_FILE} --chain-id ${chainId} --contract ${addr}`;

    const transferProof = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_transfer_hex_selector`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };
    const approveProof = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_approve_hex_selector`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };

    expect(approveProof.root).to.equal(transferProof.root);
    await c.setAllowlistRoot(transferProof.root);

    const transferCalldata = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 1n]
    );
    const approveCalldata = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [APPROVE_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 1n]
    );

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, transferCalldata, {
        ruleEncoded: transferProof.ruleEncoded,
        merkleProof: transferProof.merkleProof
      })
    ).to.equal(true, 'hex transfer selector proof rejected');
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, approveCalldata, {
        ruleEncoded: approveProof.ruleEncoded,
        merkleProof: approveProof.merkleProof
      })
    ).to.equal(true, 'hex approve selector proof rejected');
  });

  it('enforces constraints for hex selector rules', async function () {
    this.timeout(60000);

    const addr = await c.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const base = `--rules ${RULES_FILE} --chain-id ${chainId} --contract ${addr}`;

    const transferProof = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_transfer_hex_with_constraints`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };
    const approveProof = JSON.parse(
      execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts ${base} --mode proof --rule-name allow_approve_hex_with_constraints`
      ).toString()
    ) as { root: string; ruleEncoded: string; merkleProof: string[] };

    expect(approveProof.root).to.equal(transferProof.root);
    await c.setAllowlistRoot(transferProof.root);

    const transferGood = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), FIXED_AMOUNT]
    );
    const transferWrongAmount = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [TRANSFER_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), FIXED_AMOUNT + 1n]
    );
    const approveGood = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [APPROVE_SELECTOR, ethers.zeroPadValue(RECIPIENT, 32), 1n]
    );
    const approveWrongRecipient = ethers.solidityPacked(
      ['bytes4', 'bytes32', 'uint256'],
      [APPROVE_SELECTOR, ethers.zeroPadValue(ethers.ZeroAddress, 32), 1n]
    );

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, transferGood, {
        ruleEncoded: transferProof.ruleEncoded,
        merkleProof: transferProof.merkleProof
      })
    ).to.equal(true, 'constrained transfer proof rejected for matching calldata');
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, transferWrongAmount, {
        ruleEncoded: transferProof.ruleEncoded,
        merkleProof: transferProof.merkleProof
      })
    ).to.equal(false, 'constrained transfer proof accepted with wrong amount');

    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, approveGood, {
        ruleEncoded: approveProof.ruleEncoded,
        merkleProof: approveProof.merkleProof
      })
    ).to.equal(true, 'constrained approve proof rejected for matching calldata');
    expect(
      await merkleIsAllowed(c, ethers.ZeroAddress, TO, 0n, approveWrongRecipient, {
        ruleEncoded: approveProof.ruleEncoded,
        merkleProof: approveProof.merkleProof
      })
    ).to.equal(false, 'constrained approve proof accepted with wrong recipient');
  });
});

// ─── disabled rules and destinationType ──────────────────────────────────────

describe('buildTree: disabled rules and destinationType', function () {
  const DS = '0x' + '11'.repeat(32);
  const ADDR_A = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
  const ADDR_B = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';

  it('disabled rule is excluded from the tree and listed in skipped', function () {
    const rules: RulesFile = {
      active: { to: ADDR_A, value: '0' },
      gone: { to: ADDR_B, value: '0', disabled: true }
    };
    const { encoded, skipped } = buildTree(rules, DS);
    expect(Object.keys(encoded)).to.deep.equal(['active']);
    expect(skipped).to.deep.equal(['gone']);
  });

  it('encoded map is null-prototype', function () {
    const { encoded } = buildTree({ r: { to: ADDR_A } }, DS);
    expect(Object.getPrototypeOf(encoded)).to.equal(null);
    expect(Object.prototype.hasOwnProperty.call(encoded, 'r')).to.equal(true);
  });

  it('rejects reserved rule names', function () {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(() => buildTree({ [name]: { to: ADDR_A } }, DS)).to.throw(/reserved/i);
    }
  });

  it('disabled: false leaves the rule active', function () {
    const rules: RulesFile = {
      present: { to: ADDR_A, value: '0', disabled: false }
    };
    const { encoded, skipped } = buildTree(rules, DS);
    expect(Object.keys(encoded)).to.deep.equal(['present']);
    expect(skipped).to.be.empty;
  });

  it('absent disabled field leaves the rule active', function () {
    const rules: RulesFile = { r: { to: ADDR_A } };
    const { encoded, skipped } = buildTree(rules, DS);
    expect(Object.keys(encoded)).to.deep.equal(['r']);
    expect(skipped).to.be.empty;
  });

  it('multiple disabled rules are all excluded', function () {
    const rules: RulesFile = {
      keep: { to: ADDR_A },
      drop_a: { to: ADDR_B, disabled: true },
      drop_b: { to: ADDR_B, disabled: true }
    };
    const { encoded, skipped } = buildTree(rules, DS);
    expect(Object.keys(encoded)).to.deep.equal(['keep']);
    expect(skipped).to.deep.equal(['drop_a', 'drop_b']);
  });

  it('all rules disabled throws empty-tree error', function () {
    const rules: RulesFile = { r: { to: ADDR_A, disabled: true } };
    expect(() => buildTree(rules, DS)).to.throw(/empty/i);
  });

  it('known destinationType is accepted for every vocabulary entry', function () {
    for (const type of getKnownDestinationTypes()) {
      const rules: RulesFile = { r: { to: ADDR_A, destinationType: type } };
      expect(() => buildTree(rules, DS), `type "${type}" should be accepted`).not.to.throw();
    }
  });

  it('unknown destinationType throws with a helpful message', function () {
    const rules: RulesFile = { r: { to: ADDR_A, destinationType: 'UnknownProtocol' } };
    expect(() => buildTree(rules, DS))
      .to.throw(Error)
      .with.property('message')
      .that.matches(/unknown destinationType.*UnknownProtocol/i);
  });

  it('unknown destinationType error names the offending rule', function () {
    const rules: RulesFile = { my_rule: { to: ADDR_A, destinationType: 'BadType' } };
    expect(() => buildTree(rules, DS))
      .to.throw(Error)
      .with.property('message')
      .that.includes('"my_rule"');
  });

  it('disabled rule with unknown destinationType still throws', function () {
    const rules: RulesFile = {
      active: { to: ADDR_A },
      bad_but_disabled: { to: ADDR_B, disabled: true, destinationType: 'UnknownProtocol' }
    };
    expect(() => buildTree(rules, DS))
      .to.throw(Error)
      .with.property('message')
      .that.matches(/unknown destinationType.*UnknownProtocol/i);
  });

  it('script: build output lists skipped rules', async function () {
    this.timeout(60_000);

    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const tmpFile = join(process.cwd(), 'test/strategy/fixtures/tmp-disabled-test.json');

    const rules = {
      active_rule: { to: ADDR_A, value: '0' },
      skipped_rule: { to: ADDR_B, value: '0', disabled: true }
    };
    writeFileSync(tmpFile, JSON.stringify(rules));
    try {
      const out = execSync(
        `npx ts-node scripts/strategy/merkleTreeBuilder.ts --rules ${tmpFile} --chain-id 1 --contract ${ADDR_A} --mode build`
      ).toString();
      expect(out).to.match(/Rules processed:.*active_rule/);
      expect(out).to.match(/Rules skipped:.*skipped_rule/);
      expect(out).not.to.match(/Rules processed:.*skipped_rule/);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

// ─── Canonical value / dataLength encoding ────────────────────────────────────

describe('canonical rule numerics', function () {
  const DS = '0x' + '11'.repeat(32);
  const fixturesDir = path.join(__dirname, 'fixtures');

  it('parseRuleValue accepts decimal strings and rejects numbers', function () {
    expect(parseRuleValue('0')).to.equal(0n);
    expect(parseRuleValue('9007199254740993')).to.equal(9007199254740993n);
    expect(() => parseRuleValue(9007199254740993 as unknown as string)).to.throw(/decimal string/i);
    expect(() => parseRuleValue('01')).to.throw(/leading zeros/i);
    expect(() => parseRuleValue('-1')).to.throw(/unsigned decimal/i);
    expect(() => parseRuleValue('0x10')).to.throw(/unsigned decimal/i);
  });

  it('parseRuleDataLength rejects negatives and out-of-range (no >>> 0 wrap)', function () {
    expect(parseRuleDataLength('0')).to.equal(0);
    expect(parseRuleDataLength('68')).to.equal(68);
    expect(parseRuleDataLength('4294967295')).to.equal(4294967295);
    expect(() => parseRuleDataLength(-1 as unknown as string)).to.throw(/decimal string/i);
    expect(() => parseRuleDataLength('-1')).to.throw(/unsigned decimal/i);
    expect(() => parseRuleDataLength('4294967296')).to.throw(/exceeds max/i);
  });

  it('encodeRule pins exact value beyond MAX_SAFE_INTEGER when given a string', function () {
    const encoded = encodeRule({ value: '9007199254740993' });
    expect(BigInt(ethers.dataSlice(encoded, 46, 78))).to.equal(9007199254740993n);
  });

  it('encodeRule / buildTree reject numeric value', function () {
    const bad = { r: { value: 9007199254740993 as unknown as string } };
    expect(() => encodeRule(bad.r)).to.throw(/decimal string/i);
    expect(() => buildTree(bad as RulesFile, DS)).to.throw(/decimal string/i);
  });

  it('encodeRule / buildTree reject numeric dataLength', function () {
    const bad = { r: { dataLength: -1 as unknown as string } };
    expect(() => encodeRule(bad.r)).to.throw(/decimal string/i);
    expect(() => buildTree(bad as RulesFile, DS)).to.throw(/decimal string/i);
  });

  it('loadRulesFile rejects unquoted YAML numbers for value/dataLength', function () {
    const tmp = path.join(fixturesDir, 'tmp-noncanonical-numbers.yaml');
    writeFileSync(tmp, ['bad:', '  value: 9007199254740993', '  dataLength: -1', ''].join('\n'));
    try {
      expect(() => loadRulesFile(tmp)).to.throw(/decimal string/i);
    } finally {
      unlinkSync(tmp);
    }
  });

  it('loadRulesFile accepts quoted decimal strings in YAML', function () {
    const tmp = path.join(fixturesDir, 'tmp-canonical-numbers.yaml');
    writeFileSync(tmp, ['ok:', '  value: "9007199254740993"', '  dataLength: "68"', ''].join('\n'));
    try {
      const rules = loadRulesFile(tmp);
      expect(rules.ok.value).to.equal('9007199254740993');
      expect(rules.ok.dataLength).to.equal('68');
      const { encoded } = buildTree(rules, DS);
      expect(BigInt(ethers.dataSlice(encoded.ok, 46, 78))).to.equal(9007199254740993n);
      expect(Number(ethers.dataSlice(encoded.ok, 78, 82))).to.equal(68);
    } finally {
      unlinkSync(tmp);
    }
  });

  it('loadRulesFile rejects duplicate keys in JSON', function () {
    const tmp = path.join(fixturesDir, 'tmp-dup-keys.json');
    writeFileSync(tmp, '{"a":{"value":"1"},"a":{"value":"2"}}');
    try {
      expect(() => loadRulesFile(tmp)).to.throw(/duplicate/i);
    } finally {
      unlinkSync(tmp);
    }
  });

  it('loadRulesFile rejects reserved rule names', function () {
    const tmp = path.join(fixturesDir, 'tmp-reserved-name.json');
    writeFileSync(tmp, '{"__proto__":{"value":"0"}}');
    try {
      expect(() => loadRulesFile(tmp)).to.throw(/reserved/i);
    } finally {
      unlinkSync(tmp);
    }
  });

  it('loadRulesFile rejects duplicate nested keys in JSON', function () {
    const tmp = path.join(fixturesDir, 'tmp-dup-nested.json');
    writeFileSync(tmp, '{"r":{"value":"1","value":"2"}}');
    try {
      expect(() => loadRulesFile(tmp)).to.throw(/duplicate/i);
    } finally {
      unlinkSync(tmp);
    }
  });

  it('loadRulesFile rejects duplicate keys in YAML', function () {
    const tmp = path.join(fixturesDir, 'tmp-dup-keys.yaml');
    writeFileSync(tmp, ['a:', '  value: "1"', 'a:', '  value: "2"', ''].join('\n'));
    try {
      expect(() => loadRulesFile(tmp)).to.throw(/unique/i);
    } finally {
      unlinkSync(tmp);
    }
  });
});

// ─── validateForPPS ───────────────────────────────────────────────────────────

describe('validateForPPS', function () {
  const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
  const FULL_MASK = '0x' + 'ff'.repeat(32);
  const NONZERO = '0x' + '00'.repeat(31) + '01';
  const ZERO = '0x' + '00'.repeat(32);

  // Constraint with a full-word mask and non-zero expected — counts as a PPS pin.
  function pin(offset: number): RuleConstraint {
    return { offset, mask: FULL_MASK, expected: NONZERO };
  }

  // Full set of valid CcipBridge pins (chainSelector + token + EVM recipient).
  function ccipPins(
    opts: { evmRecipient?: boolean; svmRecipient?: boolean } = { evmRecipient: true }
  ): RuleConstraint[] {
    const cs: RuleConstraint[] = [pin(0), pin(352)]; // chainSelector, token
    if (opts.evmRecipient) cs.push(pin(256));
    if (opts.svmRecipient) cs.push(pin(580));
    return cs;
  }

  // Full set of valid Morpho_blue MarketParams pins.
  function morphoBluePins(): RuleConstraint[] {
    return [pin(0), pin(32), pin(64), pin(96), pin(128)];
  }

  // ── non-venue rules are ignored ─────────────────────────────────────────────

  it('returns no issues for an empty ruleset', function () {
    expect(validateForPPS({})).to.be.empty;
  });

  it('ignores rules with no destinationType', function () {
    const rules: RulesFile = { r: { value: '0' } };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('ignores rules with non-venue destinationType (ERC20)', function () {
    const rules: RulesFile = { r: { destinationType: 'ERC20', value: '0' } };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('ignores disabled venue rules', function () {
    const rules: RulesFile = {
      r: { destinationType: 'AAVE_v3', disabled: true }
    };
    expect(validateForPPS(rules)).to.be.empty;
  });

  // ── wildcard `to` check (all venue types) ───────────────────────────────────

  for (const dt of ['AAVE_v3', 'AAVE_v4', 'Morpho', 'Morpho_blue', 'CcipBridge'] as const) {
    it(`reports an issue when ${dt} rule has wildcard 'to'`, function () {
      const rules: RulesFile = { r: { destinationType: dt } };
      const issues = validateForPPS(rules);
      expect(issues).to.have.length.greaterThan(0);
      expect(issues[0]).to.match(/wildcard 'to'/);
      expect(issues[0]).to.include(dt);
    });

    it(`no issue when ${dt} rule has a concrete 'to'`, function () {
      const base: RulesFile = { r: { destinationType: dt, to: TO } };
      // For CcipBridge/Morpho_blue we also need the required pins to avoid other errors
      if (dt === 'CcipBridge') base.r.constraints = ccipPins();
      if (dt === 'Morpho_blue') base.r.constraints = morphoBluePins();
      const issues = validateForPPS(base);
      expect(issues).to.be.empty;
    });
  }

  // ── CcipBridge-specific pin checks ──────────────────────────────────────────

  it('CcipBridge: reports missing chainSelector', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: [pin(352), pin(256)] }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('chainSelector');
  });

  it('CcipBridge: reports missing token', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: [pin(0), pin(256)] }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('token');
  });

  it('CcipBridge: reports missing recipient when both EVM and SVM are absent', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: [pin(0), pin(352)] }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('recipient');
  });

  it('CcipBridge: EVM recipient alone satisfies recipient requirement', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: ccipPins({ evmRecipient: true }) }
    };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('CcipBridge: SVM recipient alone satisfies recipient requirement', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: ccipPins({ svmRecipient: true }) }
    };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('CcipBridge: constraint with all-zero expected does not count as a pin', function () {
    const rules: RulesFile = {
      r: {
        destinationType: 'CcipBridge',
        to: TO,
        constraints: [
          { offset: 0, mask: FULL_MASK, expected: ZERO }, // zero — not a pin
          pin(352),
          pin(256)
        ]
      }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('chainSelector');
  });

  it('CcipBridge: 1-bit mask with non-zero expected does not count as a pin', function () {
    const weakMask = '0x' + '00'.repeat(31) + '01';
    const rules: RulesFile = {
      r: {
        destinationType: 'CcipBridge',
        to: TO,
        constraints: [{ offset: 0, mask: weakMask, expected: weakMask }, pin(352), pin(256)]
      }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('chainSelector');
  });

  it('CcipBridge: address-only mask (lower 20 bytes) does not count as a pin', function () {
    const addressMask = '0x' + '00'.repeat(12) + 'ff'.repeat(20);
    const rules: RulesFile = {
      r: {
        destinationType: 'CcipBridge',
        to: TO,
        constraints: [pin(0), { offset: 352, mask: addressMask, expected: NONZERO }, pin(256)]
      }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('token');
  });

  it('CcipBridge: uppercase full-word mask still counts as a pin', function () {
    const rules: RulesFile = {
      r: {
        destinationType: 'CcipBridge',
        to: TO,
        constraints: [
          { offset: 0, mask: FULL_MASK.toUpperCase().replace(/^0X/, '0x'), expected: NONZERO },
          pin(352),
          pin(256)
        ]
      }
    };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('CcipBridge: reports all missing fields in a single issue entry', function () {
    const rules: RulesFile = {
      r: { destinationType: 'CcipBridge', to: TO, constraints: [] }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('chainSelector');
    expect(issues[0]).to.include('token');
    expect(issues[0]).to.include('recipient');
  });

  // ── Morpho_blue-specific pin checks ─────────────────────────────────────────

  it('Morpho_blue: reports all missing MarketParams in a single issue entry', function () {
    const rules: RulesFile = {
      r: { destinationType: 'Morpho_blue', to: TO, constraints: [] }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('loanToken');
    expect(issues[0]).to.include('collateralToken');
    expect(issues[0]).to.include('oracle');
    expect(issues[0]).to.include('irm');
    expect(issues[0]).to.include('lltv');
  });

  it('Morpho_blue: reports only the missing fields', function () {
    const rules: RulesFile = {
      r: { destinationType: 'Morpho_blue', to: TO, constraints: [pin(0), pin(64)] } // missing collateralToken, irm, lltv
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('collateralToken');
    expect(issues[0]).to.include('irm');
    expect(issues[0]).to.include('lltv');
    expect(issues[0]).not.to.include('loanToken');
    expect(issues[0]).not.to.include('oracle');
  });

  it('Morpho_blue: all five MarketParams pinned → no issues', function () {
    const rules: RulesFile = {
      r: { destinationType: 'Morpho_blue', to: TO, constraints: morphoBluePins() }
    };
    expect(validateForPPS(rules)).to.be.empty;
  });

  it('Morpho_blue: zero-expected constraint does not count as a pin', function () {
    const zeroPins = morphoBluePins();
    zeroPins[2] = { offset: 64, mask: FULL_MASK, expected: ZERO }; // oracle zeroed
    const rules: RulesFile = { r: { destinationType: 'Morpho_blue', to: TO, constraints: zeroPins } };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('oracle');
  });

  it('Morpho_blue: partial mask with non-zero expected does not count as a pin', function () {
    const weakMask = '0x' + '00'.repeat(31) + '01';
    const weakPins = morphoBluePins();
    weakPins[0] = { offset: 0, mask: weakMask, expected: weakMask }; // loanToken weakly masked
    const rules: RulesFile = { r: { destinationType: 'Morpho_blue', to: TO, constraints: weakPins } };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(1);
    expect(issues[0]).to.include('loanToken');
    expect(issues[0]).not.to.include('collateralToken');
  });

  // ── multiple rules / mixed issues ────────────────────────────────────────────

  it('accumulates issues across multiple rules', function () {
    const rules: RulesFile = {
      aave_bad: { destinationType: 'AAVE_v3' },
      morpho_bad: { destinationType: 'Morpho' },
      ok: { destinationType: 'ERC20', to: TO }
    };
    const issues = validateForPPS(rules);
    expect(issues).to.have.length(2);
    expect(issues.some(i => i.includes('aave_bad'))).to.be.true;
    expect(issues.some(i => i.includes('morpho_bad'))).to.be.true;
  });

  // ── script integration: --validate-pps flag ──────────────────────────────────

  it('script exits 0 when --validate-pps passes', async function () {
    this.timeout(60_000);
    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const tmpFile = join(process.cwd(), 'test/strategy/fixtures/tmp-pps-ok.json');
    // All venue rules have concrete `to` and the extra required pins
    const rules = {
      aave_ok: { destinationType: 'AAVE_v3', to: TO, value: '0' },
      erc20_ok: { destinationType: 'ERC20', to: TO }
    };
    writeFileSync(tmpFile, JSON.stringify(rules));
    try {
      // Should not throw (exit code 0)
      expect(() =>
        execSync(
          `npx ts-node scripts/strategy/merkleTreeBuilder.ts --rules ${tmpFile} --chain-id 1 --contract ${TO} --mode build --validate-pps 1`
        )
      ).not.to.throw();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('script exits non-zero when --validate-pps detects a wildcard-to violation', async function () {
    this.timeout(60_000);
    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const tmpFile = join(process.cwd(), 'test/strategy/fixtures/tmp-pps-fail.json');
    // AAVE_v3 rule with no `to` — violates PPS completeness
    const rules = {
      aave_bad: { destinationType: 'AAVE_v3', value: '0' },
      filler: { to: TO } // needed so tree has at least one leaf
    };
    writeFileSync(tmpFile, JSON.stringify(rules));
    try {
      let threw = false;
      try {
        execSync(
          `npx ts-node scripts/strategy/merkleTreeBuilder.ts --rules ${tmpFile} --chain-id 1 --contract ${TO} --mode build --validate-pps 1`
        );
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
