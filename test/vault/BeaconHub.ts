import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import type {
  BeaconHub,
  Strategy,
  MerkleAllowlistValidator,
  UpgradeableBeacon
} from '../../typechain-types';

const STRATEGY_ID = ethers.id('Strategy'); // keccak256("Strategy")

describe('BeaconHub', function () {
  let admin: HardhatEthersSigner;
  let beaconAdmin: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let liquidityRole: HardhatEthersSigner;

  let hub: BeaconHub;
  let strategyImpl: Strategy;
  let beacon: UpgradeableBeacon;
  let validator: MerkleAllowlistValidator;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, beaconAdmin, deployer, other, liquidityRole] = await ethers.getSigners();

    // Deploy BeaconHub as upgradeable proxy
    const hubFactory = await ethers.getContractFactory('BeaconHub');
    const hubProxy = await upgrades.deployProxy(hubFactory, [0, admin.address], {
      initializer: 'initialize',
      unsafeAllow: ['constructor']
    });
    await hubProxy.waitForDeployment();
    hub = hubFactory.attach(await hubProxy.getAddress()) as unknown as BeaconHub;

    // Grant roles
    await hub.connect(admin).grantRole(await hub.BEACON_ADMIN_ROLE(), beaconAdmin.address);
    await hub.connect(admin).grantRole(await hub.DEPLOYER_ROLE(), deployer.address);

    // Deploy Strategy implementation (no proxy — _disableInitializers in constructor)
    const stratFactory = await ethers.getContractFactory('Strategy');
    strategyImpl = (await stratFactory.deploy()) as unknown as Strategy;
    await strategyImpl.waitForDeployment();

    // Deploy UpgradeableBeacon pointing to strategy implementation
    const beaconFactory = await ethers.getContractFactory('UpgradeableBeacon');
    beacon = (await beaconFactory.deploy(
      await strategyImpl.getAddress(),
      admin.address
    )) as unknown as UpgradeableBeacon;
    await beacon.waitForDeployment();

    // Deploy validator for initData tests
    const valFactory = await ethers.getContractFactory('MerkleAllowlistValidator');
    validator = (await valFactory.deploy()) as unknown as MerkleAllowlistValidator;
    await validator.waitForDeployment();

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  // ── setBeacon ──────────────────────────────────────────────────────────────

  describe('setBeacon', function () {
    it('registers beacon and emits BeaconSet', async function () {
      const beaconAddr = await beacon.getAddress();
      await expect(hub.connect(beaconAdmin).setBeacon(STRATEGY_ID, beaconAddr))
        .to.emit(hub, 'BeaconSet')
        .withArgs(STRATEGY_ID, beaconAddr);
      expect(await hub.beacons(STRATEGY_ID)).to.equal(beaconAddr);
    });

    it('reverts for non-BEACON_ADMIN_ROLE caller', async function () {
      await expect(
        hub.connect(other).setBeacon(STRATEGY_ID, await beacon.getAddress())
      ).to.be.revertedWithCustomError(hub, 'AccessControlUnauthorizedAccount');
    });

    it('reverts with NotAContract for EOA address', async function () {
      await expect(
        hub.connect(beaconAdmin).setBeacon(STRATEGY_ID, other.address)
      )
        .to.be.revertedWithCustomError(hub, 'NotAContract')
        .withArgs(other.address);
    });

    it('allows clearing a beacon with address(0) and emits BeaconSet', async function () {
      await hub.connect(beaconAdmin).setBeacon(STRATEGY_ID, await beacon.getAddress());
      await expect(hub.connect(beaconAdmin).setBeacon(STRATEGY_ID, ethers.ZeroAddress))
        .to.emit(hub, 'BeaconSet')
        .withArgs(STRATEGY_ID, ethers.ZeroAddress);
      expect(await hub.beacons(STRATEGY_ID)).to.equal(ethers.ZeroAddress);
    });
  });

  // ── deploy ─────────────────────────────────────────────────────────────────

  describe('deploy', function () {
    beforeEach(async function () {
      await hub.connect(beaconAdmin).setBeacon(STRATEGY_ID, await beacon.getAddress());
    });

    it('deploys proxy with empty initData, tracks it, emits Deployed', async function () {
      const tx = hub.connect(deployer).deploy(STRATEGY_ID, '0x');
      const proxyAddr = await hub.connect(deployer).deploy.staticCall(STRATEGY_ID, '0x');
      await expect(tx)
        .to.emit(hub, 'Deployed')
        .withArgs(STRATEGY_ID, proxyAddr);

      expect(await hub.isDeployed(proxyAddr)).to.be.true;
      const code = await ethers.provider.getCode(proxyAddr);
      expect(code.length).to.be.greaterThan(2);
    });

    it('deploys proxy with initData and initializes correctly', async function () {
      const stratFactory = await ethers.getContractFactory('Strategy');
      const hubAddr = await hub.getAddress();
      const initData = stratFactory.interface.encodeFunctionData('initialize', [
        admin.address, // vault placeholder
        await validator.getAddress(),
        admin.address,
        liquidityRole.address
      ]);

      const proxyAddr = await hub.connect(deployer).deploy.staticCall(STRATEGY_ID, initData);
      await hub.connect(deployer).deploy(STRATEGY_ID, initData);

      const proxy = stratFactory.attach(proxyAddr) as unknown as Strategy;
      expect(await proxy.vault()).to.equal(admin.address);
    });

    it('reverts for non-DEPLOYER_ROLE caller', async function () {
      await expect(
        hub.connect(other).deploy(STRATEGY_ID, '0x')
      ).to.be.revertedWithCustomError(hub, 'AccessControlUnauthorizedAccount');
    });

    it('reverts with BeaconNotSet for unknown id', async function () {
      const unknownId = ethers.id('Unknown');
      await expect(hub.connect(deployer).deploy(unknownId, '0x'))
        .to.be.revertedWithCustomError(hub, 'BeaconNotSet')
        .withArgs(unknownId);
    });

    it('isDeployed is false for unrelated address', async function () {
      expect(await hub.isDeployed(other.address)).to.be.false;
    });

    it('multiple deploys produce distinct proxies all tracked', async function () {
      const addr1 = await hub.connect(deployer).deploy.staticCall(STRATEGY_ID, '0x');
      await hub.connect(deployer).deploy(STRATEGY_ID, '0x');
      const addr2 = await hub.connect(deployer).deploy.staticCall(STRATEGY_ID, '0x');
      await hub.connect(deployer).deploy(STRATEGY_ID, '0x');

      expect(addr1).to.not.equal(addr2);
      expect(await hub.isDeployed(addr1)).to.be.true;
      expect(await hub.isDeployed(addr2)).to.be.true;
    });
  });
});
