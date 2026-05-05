import hardhat from 'hardhat';
const { ethers } = hardhat;
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BasculeV3, ERC20, ERC20__factory, MerkleAllowlistValidator, StakedLBTC } from '../../typechain-types';
import { Addressable, deployContract, e18, randomBigInt } from '../helpers';
import { factory } from '../../typechain-types/contracts';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

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
    const values: Array<string | bigint | number> = [1, 0x06, ethers.ZeroAddress, await c.getAddress(), 0n, 0, 65];
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

  describe('ruleset: test.json', function () {
    type TreeRow = [number, string, Uint8Array];

    const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
    const SENDER = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
    const RECIPIENT = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';
    const TRANSFER_SELECTOR = '0xa9059cbb';

    let tree: StandardMerkleTree<TreeRow>;
    let encoded: Record<string, string>;
    let ds: string;

    interface RuleJsonEntry {
      sender?: string;
      to?: string;
      value?: string | number;
      dataLength?: string | number;
      constraints?: RuleConstraint[];
    }

    function encodeJsonRule(rule: RuleJsonEntry): string {
      const flags =
        (rule.sender ? 0x01 : 0) |
        (rule.to ? 0x02 : 0) |
        (rule.value !== undefined && rule.value !== '' ? 0x04 : 0) |
        (rule.dataLength !== undefined ? 0x08 : 0);
      return encodeMerkleRule({
        flags,
        sender: rule.sender || ethers.ZeroAddress,
        to: rule.to || ethers.ZeroAddress,
        value: rule.value !== undefined && rule.value !== '' ? BigInt(rule.value) : 0n,
        dataLength: rule.dataLength !== undefined ? Number(rule.dataLength) >>> 0 : 0,
        constraints: rule.constraints ?? []
      });
    }

    function proofFor(name: string): { ruleEncoded: string; merkleProof: string[] } {
      const ruleEncoded = encoded[name];
      const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
      return { ruleEncoded, merkleProof: tree.getProof(row) };
    }

    beforeEach(async function () {
      const rulesJson = JSON.parse(readFileSync('./scripts/vault/ruleset/test.json', 'utf8'));
      ds = await c.domainSeparator();
      const rows: TreeRow[] = [];
      encoded = {};
      for (const [name, rule] of Object.entries(rulesJson as Record<string, RuleJsonEntry>)) {
        const ruleEncoded = encodeJsonRule(rule);
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

    interface RuleJsonEntry {
      sender?: string;
      to?: string;
      value?: string | number;
      dataLength?: string | number;
      constraints?: RuleConstraint[];
    }

    function encodeJsonRule(rule: RuleJsonEntry): string {
      const flags =
        (rule.sender ? 0x01 : 0) |
        (rule.to ? 0x02 : 0) |
        (rule.value !== undefined && rule.value !== '' ? 0x04 : 0) |
        (rule.dataLength !== undefined ? 0x08 : 0);
      return encodeMerkleRule({
        flags,
        sender: rule.sender || ethers.ZeroAddress,
        to: rule.to || ethers.ZeroAddress,
        value: rule.value !== undefined && rule.value !== '' ? BigInt(rule.value) : 0n,
        dataLength: rule.dataLength !== undefined ? Number(rule.dataLength) >>> 0 : 0,
        constraints: rule.constraints ?? []
      });
    }

    function proofFor(name: string): { ruleEncoded: string; merkleProof: string[] } {
      const ruleEncoded = encoded[name];
      const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
      return { ruleEncoded, merkleProof: tree.getProof(row) };
    }

    beforeEach(async function () {
      const rulesJson = JSON.parse(readFileSync('./test/vault/fixtures/test-data.json', 'utf8'));
      ds = await c.domainSeparator();
      const rows: TreeRow[] = [];
      encoded = {};
      for (const [name, rule] of Object.entries(rulesJson as Record<string, RuleJsonEntry>)) {
        const ruleEncoded = encodeJsonRule(rule);
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
        name: 'any calldata - many bytes',
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
// Uses a dedicated fixture where every rule has calldata constraints, so
// findRule can unambiguously identify each rule by calldata alone.

describe('script consistency: merkleTreeBuilder vs findRule', function () {
  const RULES_FILE = path.join(process.cwd(), 'test/vault/fixtures/cross-script-ruleset.json');
  const TO = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
  const TRANSFER_SELECTOR = '0xa9059cbb';

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
});
