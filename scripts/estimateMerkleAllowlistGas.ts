/**
 * One-off / CI helper: estimate gas for MerkleAllowlistValidator.
 * Run: yarn hardhat run scripts/estimateMerkleAllowlistGas.ts
 */
import { ethers } from 'hardhat';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { packRuleSelector, packedSelectorToBytes4 } from './strategy/merkleUtils';

function encodeMerkleRule(p: {
  flags: number;
  selector?: string;
  sender: string;
  to: string;
  value: bigint;
  dataLength: number;
  constraints: { offset: number; mask: string; expected: string }[];
}): string {
  const selectorHex = packedSelectorToBytes4(packRuleSelector(p.selector));
  const types: string[] = ['uint8', 'uint8', 'bytes4', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    0x01,
    p.flags,
    selectorHex,
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

async function main() {
  const [deployer, user] = await ethers.getSigners();
  const f = await ethers.getContractFactory('MerkleAllowlistValidator');
  const c = await f.deploy(deployer.address);
  await c.waitForDeployment();
  const target = await user.getAddress();

  const fullMask = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  async function bench(
    label: string,
    rule: string,
    proof: string[],
    sender: string,
    to: string,
    value: bigint,
    data: string
  ) {
    const input = { ruleEncoded: rule, merkleProof: proof };
    const dataLen = ethers.dataLength(data);
    const gas = await c['isAllowed(address,address,uint256,bytes,(bytes,bytes32[]))'].estimateGas(
      sender,
      to,
      value,
      data,
      input
    );
    console.log(`${label}: ${gas.toString()} gas (data length ${dataLen} bytes)`);
  }

  // --- Early exits ---
  const simpleRule = encodeMerkleRule({
    flags: 0x06,
    sender: ethers.ZeroAddress,
    to: target,
    value: 0n,
    dataLength: 0,
    constraints: []
  });
  const ds = await c.domainSeparator();
  const row: [number, string, Uint8Array] = [0, ds, ethers.getBytes(simpleRule)];
  const tree1 = StandardMerkleTree.of([row], ['uint8', 'bytes32', 'bytes']);
  const proof1 = tree1.getProof(row);

  await bench(
    'isAllowed (zero root, exits before parse)',
    simpleRule,
    proof1,
    ethers.ZeroAddress,
    target,
    0n,
    '0xabcd'
  );

  await c.setAllowlistRoot(tree1.root);

  await bench(
    'isAllowed (success, 0 constraints, 1-leaf tree)',
    simpleRule,
    proof1,
    ethers.ZeroAddress,
    target,
    0n,
    ethers.hexlify(ethers.randomBytes(100))
  );

  // Multi-leaf tree => longer proof
  const rules = [
    simpleRule,
    encodeMerkleRule({
      flags: 0x02,
      sender: ethers.ZeroAddress,
      to: deployer.address,
      value: 0n,
      dataLength: 0,
      constraints: []
    })
  ];
  const values = await Promise.all(
    rules.map(async r => {
      const rr: [number, string, Uint8Array] = [0, ds, ethers.getBytes(r)];
      return rr;
    })
  );
  const tree2 = StandardMerkleTree.of(values, ['uint8', 'bytes32', 'bytes']);
  await c.setAllowlistRoot(tree2.root);
  const proof2 = tree2.getProof(values[0]);
  await bench(
    `isAllowed (success, 0 constraints, ${proof2.length}-sibling proof)`,
    simpleRule,
    proof2,
    ethers.ZeroAddress,
    target,
    0n,
    '0x'
  );

  // Worst case on-chain: MAX_CONSTRAINTS (64) + all scalar exact bits (0x0F).
  const nMax = 64;
  const constraintsMax = [];
  for (let i = 0; i < nMax; i++) {
    constraintsMax.push({
      offset: 32 * i,
      mask: fullMask,
      expected: ethers.ZeroHash
    });
  }
  const dataLenMax = 4 + 32 * nMax;
  const dataMax = ('0x' + '00'.repeat(dataLenMax)) as `0x${string}`;
  const ruleMax = encodeMerkleRule({
    flags: 0x0f,
    sender: await deployer.getAddress(),
    to: target,
    value: 0n,
    dataLength: dataLenMax,
    constraints: constraintsMax
  });
  const treeMax = StandardMerkleTree.of([[0, ds, ethers.getBytes(ruleMax)]], ['uint8', 'bytes32', 'bytes']);
  await c.setAllowlistRoot(treeMax.root);
  const proofMax = treeMax.getProof([0, ds, ethers.getBytes(ruleMax)] as [number, string, Uint8Array]);
  await bench(
    'isAllowed (WORST: 64 constraints, flags 0x0f all scalar checks)',
    ruleMax,
    proofMax,
    await deployer.getAddress(),
    target,
    0n,
    dataMax
  );

  // 64 constraints at highest uint16 offsets (65472..65535) + exact dataLength = 65536 (max span for §5 reads).
  const constraintsHigh: { offset: number; mask: string; expected: string }[] = [];
  for (let i = 0; i < nMax; i++) {
    constraintsHigh.push({
      offset: 65472 + i,
      mask: fullMask,
      expected: ethers.ZeroHash
    });
  }
  const dataLenSpan = 65536;
  const dataSpan = ('0x' + '00'.repeat(dataLenSpan)) as `0x${string}`;
  const ruleSpan = encodeMerkleRule({
    flags: 0x0f,
    sender: await deployer.getAddress(),
    to: target,
    value: 0n,
    dataLength: dataLenSpan,
    constraints: constraintsHigh
  });
  const treeSpan = StandardMerkleTree.of([[0, ds, ethers.getBytes(ruleSpan)]], ['uint8', 'bytes32', 'bytes']);
  await c.setAllowlistRoot(treeSpan.root);
  const proofSpan = treeSpan.getProof([0, ds, ethers.getBytes(ruleSpan)] as [number, string, Uint8Array]);
  await bench(
    'isAllowed (64 constraints at max uint16 offsets, data 65536 B, flags 0x0f)',
    ruleSpan,
    proofSpan,
    await deployer.getAddress(),
    target,
    0n,
    dataSpan
  );

  // Constraints: arg-relative offsets 0, 32, 64, ...
  for (const n of [1, 4, 16]) {
    const constraints = [];
    for (let i = 0; i < n; i++) {
      constraints.push({
        offset: 32 * i,
        mask: fullMask,
        expected: ethers.ZeroHash
      });
    }
    const ruleC = encodeMerkleRule({
      flags: 0x06,
      sender: ethers.ZeroAddress,
      to: target,
      value: 0n,
      dataLength: 0,
      constraints
    });
    const treeC = StandardMerkleTree.of([[0, ds, ethers.getBytes(ruleC)]], ['uint8', 'bytes32', 'bytes']);
    await c.setAllowlistRoot(treeC.root);
    const proofC = treeC.getProof([0, ds, ethers.getBytes(ruleC)] as [number, string, Uint8Array]);
    const dataLen = 4 + 32 * n;
    const data = ('0x' + '00'.repeat(dataLen)) as `0x${string}`;
    await bench(`isAllowed (success, ${n} constraints)`, ruleC, proofC, ethers.ZeroAddress, target, 0n, data);
  }

  // Real-world: ERC20 transfer to a fixed recipient, any amount.
  // Constraint 0 pins the selector via mask 0xffffffff... at offset 0;
  // constraint 1 pins the recipient (32-byte left-padded) at offset 4.
  const transferRecipient = '0x7C28818D63A4EFcDCDCEe8FB6CeAa5a135E23Cce';
  const transferSender = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
  const transferTo = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
  const ruleTransfer = encodeMerkleRule({
    flags: 0x0f,
    sender: transferSender,
    to: transferTo,
    value: 0n,
    dataLength: 68,
    selector: 'transfer(address,uint256)',
    constraints: [
      {
        offset: 0,
        mask: fullMask,
        expected: ethers.zeroPadValue(transferRecipient, 32)
      }
    ]
  });
  const treeTransfer = StandardMerkleTree.of([[0, ds, ethers.getBytes(ruleTransfer)]], ['uint8', 'bytes32', 'bytes']);
  await c.setAllowlistRoot(treeTransfer.root);
  const proofTransfer = treeTransfer.getProof([0, ds, ethers.getBytes(ruleTransfer)] as [number, string, Uint8Array]);
  const transferData = ethers.concat([
    '0xa9059cbb',
    ethers.zeroPadValue(transferRecipient, 32),
    ethers.zeroPadValue('0x0de0b6b3a7640000', 32) // arbitrary amount: 1e18
  ]);
  await bench(
    'isAllowed (transfer_token_any_amount: ERC20 transfer, fixed recipient)',
    ruleTransfer,
    proofTransfer,
    transferSender,
    transferTo,
    0n,
    transferData
  );

  const gasSet = await c.setAllowlistRoot.estimateGas(tree1.root);
  console.log(`setAllowlistRoot (same root update): ${gasSet.toString()} gas`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
