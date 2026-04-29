import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type {
  Strategy,
  SatelliteStrategy,
  MerkleAllowlistValidator,
  MockVaultToken,
  MockVaultForStrategy
} from '../../typechain-types';
import { encodeMerkleRule } from './MerkleCallAllowlist';

/** ABI-encode a CallVerificationInput for the IStrategyExecValidator.isAllowed(bytes) overload.
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

describe('Strategy & SatelliteStrategy', function () {
  let admin: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let liquidityRole: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let target: HardhatEthersSigner;
  let vaultPlaceholder: HardhatEthersSigner;

  let validator: MerkleAllowlistValidator;
  let strategy: Strategy;
  let satellite: SatelliteStrategy;
  let mockVault: MockVaultForStrategy;
  let vaultToken: MockVaultToken;
  let fundingStrategy: Strategy;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, executor, liquidityRole, user, target, vaultPlaceholder] = await ethers.getSigners();

    const valFactory = await ethers.getContractFactory('MerkleAllowlistValidator');
    validator = (await valFactory.deploy()) as unknown as MerkleAllowlistValidator;
    await validator.waitForDeployment();

    // Strategy (vault-linked)
    const stratFactory = await ethers.getContractFactory('Strategy');
    const stratProxy = await upgrades.deployProxy(
      stratFactory,
      [vaultPlaceholder.address, await validator.getAddress(), admin.address, liquidityRole.address],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await stratProxy.waitForDeployment();
    strategy = stratFactory.attach(await stratProxy.getAddress()) as unknown as Strategy;
    await strategy.connect(admin).grantRole(await strategy.PRIVILEGED_EXECUTOR_ROLE(), executor.address);

    // SatelliteStrategy (no vault pipe)
    const satFactory = await ethers.getContractFactory('SatelliteStrategy');
    const satProxy = await upgrades.deployProxy(satFactory, [await validator.getAddress(), admin.address], {
      initializer: 'initialize',
      unsafeAllow: ['constructor']
    });
    await satProxy.waitForDeployment();
    satellite = satFactory.attach(await satProxy.getAddress()) as unknown as SatelliteStrategy;
    await satellite.connect(admin).grantRole(await satellite.PRIVILEGED_EXECUTOR_ROLE(), executor.address);

    // Mock vault + token for pullFromVault / pushToVault happy-path tests
    const tokenFactory = await ethers.getContractFactory('MockVaultToken');
    vaultToken = (await tokenFactory.deploy()) as unknown as MockVaultToken;
    await vaultToken.waitForDeployment();

    const mockVaultFactory = await ethers.getContractFactory('MockVaultForStrategy');
    mockVault = (await mockVaultFactory.deploy()) as unknown as MockVaultForStrategy;
    await mockVault.waitForDeployment();

    const fundingStratProxy = await upgrades.deployProxy(
      stratFactory,
      [await mockVault.getAddress(), await validator.getAddress(), admin.address, liquidityRole.address],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await fundingStratProxy.waitForDeployment();
    fundingStrategy = stratFactory.attach(await fundingStratProxy.getAddress()) as unknown as Strategy;

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  // ─── Strategy ────────────────────────────────────────────────────────────────

  describe('Strategy', function () {
    it('initializes with expected state', async function () {
      expect(await strategy.vault()).to.equal(vaultPlaceholder.address);
      expect(await strategy.validator()).to.equal(await validator.getAddress());
      expect(await strategy.hasRole(await strategy.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await strategy.hasRole(await strategy.VAULT_TOKEN_LIQUIDITY_ROLE(), liquidityRole.address)).to.be.true;
      expect(await strategy.hasRole(await strategy.PRIVILEGED_EXECUTOR_ROLE(), executor.address)).to.be.true;
    });

    it('pullFromVault: transfers token from vault to strategy and emits PulledFromVault', async function () {
      const amount = 1_000n;
      const tokenAddr = await vaultToken.getAddress();
      const stratAddr = await fundingStrategy.getAddress();
      const vaultAddr = await mockVault.getAddress();

      await vaultToken.mint(vaultAddr, amount);

      await expect(fundingStrategy.connect(liquidityRole).pullFromVault(tokenAddr, amount))
        .to.emit(fundingStrategy, 'PulledFromVault')
        .withArgs(liquidityRole.address, tokenAddr, amount);

      expect(await vaultToken.balanceOf(stratAddr)).to.equal(amount);
      expect(await vaultToken.balanceOf(vaultAddr)).to.equal(0n);
    });

    it('pushToVault: transfers token from strategy to vault and emits PushedToVault', async function () {
      const amount = 500n;
      const tokenAddr = await vaultToken.getAddress();
      const stratAddr = await fundingStrategy.getAddress();
      const vaultAddr = await mockVault.getAddress();

      await vaultToken.mint(stratAddr, amount);

      await expect(fundingStrategy.connect(liquidityRole).pushToVault(tokenAddr, amount))
        .to.emit(fundingStrategy, 'PushedToVault')
        .withArgs(liquidityRole.address, tokenAddr, amount);

      expect(await vaultToken.balanceOf(vaultAddr)).to.equal(amount);
      expect(await vaultToken.balanceOf(stratAddr)).to.equal(0n);
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

      const execFn = strategy.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof)))
        .to.emit(strategy, 'Executed')
        .withArgs(user.address, to, 0n, '0x');
    });

    it('exec (privileged): bypasses validator and emits Executed', async function () {
      const to = target.address;
      // No allowlist root set — validator would deny, but privileged path skips it.
      const execFn = strategy.connect(executor).getFunction('exec(address,uint256,bytes)');
      await expect(execFn(to, 0n, '0x'))
        .to.emit(strategy, 'Executed')
        .withArgs(executor.address, to, 0n, '0x');
    });

    it('exec (privileged): forwards ETH to target', async function () {
      const to = target.address;
      const amount = ethers.parseEther('1');
      const before = await ethers.provider.getBalance(to);
      const execFn = strategy.connect(executor).getFunction('exec(address,uint256,bytes)');
      await execFn(to, amount, '0x', { value: amount });
      expect(await ethers.provider.getBalance(to)).to.equal(before + amount);
    });
  });

  // ─── SatelliteStrategy ───────────────────────────────────────────────────────

  describe('SatelliteStrategy', function () {
    it('initializes with expected state', async function () {
      expect(await satellite.validator()).to.equal(await validator.getAddress());
      expect(await satellite.hasRole(await satellite.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await satellite.hasRole(await satellite.PRIVILEGED_EXECUTOR_ROLE(), executor.address)).to.be.true;
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

      const execFn = satellite.connect(user).getFunction('exec(address,uint256,bytes,bytes)');
      await expect(execFn(to, 0n, '0x', encodeValidatorArgs(rule, proof)))
        .to.emit(satellite, 'Executed')
        .withArgs(user.address, to, 0n, '0x');
    });

    it('exec (privileged): bypasses validator and emits Executed', async function () {
      const to = target.address;
      const execFn = satellite.connect(executor).getFunction('exec(address,uint256,bytes)');
      await expect(execFn(to, 0n, '0x'))
        .to.emit(satellite, 'Executed')
        .withArgs(executor.address, to, 0n, '0x');
    });
  });
});
