import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

import type { BlocklistOracle, MockSanctionList } from '../../typechain-types';

/** Matches `IBlocklistOracle.DenialReason`. */
const DenialReason = {
  Blocklist: 0,
  Sanction: 1
} as const;

async function deployOracleFixture() {
  const [admin, alice, bob, carol] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory('BlocklistOracle');
  const oracle = (await upgrades.deployProxy(Factory, [0, admin.address], {
    initializer: 'initialize',
    unsafeAllow: ['constructor']
  })) as unknown as BlocklistOracle;
  await oracle.waitForDeployment();

  const MockSanctionListFactory = await ethers.getContractFactory('MockSanctionList');
  const sanctionList = (await MockSanctionListFactory.deploy()) as MockSanctionList;
  await sanctionList.waitForDeployment();

  return { oracle, sanctionList, admin, alice, bob, carol };
}

describe('BlocklistOracle', function () {
  describe('access control', function () {
    it('reverts when non-admin sets blocklist', async function () {
      const { oracle, alice } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(alice).setBlocklistEntry(alice.address, true, false)).to.be.revertedWithCustomError(
        oracle,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('reverts when non-admin adds sanction list', async function () {
      const { oracle, sanctionList, alice } = await loadFixture(deployOracleFixture);
      await expect(
        oracle.connect(alice).addSanctionList(await sanctionList.getAddress())
      ).to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });

    it('reverts when non-admin removes sanction list', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await expect(
        oracle.connect(alice).removeSanctionList(await sanctionList.getAddress())
      ).to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('setBlocklistEntry', function () {
    it('reverts on zero address', async function () {
      const { oracle, admin } = await loadFixture(deployOracleFixture);
      await expect(
        oracle.connect(admin).setBlocklistEntry(ethers.ZeroAddress, true, false)
      ).to.be.revertedWithCustomError(oracle, 'BlocklistOracle_ZeroAddress');
    });

    it('emits BlocklistEntrySet with sender', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).setBlocklistEntry(alice.address, true, false))
        .to.emit(oracle, 'BlocklistEntrySet')
        .withArgs(admin.address, alice.address, true, false);
    });

    it('updates length and enumerable set when clearing', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      expect(await oracle.blocklistLength()).to.equal(1n);

      await oracle.connect(admin).setBlocklistEntry(alice.address, false, false);
      expect(await oracle.blocklistLength()).to.equal(0n);
      const entries = await oracle.getBlocklistEntries(0, 100);
      expect(entries.length).to.equal(0);
    });
  });

  describe('sanction lists', function () {
    it('reverts addSanctionList with zero address', async function () {
      const { oracle, admin } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).addSanctionList(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        oracle,
        'BlocklistOracle_ZeroAddress'
      );
    });

    it('reverts duplicate add', async function () {
      const { oracle, sanctionList, admin } = await loadFixture(deployOracleFixture);
      const addr = await sanctionList.getAddress();
      await oracle.connect(admin).addSanctionList(addr);
      await expect(oracle.connect(admin).addSanctionList(addr)).to.be.revertedWithCustomError(
        oracle,
        'BlocklistOracle_SanctionListAlreadyAdded'
      );
    });

    it('reverts remove when missing', async function () {
      const { oracle, sanctionList, admin } = await loadFixture(deployOracleFixture);
      await expect(
        oracle.connect(admin).removeSanctionList(await sanctionList.getAddress())
      ).to.be.revertedWithCustomError(oracle, 'BlocklistOracle_SanctionListNotFound');
    });

    it('lists sanction contracts via getSanctionLists', async function () {
      const { oracle, sanctionList, admin } = await loadFixture(deployOracleFixture);
      const addr = await sanctionList.getAddress();
      await oracle.connect(admin).addSanctionList(addr);
      const lists = await oracle.getSanctionLists();
      expect(lists).to.deep.equal([addr]);
      await oracle.connect(admin).removeSanctionList(addr);
      expect(await oracle.getSanctionLists()).to.deep.equal([]);
    });
  });

  describe('isSanctioned', function () {
    it('returns false when no lists or not sanctioned', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      expect(await oracle.isSanctioned(alice.address)).to.be.false;
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      expect(await oracle.isSanctioned(alice.address)).to.be.false;
    });

    it('returns true when any list sanctions the account', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(alice.address, true);
      expect(await oracle.isSanctioned(alice.address)).to.be.true;
    });
  });

  describe('onDeposit / onRedeem', function () {
    it('deposit: blocklist', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      await expect(oracle.onDeposit.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_DepositNotAllowed')
        .withArgs(DenialReason.Blocklist);
    });

    it('deposit: sanction', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(alice.address, true);
      await expect(oracle.onDeposit.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_DepositNotAllowed')
        .withArgs(DenialReason.Sanction);
    });

    it('redeem: blocklist', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, false, true);
      await expect(oracle.onRedeem.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_RedeemNotAllowed')
        .withArgs(DenialReason.Blocklist);
    });

    it('redeem: sanction', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(alice.address, true);
      await expect(oracle.onRedeem.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_RedeemNotAllowed')
        .withArgs(DenialReason.Sanction);
    });

    it('deposit blocked only for deposit flag; redeem may pass', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      await oracle.onRedeem.staticCall(alice.address);
    });

    it('redeem blocked only for redeem flag; deposit may pass', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, false, true);
      await oracle.onDeposit.staticCall(alice.address);
    });
  });

  describe('getBlocklistEntries', function () {
    it('returns empty when limit is 0', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      const entries = await oracle.getBlocklistEntries(0, 0);
      expect(entries.length).to.equal(0);
    });

    it('returns empty when offset >= length', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      expect((await oracle.getBlocklistEntries(1, 10)).length).to.equal(0);
    });

    it('pages results', async function () {
      const { oracle, admin, alice, bob, carol } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).setBlocklistEntry(alice.address, true, false);
      await oracle.connect(admin).setBlocklistEntry(bob.address, false, true);
      await oracle.connect(admin).setBlocklistEntry(carol.address, true, true);

      expect(await oracle.blocklistLength()).to.equal(3n);

      const p0 = await oracle.getBlocklistEntries(0, 2);
      expect(p0.length).to.equal(2);

      const p1 = await oracle.getBlocklistEntries(2, 5);
      expect(p1.length).to.equal(1);

      const accounts = new Set([...p0, ...p1].map(e => e.account));
      expect(accounts.size).to.equal(3);
      expect(accounts.has(alice.address)).to.be.true;
      expect(accounts.has(bob.address)).to.be.true;
      expect(accounts.has(carol.address)).to.be.true;
    });
  });
});
