import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

import type { BlocklistOracle, SanctionListMock } from '../../typechain-types';
import { DenialReason } from './fixtures/blocklist';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('BlocklistOracle', function () {
  let oracle: BlocklistOracle;
  let sanctionList: SanctionListMock;
  let admin: HardhatEthersSigner;
  let blocklistSetter: HardhatEthersSigner;
  let blocklistRemover: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let signer3: HardhatEthersSigner;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, blocklistSetter, blocklistRemover, signer1, signer2, signer3] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('BlocklistOracle');
    oracle = (await upgrades.deployProxy(Factory, [0, admin.address], {
      initializer: 'initialize',
      unsafeAllow: ['constructor']
    })) as unknown as BlocklistOracle;
    await oracle.waitForDeployment();

    // One dedicated account per role so each test exercises exactly the role it needs.
    await oracle.connect(admin).grantRole(await oracle.BLOCKLIST_SETTER_ROLE(), blocklistSetter.address);
    await oracle.connect(admin).grantRole(await oracle.BLOCKLIST_REMOVER_ROLE(), blocklistRemover.address);

    const SanctionListMockFactory = await ethers.getContractFactory('SanctionListMock');
    sanctionList = (await SanctionListMockFactory.deploy()) as SanctionListMock;
    await sanctionList.waitForDeployment();

    snapshot = await takeSnapshot();
  });

  describe('Deployment', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('hasRole() admin has DEFAULT_ADMIN_ROLE', async function () {
      expect(await oracle.hasRole(await oracle.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it('hasRole() admin has BLOCKLIST_SETTER_ROLE', async function () {
      expect(await oracle.hasRole(await oracle.BLOCKLIST_SETTER_ROLE(), admin.address)).to.be.true;
    });

    it('blocklistLength() is zero after deployment', async function () {
      expect(await oracle.blocklistLength()).to.equal(0n);
      expect((await oracle.getBlocklistEntries(0, 100)).length).to.equal(0);
    });

    it('getSanctionLists() is empty after deployment', async function () {
      expect(await oracle.getSanctionLists()).to.deep.equal([]);
    });
  });

  describe('Blocklist', function () {
    describe('Block account', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('check() passes for an account that is neither blocked nor sanctioned', async function () {
        expect(await oracle.isBlocklisted(signer1.address)).to.be.false;
        expect(await oracle.isSanctioned(signer1.address)).to.be.false;
        await oracle.check.staticCall(signer1.address);
      });

      it('blockAccount() BLOCKLIST_SETTER_ROLE holder can block an account', async function () {
        // prettier-ignore
        await expect(oracle.connect(blocklistSetter).blockAccount([signer1.address]))
          .to.emit(oracle, 'BlocklistedSet')
          .withArgs(blocklistSetter.address, signer1.address, true);
        expect(await oracle.isBlocklisted(signer1.address)).to.be.true;
        expect(await oracle.blocklistLength()).to.equal(1n);
      });

      it('blockAccount() blocks multiple accounts in a single call', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address, signer2.address]);
        expect(await oracle.isBlocklisted(signer1.address)).to.be.true;
        expect(await oracle.isBlocklisted(signer2.address)).to.be.true;
        expect(await oracle.blocklistLength()).to.equal(2n);
      });

      it('blockAccount() skips accounts already on the blocklist within a call', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address, signer1.address]);
        expect(await oracle.isBlocklisted(signer1.address)).to.be.true;
        expect(await oracle.blocklistLength()).to.equal(1n);
      });

      it('blockAccount() accepts an empty array without changes', async function () {
        await oracle.connect(blocklistSetter).blockAccount([]);
        expect(await oracle.blocklistLength()).to.equal(0n);
      });

      it('blockAccount() reverts when caller lacks BLOCKLIST_SETTER_ROLE', async function () {
        // prettier-ignore
        await expect(oracle.connect(signer1).blockAccount([signer2.address]))
          .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
      });

      it('blockAccount() reverts when the array contains the zero address', async function () {
        // prettier-ignore
        await expect(oracle.connect(blocklistSetter).blockAccount([signer1.address, ethers.ZeroAddress]))
          .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_ZeroAddress');
        expect(await oracle.blocklistLength()).to.equal(0n);
      });

      it('check() reverts with Blocklist reason for a blocked account', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address]);
        // prettier-ignore
        await expect(oracle.check.staticCall(signer1.address))
          .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
          .withArgs(DenialReason.Blocklist);
      });
    });

    describe('getBlocklistEntries', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('returns empty when limit is 0', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address]);
        expect((await oracle.getBlocklistEntries(0, 0)).length).to.equal(0);
      });

      it('returns empty when offset >= length', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address]);
        expect((await oracle.getBlocklistEntries(1, 10)).length).to.equal(0);
      });

      it('pages results', async function () {
        await oracle.connect(blocklistSetter).blockAccount([signer1.address, signer2.address, signer3.address]);

        expect(await oracle.blocklistLength()).to.equal(3n);

        const p0 = await oracle.getBlocklistEntries(0, 2);
        expect(p0.length).to.equal(2);

        const p1 = await oracle.getBlocklistEntries(2, 5);
        expect(p1.length).to.equal(1);

        const accounts = new Set([...p0, ...p1]);
        expect(accounts.size).to.equal(3);
        expect(accounts.has(signer1.address)).to.be.true;
        expect(accounts.has(signer2.address)).to.be.true;
        expect(accounts.has(signer3.address)).to.be.true;
      });
    });

    describe('Unblock account', function () {
      beforeEach(async function () {
        await snapshot.restore();
        await oracle.connect(blocklistSetter).blockAccount([signer1.address]);
      });

      it('unblockAccount() BLOCKLIST_REMOVER_ROLE holder can unblock an account', async function () {
        // prettier-ignore
        await expect(oracle.connect(blocklistRemover).unblockAccount([signer1.address]))
          .to.emit(oracle, 'BlocklistedSet')
          .withArgs(blocklistRemover.address, signer1.address, false);
        expect(await oracle.isBlocklisted(signer1.address)).to.be.false;
      });

      it('unblockAccount() reverts when caller has only BLOCKLIST_SETTER_ROLE', async function () {
        // prettier-ignore
        await expect(oracle.connect(blocklistSetter).unblockAccount([signer1.address]))
          .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
      });

      it('unblockAccount() reverts when account is not blocklisted', async function () {
        // prettier-ignore
        await expect(oracle.connect(blocklistRemover).unblockAccount([signer2.address]))
          .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotBlocklisted')
          .withArgs(signer2.address);
      });

      it('unblockAccount() clears a batch in one call and leaves the remaining accounts blocked', async function () {
        await snapshot.restore();
        const N = 10;
        const accounts = Array.from({ length: N }, () => ethers.Wallet.createRandom().address);
        await oracle.connect(blocklistSetter).blockAccount(accounts);

        // A single page of size N covers the whole (unordered) enumerable view.
        const collectBlocklist = async () => [...(await oracle.getBlocklistEntries(0, N))];

        expect(await oracle.blocklistLength()).to.equal(BigInt(N));
        expect(await collectBlocklist()).to.have.members(accounts);

        // Unblock the even-indexed accounts (0, 2, 4, ...) — N / 2 of them — in a single call.
        const unblocked = accounts.filter((_, i) => i % 2 === 0);
        const stillBlocked = accounts.filter((_, i) => i % 2 !== 0);
        await oracle.connect(blocklistRemover).unblockAccount(unblocked);

        expect(await oracle.blocklistLength()).to.equal(BigInt(N - unblocked.length));
        for (const account of unblocked) {
          expect(await oracle.isBlocklisted(account)).to.be.false;
        }
        for (const account of stillBlocked) {
          expect(await oracle.isBlocklisted(account)).to.be.true;
        }
        expect(await collectBlocklist()).to.have.members(stillBlocked);
      });
    });
  });

  describe('Allowlist', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('allowAccount() admin can allow an account', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).allowAccount([signer1.address]))
        .to.emit(oracle, 'AllowlistedSet')
        .withArgs(admin.address, signer1.address, true);
      expect(await oracle.isAllowlisted(signer1.address)).to.be.true;
      expect(await oracle.allowlistLength()).to.equal(1n);
    });

    it('allowAccount() allows multiple accounts in a single call', async function () {
      await oracle.connect(admin).allowAccount([signer1.address, signer2.address]);
      expect(await oracle.isAllowlisted(signer1.address)).to.be.true;
      expect(await oracle.isAllowlisted(signer2.address)).to.be.true;
      expect(await oracle.allowlistLength()).to.equal(2n);
    });

    it('allowAccount() skips accounts already allowlisted within a call', async function () {
      await oracle.connect(admin).allowAccount([signer1.address, signer1.address]);
      expect(await oracle.isAllowlisted(signer1.address)).to.be.true;
      expect(await oracle.allowlistLength()).to.equal(1n);
    });

    it('allowAccount() accepts an empty array without changes', async function () {
      await oracle.connect(admin).allowAccount([]);
      expect(await oracle.allowlistLength()).to.equal(0n);
    });

    it('allowAccount() reverts when caller lacks DEFAULT_ADMIN_ROLE', async function () {
      // prettier-ignore
      await expect(oracle.connect(signer1).allowAccount([signer2.address]))
        .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });

    it('allowAccount() reverts when the array contains the zero address', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).allowAccount([signer1.address, ethers.ZeroAddress]))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_ZeroAddress');
      expect(await oracle.allowlistLength()).to.equal(0n);
    });

    it('getAllowlistEntries() returns empty when limit is 0', async function () {
      await oracle.connect(admin).allowAccount([signer1.address]);
      expect((await oracle.getAllowlistEntries(0, 0)).length).to.equal(0);
    });

    it('getAllowlistEntries() returns empty when offset >= length', async function () {
      await oracle.connect(admin).allowAccount([signer1.address]);
      expect((await oracle.getAllowlistEntries(1, 10)).length).to.equal(0);
    });

    it('getAllowlistEntries() pages results', async function () {
      await oracle.connect(admin).allowAccount([signer1.address, signer2.address, signer3.address]);

      expect(await oracle.allowlistLength()).to.equal(3n);

      const p0 = await oracle.getAllowlistEntries(0, 2);
      expect(p0.length).to.equal(2);

      const p1 = await oracle.getAllowlistEntries(2, 5);
      expect(p1.length).to.equal(1);

      const accounts = new Set([...p0, ...p1]);
      expect(accounts.size).to.equal(3);
      expect(accounts.has(signer1.address)).to.be.true;
      expect(accounts.has(signer2.address)).to.be.true;
      expect(accounts.has(signer3.address)).to.be.true;
    });

    it('disallowAccount() admin can disallow an account', async function () {
      await oracle.connect(admin).allowAccount([signer1.address]);
      // prettier-ignore
      await expect(oracle.connect(admin).disallowAccount([signer1.address]))
        .to.emit(oracle, 'AllowlistedSet')
        .withArgs(admin.address, signer1.address, false);
      expect(await oracle.isAllowlisted(signer1.address)).to.be.false;
    });

    it('disallowAccount() reverts when caller lacks DEFAULT_ADMIN_ROLE', async function () {
      await oracle.connect(admin).allowAccount([signer2.address]);
      // prettier-ignore
      await expect(oracle.connect(signer1).disallowAccount([signer2.address]))
        .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });

    it('disallowAccount() reverts when account is not allowlisted', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).disallowAccount([signer1.address]))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowlisted')
        .withArgs(signer1.address);
    });

    it('disallowAccount() clears a batch in one call and leaves the remaining accounts allowlisted', async function () {
      const N = 10;
      const accounts = Array.from({ length: N }, () => ethers.Wallet.createRandom().address);
      await oracle.connect(admin).allowAccount(accounts);

      // A single page of size N covers the whole (unordered) enumerable view.
      const collectAllowlist = async () => [...(await oracle.getAllowlistEntries(0, N))];

      expect(await oracle.allowlistLength()).to.equal(BigInt(N));
      expect(await collectAllowlist()).to.have.members(accounts);

      // Disallow the even-indexed accounts (0, 2, 4, ...) — N / 2 of them — in a single call.
      const disallowed = accounts.filter((_, i) => i % 2 === 0);
      const stillAllowed = accounts.filter((_, i) => i % 2 !== 0);
      await oracle.connect(admin).disallowAccount(disallowed);

      expect(await oracle.allowlistLength()).to.equal(BigInt(N - disallowed.length));
      for (const account of disallowed) {
        expect(await oracle.isAllowlisted(account)).to.be.false;
      }
      for (const account of stillAllowed) {
        expect(await oracle.isAllowlisted(account)).to.be.true;
      }
      expect(await collectAllowlist()).to.have.members(stillAllowed);
    });

    it('isSanctioned() returns false for an allowlisted account even when a sanction list flags it', async function () {
      const addr = await sanctionList.getAddress();
      await oracle.connect(admin).addSanctionList(addr);
      await sanctionList.setSanctioned(signer1.address, true);
      expect(await oracle.isSanctioned(signer1.address)).to.be.true;

      await oracle.connect(admin).allowAccount([signer1.address]);
      expect(await oracle.isSanctioned(signer1.address)).to.be.false;
    });
  });

  describe('Sanctions lists', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('addSanctionList() admin can add a sanction list', async function () {
      const addr = await sanctionList.getAddress();
      // prettier-ignore
      await expect(oracle.connect(admin).addSanctionList(addr))
        .to.emit(oracle, 'SanctionListAdded')
        .withArgs(admin.address, addr);
      expect(await oracle.getSanctionLists()).to.deep.equal([addr]);
    });

    it('removeSanctionList() admin can remove a sanction list', async function () {
      const addr = await sanctionList.getAddress();
      await oracle.connect(admin).addSanctionList(addr);
      // prettier-ignore
      await expect(oracle.connect(admin).removeSanctionList(addr))
        .to.emit(oracle, 'SanctionListRemoved')
        .withArgs(admin.address, addr);
      expect(await oracle.getSanctionLists()).to.deep.equal([]);
    });

    it('reverts when non-admin adds a sanction list', async function () {
      // prettier-ignore
      await expect(oracle.connect(signer1).addSanctionList(await sanctionList.getAddress()))
        .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });

    it('reverts when non-admin removes a sanction list', async function () {
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      // prettier-ignore
      await expect(oracle.connect(signer1).removeSanctionList(await sanctionList.getAddress()))
        .to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
    });

    it('reverts on adding zero address', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).addSanctionList(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_ZeroAddress');
    });

    it('reverts on removing zero address', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).removeSanctionList(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_ZeroAddress');
    });

    it('reverts when sanction list already added', async function () {
      const addr = await sanctionList.getAddress();
      await oracle.connect(admin).addSanctionList(addr);
      // prettier-ignore
      await expect(oracle.connect(admin).addSanctionList(addr))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_SanctionListAlreadyAdded');
    });

    it('reverts when removing an unknown sanction list', async function () {
      // prettier-ignore
      await expect(oracle.connect(admin).removeSanctionList(await sanctionList.getAddress()))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_SanctionListNotFound');
    });

    it('reports an account as not sanctioned when no list flags it', async function () {
      expect(await oracle.isSanctioned(signer1.address)).to.be.false;
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      expect(await oracle.isSanctioned(signer1.address)).to.be.false;
    });

    it('isSanctioned() reports an account as sanctioned when a list flags it', async function () {
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(signer1.address, true);
      expect(await oracle.isSanctioned(signer1.address)).to.be.true;
      expect(await oracle.isBlocklisted(signer1.address)).to.be.false;
    });

    it('check() reverts with Sanction reason for a sanctioned account', async function () {
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(signer1.address, true);
      // prettier-ignore
      await expect(oracle.check.staticCall(signer1.address))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Sanction);
    });
  });
});
