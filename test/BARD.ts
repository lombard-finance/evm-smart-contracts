import { ethers as ethers2 } from 'ethers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { mine, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  getSignersWithPrivateKeys,
  Signer} from './helpers';
import { BARD, BARDMock } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('BARD', function () {
  let deployer: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    treasury: Signer,
    treasury2: Signer,
    admin: Signer;
  let bardMock: BARDMock;
  let bard: BARD;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  const oneYear = 60 * 60 * 24 * 365;

  before(async function () {
    [deployer, signer1, signer2, signer3, treasury, treasury2, admin] = await getSignersWithPrivateKeys();

    bardMock = await deployContract<BARDMock>('BARDMock', [], false)

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore()
  });

  describe('Constructor', function () {

    afterEach(async function () {
      // clean the state after each test
      await snapshot.restore()
    });

    it('treasury receives expected number of tokens. total supply is correct', async function () {
      const token = await deployContract<BARD>('BARD', [admin, treasury], false)
      expect(await token.balanceOf(treasury)).to.equal(ethers2.parseEther("1000000000"))
      expect(await token.totalSupply()).to.equal(ethers2.parseEther("1000000000"))
    });

    it('treasury canot be empty', async function () {
      await expect(deployContract<BARD>('BARD', [admin, '0x0000000000000000000000000000000000000000'], false)).to.revertedWithCustomError(
        bardMock,
        'ZeroAddressException'
      )
    });

    it('owner canot be empty', async function () {
      await expect(deployContract<BARD>('BARD', ['0x0000000000000000000000000000000000000000', treasury], false)).to.revertedWithCustomError(
        bardMock,
        'OwnableInvalidOwner'
      )
    });
  });

  describe('Time and volume constrained minting', function () {
    let deployTimestamp: number;

    beforeEach(async function () {
      bard = await deployContract<BARD>('BARD', [admin, treasury], false);
      deployTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
    });

    afterEach(async function () {
      // clean the state after each test
      await snapshot.restore()
    });

    it('owner can mint 365 days after deploy', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1)
      expect(await bard.connect(admin).mint(treasury2, ethers2.parseEther("100000000"))).to.emit(bard, 'Mint').withArgs(
        treasury2, ethers2.parseEther("100000000")
      )
      expect(await bard.balanceOf(treasury)).to.equal(ethers2.parseEther("1000000000"))
      expect(await bard.balanceOf(treasury2)).to.equal(ethers2.parseEther("100000000"))
      expect(await bard.totalSupply()).to.equal(ethers2.parseEther("1100000000"))
    });

    it('owner can mint second time 365 days after previous mint', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1)
      expect(await bard.connect(admin).mint(treasury2, ethers2.parseEther("100000000"))).to.emit(bard, 'Mint').withArgs(
        treasury2, ethers2.parseEther("100000000")
      )
      expect(await bard.balanceOf(treasury)).to.equal(ethers2.parseEther("1000000000"))
      expect(await bard.balanceOf(treasury2)).to.equal(ethers2.parseEther("100000000"))
      expect(await bard.totalSupply()).to.equal(ethers2.parseEther("1100000000"))

      const mintTimetsamp = (await ethers.provider.getBlock('latest'))!.timestamp
      await time.increaseTo(mintTimetsamp + oneYear + 1)
      expect(await bard.connect(admin).mint(treasury2, ethers2.parseEther("50000000"))).to.emit(bard, 'Mint').withArgs(
        treasury2, ethers2.parseEther("50000000")
      )

      expect(await bard.balanceOf(treasury)).to.equal(ethers2.parseEther("1000000000"))
      expect(await bard.balanceOf(treasury2)).to.equal(ethers2.parseEther("150000000"))
      expect(await bard.totalSupply()).to.equal(ethers2.parseEther("1150000000"))
    });

    it('non-owner cannot mint after 365 days', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1)
      await expect(bard.connect(deployer).mint(treasury2, ethers2.parseEther("100000000"))).to.revertedWithCustomError(
        bard,
        'OwnableUnauthorizedAccount'
      ).withArgs(deployer.address)
    });

    it('owner cannot mint earlier than 365 days after deploy', async function () {
      await time.increaseTo(deployTimestamp + oneYear - 10)
      await expect(bard.connect(admin).mint(treasury2, ethers2.parseEther("100000000"))).to.revertedWithCustomError(
        bard,
        'MintWaitPeriodNotClosed'
      ).withArgs(9)
    });

    it('owner cannot mint earlier than 365 days after previous mint', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 10000)
      expect(await bard.connect(admin).mint(treasury2, ethers2.parseEther("100000000"))).to.emit(bard, 'Mint').withArgs(
        treasury2, ethers2.parseEther("100000000")
      )
      expect(await bard.balanceOf(treasury)).to.equal(ethers2.parseEther("1000000000"))
      expect(await bard.balanceOf(treasury2)).to.equal(ethers2.parseEther("100000000"))
      expect(await bard.totalSupply()).to.equal(ethers2.parseEther("1100000000"))

      await time.increaseTo(deployTimestamp + oneYear * 2 + 2)
      await expect(bard.connect(admin).mint(treasury2, ethers2.parseEther("100000000"))).to.revertedWithCustomError(
        bard,
        'MintWaitPeriodNotClosed'
      ).withArgs(10000-2)
    });

    it('owner cannot mint more than 10% of the current total supply', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1)
      await expect(bard.connect(admin).mint(treasury2, ethers2.parseEther("100000001"))).to.revertedWithCustomError(
        bard,
        'MaxInflationExceeded'
      ).withArgs(ethers2.parseEther("100000000"))
    });
  });
});
