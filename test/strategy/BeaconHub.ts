import { expect } from 'chai';
import { ethers } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import type { BeaconHub, Shard, MerkleAllowlistValidator, UpgradeableBeacon } from '../../typechain-types';
import { calculateStorageSlot, encode, deployContract } from '../helpers';

const SHARD_ID = ethers.id('Shard'); // keccak256("Shard")

describe('BeaconHub', function () {
  let admin: HardhatEthersSigner;
  let beaconAdmin: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let liquidityRole: HardhatEthersSigner;

  let hub: BeaconHub;
  let shardImpl: Shard;
  let beacon: UpgradeableBeacon;
  let validator: MerkleAllowlistValidator;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, beaconAdmin, deployer, other, liquidityRole] = await ethers.getSigners();

    // Deploy BeaconHub as upgradeable proxy
    const hubFactory = await ethers.getContractFactory('BeaconHub');
    const hubProxy = await deployContract('BeaconHub', [0, admin.address], true);
    await hubProxy.waitForDeployment();
    hub = hubFactory.attach(await hubProxy.getAddress()) as unknown as BeaconHub;

    // Grant roles
    await hub.connect(admin).grantRole(await hub.BEACON_ADMIN_ROLE(), beaconAdmin.address);
    await hub.connect(admin).grantRole(await hub.DEPLOYER_ROLE(), deployer.address);

    // Deploy Shard implementation (no proxy — _disableInitializers in constructor)
    const stratFactory = await ethers.getContractFactory('Shard');
    shardImpl = (await stratFactory.deploy()) as unknown as Shard;
    await shardImpl.waitForDeployment();

    beacon = await deployContract<UpgradeableBeacon>(
      'UpgradeableBeacon',
      [await shardImpl.getAddress(), admin.address],
      false
    );

    // Deploy validator for initData tests
    const valFactory = await ethers.getContractFactory('MerkleAllowlistValidator');
    validator = (await valFactory.deploy(admin.address)) as unknown as MerkleAllowlistValidator;
    await validator.waitForDeployment();

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  it('Verify storage slot', async function () {
    const beaconAddr = await beacon.getAddress();
    await hub.connect(beaconAdmin).setBeacon(SHARD_ID, beaconAddr);
    const base = calculateStorageSlot('lombardfinance.storage.BeaconHub');
    // beacons is a mapping at base+0; compute the slot for SHARD_ID
    const mappingSlot = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [SHARD_ID, base])
    );
    const storage = await ethers.provider.getStorage(await hub.getAddress(), mappingSlot);
    expect(storage).to.equal(encode(['address'], [beaconAddr]));
  });

  // ── setBeacon ──────────────────────────────────────────────────────────────

  describe('setBeacon', function () {
    it('registers beacon and emits BeaconSet', async function () {
      const beaconAddr = await beacon.getAddress();
      await expect(hub.connect(beaconAdmin).setBeacon(SHARD_ID, beaconAddr))
        .to.emit(hub, 'BeaconSet')
        .withArgs(SHARD_ID, beaconAddr);
      expect(await hub.beacon(SHARD_ID)).to.equal(beaconAddr);
    });

    it('reverts for non-BEACON_ADMIN_ROLE caller', async function () {
      await expect(hub.connect(other).setBeacon(SHARD_ID, await beacon.getAddress())).to.be.revertedWithCustomError(
        hub,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('reverts with BeaconHub_NotAContract for EOA address', async function () {
      await expect(hub.connect(beaconAdmin).setBeacon(SHARD_ID, other.address))
        .to.be.revertedWithCustomError(hub, 'BeaconHub_NotAContract')
        .withArgs(other.address);
    });

    it('allows clearing a beacon with address(0) and emits BeaconSet', async function () {
      await hub.connect(beaconAdmin).setBeacon(SHARD_ID, await beacon.getAddress());
      await expect(hub.connect(beaconAdmin).setBeacon(SHARD_ID, ethers.ZeroAddress))
        .to.emit(hub, 'BeaconSet')
        .withArgs(SHARD_ID, ethers.ZeroAddress);
      expect(await hub.beacon(SHARD_ID)).to.equal(ethers.ZeroAddress);
    });
  });

  // ── deploy ─────────────────────────────────────────────────────────────────

  describe('deploy', function () {
    beforeEach(async function () {
      await hub.connect(beaconAdmin).setBeacon(SHARD_ID, await beacon.getAddress());
    });

    it('deploys proxy with empty initData, tracks it, emits Deployed', async function () {
      const tx = hub.connect(deployer).deploy(SHARD_ID, '0x');
      const proxyAddr = await hub.connect(deployer).deploy.staticCall(SHARD_ID, '0x');
      await expect(tx).to.emit(hub, 'Deployed').withArgs(SHARD_ID, proxyAddr, deployer.address);

      expect(await hub.isDeployed(proxyAddr)).to.be.true;
      const code = await ethers.provider.getCode(proxyAddr);
      expect(code.length).to.be.greaterThan(2);
    });

    it('deploys proxy with initData and initializes correctly', async function () {
      const stratFactory = await ethers.getContractFactory('Shard');
      const initData = stratFactory.interface.encodeFunctionData('initialize', [
        admin.address, // IStrategy placeholder
        await validator.getAddress(),
        admin.address,
        liquidityRole.address
      ]);

      const proxyAddr = await hub.connect(deployer).deploy.staticCall(SHARD_ID, initData);
      await hub.connect(deployer).deploy(SHARD_ID, initData);

      const proxy = stratFactory.attach(proxyAddr) as unknown as Shard;
      expect(await proxy.strategy()).to.equal(admin.address);
    });

    it('reverts for non-DEPLOYER_ROLE caller', async function () {
      await expect(hub.connect(other).deploy(SHARD_ID, '0x')).to.be.revertedWithCustomError(
        hub,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('reverts with BeaconHub_BeaconNotSet for unknown id', async function () {
      const unknownId = ethers.id('Unknown');
      await expect(hub.connect(deployer).deploy(unknownId, '0x'))
        .to.be.revertedWithCustomError(hub, 'BeaconHub_BeaconNotSet')
        .withArgs(unknownId);
    });

    it('isDeployed is false for unrelated address', async function () {
      expect(await hub.isDeployed(other.address)).to.be.false;
    });

    it('multiple deploys produce distinct proxies all tracked', async function () {
      const addr1 = await hub.connect(deployer).deploy.staticCall(SHARD_ID, '0x');
      await hub.connect(deployer).deploy(SHARD_ID, '0x');
      const addr2 = await hub.connect(deployer).deploy.staticCall(SHARD_ID, '0x');
      await hub.connect(deployer).deploy(SHARD_ID, '0x');

      expect(addr1).to.not.equal(addr2);
      expect(await hub.isDeployed(addr1)).to.be.true;
      expect(await hub.isDeployed(addr2)).to.be.true;
    });
  });
});
