import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

import type { BlocklistOracle, SanctionListMock } from '../../typechain-types';

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

  const SanctionListMockFactory = await ethers.getContractFactory('SanctionListMock');
  const sanctionList = (await SanctionListMockFactory.deploy()) as SanctionListMock;
  await sanctionList.waitForDeployment();

  return { oracle, sanctionList, admin, alice, bob, carol };
}

describe('BlocklistOracle', function () {
  describe('access control', function () {
    it('reverts blockAccount when caller lacks BLOCKLIST_SETTER_ROLE', async function () {
      const { oracle, alice } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(alice).blockAccount([alice.address])).to.be.revertedWithCustomError(
        oracle,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('allows BLOCKLIST_SETTER_ROLE (without admin) to blockAccount', async function () {
      const { oracle, admin, alice, bob } = await loadFixture(deployOracleFixture);
      const setterRole = await oracle.BLOCKLIST_SETTER_ROLE();
      await oracle.connect(admin).grantRole(setterRole, alice.address);
      await oracle.connect(alice).blockAccount([bob.address]);
      expect(await oracle.isBlocklisted(bob.address)).to.be.true;
    });

    it('reverts unblockAccount when caller has only BLOCKLIST_SETTER_ROLE', async function () {
      const { oracle, admin, alice, bob } = await loadFixture(deployOracleFixture);
      const setterRole = await oracle.BLOCKLIST_SETTER_ROLE();
      await oracle.connect(admin).grantRole(setterRole, alice.address);
      await oracle.connect(admin).blockAccount([bob.address]);
      await expect(oracle.connect(alice).unblockAccount(bob.address)).to.be.revertedWithCustomError(
        oracle,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('reverts unblockAccount when caller lacks BLOCKLIST_REMOVER_ROLE', async function () {
      const { oracle, admin, alice, bob } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([bob.address]);
      await expect(oracle.connect(alice).unblockAccount(bob.address)).to.be.revertedWithCustomError(
        oracle,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('allows BLOCKLIST_REMOVER_ROLE (without admin) to unblockAccount', async function () {
      const { oracle, admin, alice, bob } = await loadFixture(deployOracleFixture);
      const removerRole = await oracle.BLOCKLIST_REMOVER_ROLE();
      await oracle.connect(admin).grantRole(removerRole, alice.address);
      await oracle.connect(admin).blockAccount([bob.address]);
      await oracle.connect(alice).unblockAccount(bob.address);
      expect(await oracle.isBlocklisted(bob.address)).to.be.false;
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

  describe('blockAccount and unblockAccount', function () {
    it('blocks multiple accounts in one call', async function () {
      const { oracle, admin, alice, bob, carol } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).blockAccount([alice.address, bob.address, carol.address]))
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, alice.address, true)
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, bob.address, true)
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, carol.address, true);
      expect(await oracle.blocklistLength()).to.equal(3n);
    });

    it('skips already-blocklisted accounts in batch', async function () {
      const { oracle, admin, alice, bob } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      await expect(oracle.connect(admin).blockAccount([alice.address, bob.address]))
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, bob.address, true);
      expect(await oracle.isBlocklisted(alice.address)).to.be.true;
      expect(await oracle.isBlocklisted(bob.address)).to.be.true;
    });

    it('no-ops on empty array', async function () {
      const { oracle, admin } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([]);
      expect(await oracle.blocklistLength()).to.equal(0n);
    });

    it('reverts blockAccount on zero address', async function () {
      const { oracle, admin } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).blockAccount([ethers.ZeroAddress])).to.be.revertedWithCustomError(
        oracle,
        'BlocklistOracle_ZeroAddress'
      );
    });

    it('silently no-ops when already blocklisted', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      await expect(oracle.connect(admin).blockAccount([alice.address])).to.not.emit(oracle, 'BlocklistedSet');
      expect(await oracle.isBlocklisted(alice.address)).to.be.true;
    });

    it('reverts unblockAccount on zero address', async function () {
      const { oracle, admin } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).unblockAccount(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        oracle,
        'BlocklistOracle_ZeroAddress'
      );
    });

    it('reverts unblockAccount when account is not blocklisted', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).unblockAccount(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotBlocklisted')
        .withArgs(alice.address);
    });

    it('emits BlocklistedSet with sender on block', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(admin).blockAccount([alice.address]))
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, alice.address, true);
    });

    it('emits BlocklistedSet with sender on unblock', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      await expect(oracle.connect(admin).unblockAccount(alice.address))
        .to.emit(oracle, 'BlocklistedSet')
        .withArgs(admin.address, alice.address, false);
    });

    it('updates length and enumerable set when clearing', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      expect(await oracle.blocklistLength()).to.equal(1n);

      await oracle.connect(admin).unblockAccount(alice.address);
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

  describe('check', function () {
    it('blocklist', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      await expect(oracle.check.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Blocklist);
    });

    it('sanction', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(alice.address, true);
      await expect(oracle.check.staticCall(alice.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Sanction);
    });

    it('passes when not blocklisted or sanctioned', async function () {
      const { oracle, alice } = await loadFixture(deployOracleFixture);
      await oracle.check.staticCall(alice.address);
    });
  });

  describe('isBlocklisted', function () {
    it('tracks manual blocklist only', async function () {
      const { oracle, sanctionList, admin, alice } = await loadFixture(deployOracleFixture);
      expect(await oracle.isBlocklisted(alice.address)).to.be.false;
      await oracle.connect(admin).blockAccount([alice.address]);
      expect(await oracle.isBlocklisted(alice.address)).to.be.true;
      await oracle.connect(admin).unblockAccount(alice.address);
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(alice.address, true);
      expect(await oracle.isBlocklisted(alice.address)).to.be.false;
      expect(await oracle.isSanctioned(alice.address)).to.be.true;
    });
  });

  describe('getBlocklistEntries', function () {
    it('returns empty when limit is 0', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      const entries = await oracle.getBlocklistEntries(0, 0);
      expect(entries.length).to.equal(0);
    });

    it('returns empty when offset >= length', async function () {
      const { oracle, admin, alice } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address]);
      expect((await oracle.getBlocklistEntries(1, 10)).length).to.equal(0);
    });

    it('pages results', async function () {
      const { oracle, admin, alice, bob, carol } = await loadFixture(deployOracleFixture);
      await oracle.connect(admin).blockAccount([alice.address, bob.address, carol.address]);

      expect(await oracle.blocklistLength()).to.equal(3n);

      const p0 = await oracle.getBlocklistEntries(0, 2);
      expect(p0.length).to.equal(2);

      const p1 = await oracle.getBlocklistEntries(2, 5);
      expect(p1.length).to.equal(1);

      const accounts = new Set([...p0, ...p1]);
      expect(accounts.size).to.equal(3);
      expect(accounts.has(alice.address)).to.be.true;
      expect(accounts.has(bob.address)).to.be.true;
      expect(accounts.has(carol.address)).to.be.true;
    });
  });
});
