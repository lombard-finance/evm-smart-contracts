import { expect } from 'chai';
import { ethers } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type {
  Shard,
  RemoteShard,
  MerkleAllowlistValidator,
  MockStrategyForShard,
  TokenMock
} from '../../typechain-types';
import { encodeMerkleRule } from './MerkleCallAllowlist';
import { calculateStorageSlot, encode, deployContract } from '../helpers';

/** ABI-encode a CallVerificationInput for the IShardExecValidator.isAllowed(bytes) overload.
 *  Must match abi.decode(validatorArgs, (CallVerificationInput)) in MerkleAllowlistValidator. */
function encodeValidatorArgs(ruleEncoded: string, merkleProof: string[]): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(bytes ruleEncoded, bytes32[] merkleProof)'],
    [{ ruleEncoded, merkleProof }]
  );
}

/** Build a single-rule Merkle tree tied to `validator`'s domain separator. */
async function buildTree(validator: MerkleAllowlistValidator, ruleEncoded: string) {
  const ds = await validator.domainSeparator();
  const row: [number, string, Uint8Array] = [0, ds, ethers.getBytes(ruleEncoded)];
  const tree = StandardMerkleTree.of([row], ['uint8', 'bytes32', 'bytes']);
  return { tree, proof: tree.getProof(row) };
}

describe('Shard & RemoteShard', function () {
  let admin: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let liquidityRole: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let target: HardhatEthersSigner;
  let strategyPlaceholder: HardhatEthersSigner;

  let validator: MerkleAllowlistValidator;
  let shard: Shard;
  let remoteShard: RemoteShard;
  let mockStrategy: MockStrategyForShard;
  let strategyToken: TokenMock;
  let fundingShard: Shard;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, executor, liquidityRole, user, target, strategyPlaceholder] = await ethers.getSigners();

    const valFactory = await ethers.getContractFactory('MerkleAllowlistValidator');
    validator = (await valFactory.deploy(admin.address)) as unknown as MerkleAllowlistValidator;
    await validator.waitForDeployment();

    // Shard (strategy-linked)
    const stratFactory = await ethers.getContractFactory('Shard');
    const stratProxy = await deployContract('Shard', [
      strategyPlaceholder.address,
      await validator.getAddress(),
      admin.address,
      liquidityRole.address
    ]);
    await stratProxy.waitForDeployment();
    shard = stratFactory.attach(await stratProxy.getAddress()) as unknown as Shard;
    await shard.connect(admin).grantRole(await shard.PRIVILEGED_EXECUTOR_ROLE(), executor.address);

    // RemoteShard (no strategy pipe)
    const remoteFactory = await ethers.getContractFactory('RemoteShard');
    const remoteProxy = await deployContract('RemoteShard', [await validator.getAddress(), admin.address]);
    await remoteProxy.waitForDeployment();
    remoteShard = remoteFactory.attach(await remoteProxy.getAddress()) as unknown as RemoteShard;
    await remoteShard.connect(admin).grantRole(await remoteShard.PRIVILEGED_EXECUTOR_ROLE(), executor.address);

    strategyToken = await deployContract<TokenMock>('TokenMock', ['Strategy Token', 'STK', 18], false);

    const mockStrategyFactory = await ethers.getContractFactory('MockStrategyForShard');
    mockStrategy = (await mockStrategyFactory.deploy()) as unknown as MockStrategyForShard;
    await mockStrategy.waitForDeployment();

    const fundingStratProxy = await deployContract('Shard', [
      await mockStrategy.getAddress(),
      await validator.getAddress(),
      admin.address,
      liquidityRole.address
    ]);
    await fundingStratProxy.waitForDeployment();
    fundingShard = stratFactory.attach(await fundingStratProxy.getAddress()) as unknown as Shard;

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  // ─── Shard ────────────────────────────────────────────────────────────────

  describe('Shard', function () {
    it('initializes with expected state', async function () {
      expect(await shard.strategy()).to.equal(strategyPlaceholder.address);
      expect(await shard.validator()).to.equal(await validator.getAddress());
      expect(await shard.hasRole(await shard.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await shard.hasRole(await shard.STRATEGY_TOKEN_LIQUIDITY_ROLE(), liquidityRole.address)).to.be.true;
      expect(await shard.hasRole(await shard.PRIVILEGED_EXECUTOR_ROLE(), executor.address)).to.be.true;
    });

    it('Verify ShardStorage slot', async function () {
      const slot = calculateStorageSlot('lombardfinance.storage.Shard');
      const storage = await ethers.provider.getStorage(await shard.getAddress(), slot);
      expect(storage).to.equal(encode(['address'], [strategyPlaceholder.address]));
    });

    it('Verify ShardBaseStorage slot', async function () {
      const slot = calculateStorageSlot('lombardfinance.storage.ShardBaseUpgradeable');
      const storage = await ethers.provider.getStorage(await shard.getAddress(), slot);
      expect(storage).to.equal(encode(['address'], [await validator.getAddress()]));
    });

    it('pullFromStrategy: transfers token from strategy to shard and emits PulledFromStrategy', async function () {
      const amount = 1_000n;
      const tokenAddr = await strategyToken.getAddress();
      const shardAddr = await fundingShard.getAddress();
      const stratAddr = await mockStrategy.getAddress();

      await strategyToken.mint(stratAddr, amount);

      await expect(fundingShard.connect(liquidityRole).pullFromStrategy(tokenAddr, amount))
        .to.emit(fundingShard, 'PulledFromStrategy')
        .withArgs(liquidityRole.address, tokenAddr, amount);

      expect(await strategyToken.balanceOf(shardAddr)).to.equal(amount);
      expect(await strategyToken.balanceOf(stratAddr)).to.equal(0n);
    });

    it('pushToStrategy: transfers token from shard to strategy and emits PushedToStrategy', async function () {
      const amount = 500n;
      const tokenAddr = await strategyToken.getAddress();
      const shardAddr = await fundingShard.getAddress();
      const stratAddr = await mockStrategy.getAddress();

      await strategyToken.mint(shardAddr, amount);

      await expect(fundingShard.connect(liquidityRole).pushToStrategy(tokenAddr, amount))
        .to.emit(fundingShard, 'PushedToStrategy')
        .withArgs(liquidityRole.address, tokenAddr, amount);

      expect(await strategyToken.balanceOf(stratAddr)).to.equal(amount);
      expect(await strategyToken.balanceOf(shardAddr)).to.equal(0n);
    });

    it('exec (validator-governed): allowed call emits Executed', async function () {
      const to = target.address;
      const rule = encodeMerkleRule({
        flags: 0x02, // toSet only — wildcards sender, value, dataLength
        sender: ethers.ZeroAddress,
        to,
        value: 0n,
        dataLength: 0,
        constraints: []
      });
      const { tree, proof } = await buildTree(validator, rule);
      await validator.setAllowlistRoot(tree.root);

      const execFn = shard.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof)))
        .to.emit(shard, 'Executed')
        .withArgs(user.address, to, 0n, '0x');
    });

    it('exec (validator-governed): wrong Merkle proof reverts with Shard_CallNotAllowed', async function () {
      const to = target.address;
      const rule = encodeMerkleRule({
        flags: 0x02,
        sender: ethers.ZeroAddress,
        to,
        value: 0n,
        dataLength: 0,
        constraints: []
      });
      const { tree } = await buildTree(validator, rule);
      await validator.setAllowlistRoot(tree.root);

      // A non-empty but incorrect proof forces MerkleProof.verify to return false
      // even for a single-leaf tree (where the valid proof is the empty array).
      const badProof = [ethers.hexlify(ethers.randomBytes(32))];
      const execFn = shard.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, badProof))).to.be.revertedWithCustomError(
        shard,
        'Shard_CallNotAllowed'
      );
    });

    it('exec (validator-governed): sender mismatch reverts with Shard_CallNotAllowed', async function () {
      const to = target.address;
      // FLAG_SENDER (0x01) | FLAG_TO (0x02) — rule is pinned to executor as sender.
      const rule = encodeMerkleRule({
        flags: 0x03,
        sender: executor.address,
        to,
        value: 0n,
        dataLength: 0,
        constraints: []
      });
      const { tree, proof } = await buildTree(validator, rule);
      await validator.setAllowlistRoot(tree.root);

      // 'user' is not executor — sender check fails.
      const execFn = shard.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof))).to.be.revertedWithCustomError(
        shard,
        'Shard_CallNotAllowed'
      );
    });

    it('exec (validator-governed): zero allowlist root reverts with Shard_CallNotAllowed', async function () {
      const to = target.address;
      const rule = encodeMerkleRule({
        flags: 0x02,
        sender: ethers.ZeroAddress,
        to,
        value: 0n,
        dataLength: 0,
        constraints: []
      });
      const { proof } = await buildTree(validator, rule);
      // Explicitly clear the root so isAllowed returns false regardless of proof.
      await validator.setAllowlistRoot(ethers.ZeroHash);

      const execFn = shard.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof))).to.be.revertedWithCustomError(
        shard,
        'Shard_CallNotAllowed'
      );
    });

    it('exec (privileged): bypasses validator and emits Executed', async function () {
      const to = target.address;
      // No allowlist root set — validator would deny, but privileged path skips it.
      const execFn = shard.connect(executor).getFunction('exec(address,uint256,bytes)');
      await expect(execFn(to, 0n, '0x'))
        .to.emit(shard, 'Executed')
        .withArgs(executor.address, to, 0n, '0x');
    });

    it('exec (privileged): forwards ETH to target', async function () {
      const to = target.address;
      const amount = ethers.parseEther('1');
      const before = await ethers.provider.getBalance(to);
      const execFn = shard.connect(executor).getFunction('exec(address,uint256,bytes)');
      await execFn(to, amount, '0x', { value: amount });
      expect(await ethers.provider.getBalance(to)).to.equal(before + amount);
    });
  });

  // ─── RemoteShard ───────────────────────────────────────────────────────

  describe('RemoteShard', function () {
    it('initializes with expected state', async function () {
      expect(await remoteShard.validator()).to.equal(await validator.getAddress());
      expect(await remoteShard.hasRole(await remoteShard.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await remoteShard.hasRole(await remoteShard.PRIVILEGED_EXECUTOR_ROLE(), executor.address)).to.be.true;
    });

    it('Verify ShardBaseStorage slot', async function () {
      const slot = calculateStorageSlot('lombardfinance.storage.ShardBaseUpgradeable');
      const storage = await ethers.provider.getStorage(await remoteShard.getAddress(), slot);
      expect(storage).to.equal(encode(['address'], [await validator.getAddress()]));
    });

    it('exec (validator-governed): allowed call emits Executed', async function () {
      const to = target.address;
      const rule = encodeMerkleRule({
        flags: 0x02,
        sender: ethers.ZeroAddress,
        to,
        value: 0n,
        dataLength: 0,
        constraints: []
      });
      const { tree, proof } = await buildTree(validator, rule);
      await validator.setAllowlistRoot(tree.root);

      const execFn = remoteShard.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof)))
        .to.emit(remoteShard, 'Executed')
        .withArgs(user.address, to, 0n, '0x');
    });

    it('exec (privileged): bypasses validator and emits Executed', async function () {
      const to = target.address;
      const execFn = remoteShard.connect(executor).getFunction('exec(address,uint256,bytes)');
      await expect(execFn(to, 0n, '0x'))
        .to.emit(remoteShard, 'Executed')
        .withArgs(executor.address, to, 0n, '0x');
    });
  });
});
