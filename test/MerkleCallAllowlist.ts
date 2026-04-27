import { expect } from 'chai';
import { ethers } from 'hardhat';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { MerkleAllowlistValidator } from '../typechain-types';

/** Disambiguates `isAllowed` from the `bytes validatorArgs` overload (ethers v6). */
async function merkleIsAllowed(
  contract: MerkleAllowlistValidator,
  sender: string,
  to: string,
  value: bigint,
  data: string,
  input: { ruleEncoded: string; merkleProof: string[] }
): Promise<boolean> {
  const fn = contract.getFunction(
    'isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))'
  );
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
    p.version ?? 0x03,
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
    const f = await ethers.getContractFactory('MerkleAllowlistValidator');
    c = (await f.deploy()) as MerkleAllowlistValidator;
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
});
