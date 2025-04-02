import { ethers } from 'hardhat';
import { expect } from 'chai';
import { deployContract, init, Signer } from './helpers';
import { IBCVoucher, LBTCMock } from '../typechain-types';
import { time, SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

describe('IBCVoucher', function () {
  this.timeout(15_000);

  let deployer: Signer,
    signer1: Signer,
    signer2: Signer,
    admin: Signer,
    relayer: Signer,
    operator: Signer,
    pauser: Signer,
    treasury: Signer;
  let ibcVoucher: IBCVoucher;
  let lbtc: LBTCMock;
  let snapshot: SnapshotRestorer;
  const fee = 10n;
  const amount = 100n;
  const oneHour = 60 * 60;

  before(async function () {
    [deployer, signer1, signer2, admin, relayer, operator, pauser, treasury] = await ethers.getSigners();

    const burnCommission = 1000;
    const result = await init(burnCommission, treasury.address, admin.address);
    lbtc = result.lbtc;

    ibcVoucher = await deployContract<IBCVoucher>('IBCVoucher', [
      await lbtc.getAddress(),
      admin.address,
      fee,
      treasury.address
    ]);

    // set deployer as minter
    await lbtc.connect(admin).addMinter(admin.address);
    // IBC Voucher needs to be minter
    await lbtc.connect(admin).addMinter(await ibcVoucher.getAddress());

    // Initialize the permit module
    await lbtc.connect(admin).reinitialize();
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.RELAYER_ROLE(), relayer.address);
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.OPERATOR_ROLE(), operator.address);
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.PAUSER_ROLE(), pauser.address);

    snapshot = await takeSnapshot();
  });

  describe('Setters', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('Name', async function () {
      expect(await ibcVoucher.name()).to.be.eq('IBC compatible LBTC Voucher');
    });

    it('Symbol', async function () {
      expect(await ibcVoucher.symbol()).to.be.eq('iLBTCv');
    });

    it('Decimals', async function () {
      expect(await ibcVoucher.decimals()).to.be.eq(8n);
    });

    it('LBTC', async function () {
      expect(await ibcVoucher.lbtc()).to.be.eq(await lbtc.getAddress());
    });

    it('should allow admin to set treasury', async function () {
      await expect(ibcVoucher.connect(admin).setTreasuryAddress(signer1.address))
        .to.emit(ibcVoucher, 'TreasuryUpdated')
        .withArgs(signer1.address);
      expect(await ibcVoucher.getTreasury()).to.be.eq(signer1.address);
    });

    it('should not allow anyone else to set treasury', async function () {
      await expect(ibcVoucher.connect(signer1).setTreasuryAddress(signer1.address)).to.be.revertedWithCustomError(
        ibcVoucher,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('setFee: admin can set fee for wrapping', async function () {
      await expect(ibcVoucher.connect(admin).setFee(200)).to.emit(ibcVoucher, 'FeeUpdated').withArgs(200);
      expect(await ibcVoucher.getFee()).to.be.eq(200);
    });

    it('setFee: rejects when called by not admin', async function () {
      await expect(ibcVoucher.connect(signer1).setFee(200)).to.be.revertedWithCustomError(
        ibcVoucher,
        'AccessControlUnauthorizedAccount'
      );
    });
  });

  describe('Wrapping', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)['mint(address,uint256)'](relayer.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount);
    });

    it('should allow a relayer to wrap LBTC by accepting any fee', async function () {
      await expect(ibcVoucher.connect(relayer)['wrap(uint256)'](amount))
        .to.emit(lbtc, 'Transfer')
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(ethers.ZeroAddress, relayer.address, amount - fee)
        .to.emit(ibcVoucher, 'VoucherMinted')
        .withArgs(relayer.address, relayer.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(relayer.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it('should allow a relayer to wrap LBTC with slippage control', async function () {
      await expect(ibcVoucher.connect(relayer)['wrap(uint256,uint256)'](amount, amount - fee))
        .to.emit(lbtc, 'Transfer')
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(ethers.ZeroAddress, relayer.address, amount - fee)
        .to.emit(ibcVoucher, 'VoucherMinted')
        .withArgs(relayer.address, relayer.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(relayer.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it('should allow a relayer to wrap LBTC to a given address by accepting any fee', async function () {
      await expect(ibcVoucher.connect(relayer)['wrapTo(address,uint256)'](signer1.address, amount))
        .to.emit(lbtc, 'Transfer')
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, amount - fee)
        .to.emit(ibcVoucher, 'VoucherMinted')
        .withArgs(relayer.address, signer1.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it('should allow a relayer to wrap LBTC to a given address with fee control', async function () {
      await expect(
        ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, amount - fee)
      )
        .to.emit(lbtc, 'Transfer')
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, 'Transfer')
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, amount - fee)
        .to.emit(ibcVoucher, 'VoucherMinted')
        .withArgs(relayer.address, signer1.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it('should not allow to wrap with amount equal to or below fee amount', async function () {
      await expect(ibcVoucher.connect(relayer)['wrap(uint256,uint256)'](fee, 0)).to.be.revertedWithCustomError(
        ibcVoucher,
        'AmountTooLow'
      );
    });

    it('should not allow to wrapTo with amount equal to or below fee amount', async function () {
      await expect(
        ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, fee, 0)
      ).to.be.revertedWithCustomError(ibcVoucher, 'AmountTooLow');
    });

    it('should not allow wrap with slippage protection exceeded', async function () {
      await expect(ibcVoucher.connect(relayer)['wrap(uint256,uint256)'](amount, amount - fee + 1n))
        .to.be.revertedWithCustomError(ibcVoucher, 'SlippageExceeded')
        .withArgs(amount - fee, amount - fee + 1n);
    });

    it('should not allow wrapTo with slippage protection exceeded', async function () {
      await expect(
        ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, amount - fee + 1n)
      )
        .to.be.revertedWithCustomError(ibcVoucher, 'SlippageExceeded')
        .withArgs(amount - fee, amount - fee + 1n);
    });
  });

  describe('Spending', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)['mint(address,uint256)'](relayer.address, amount + fee);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount + fee);
      await ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount + fee, 0);
    });

    it('should allow anyone to spend voucher', async function () {
      await expect(ibcVoucher.connect(signer1).spend(amount))
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, amount)
        .to.emit(ibcVoucher, 'VoucherSpent')
        .withArgs(signer1.address, signer1.address, amount);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
      expect(await ibcVoucher.totalSupply()).to.be.eq(0);
    });

    it('should allow anyone to spend voucher to a given address', async function () {
      await expect(ibcVoucher.connect(signer1).spendTo(signer2.address, amount))
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, amount)
        .to.emit(ibcVoucher, 'VoucherSpent')
        .withArgs(signer1.address, signer2.address, amount);

      expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
      expect(await ibcVoucher.totalSupply()).to.be.eq(0);
    });

    it('should allow operator to spendFrom voucher', async function () {
      await expect(ibcVoucher.connect(operator).spendFrom(signer1.address, amount))
        .to.emit(ibcVoucher, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, amount)
        .to.emit(ibcVoucher, 'VoucherSpent')
        .withArgs(signer1.address, signer1.address, amount);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
    });
  });

  describe('Access control', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)['mint(address,uint256)'](relayer.address, amount + fee);
      await lbtc.connect(admin)['mint(address,uint256)'](signer1.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount + fee);
      await ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount + fee, 0);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(amount);
    });

    it('should not allow just anyone to wrap LBTC', async function () {
      await expect(ibcVoucher.connect(signer1)['wrap(uint256,uint256)'](amount, 0)).to.be.revertedWithCustomError(
        ibcVoucher,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('should not allow just anyone to wrap LBTC to a given address', async function () {
      await expect(
        ibcVoucher.connect(signer1)['wrapTo(address,uint256,uint256)'](signer2.address, amount, 0)
      ).to.be.revertedWithCustomError(ibcVoucher, 'AccessControlUnauthorizedAccount');
    });

    it('should not allow just anyone to spendFrom LBTC', async function () {
      await expect(ibcVoucher.connect(signer1).spendFrom(signer1.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        'AccessControlUnauthorizedAccount'
      );
    });
  });

  describe('Pausing', function () {
    before(async function () {
      await lbtc.connect(admin)['mint(address,uint256)'](relayer.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount);
    });

    it('pause: rejects when called by not pauser', async function () {
      await expect(ibcVoucher.connect(signer1).unpause()).to.be.rejectedWith('AccessControlUnauthorizedAccount');
    });

    it('pauser can pause', async function () {
      await expect(ibcVoucher.connect(pauser).pause()).to.emit(ibcVoucher, 'Paused').withArgs(pauser.address);
      expect(await ibcVoucher.paused()).to.be.true;
    });

    it('should disallow `wrap` when paused', async function () {
      await expect(ibcVoucher.connect(relayer)['wrap(uint256,uint256)'](amount, 0)).to.be.revertedWithCustomError(
        ibcVoucher,
        'EnforcedPause'
      );
    });

    it('should disallow `wrapTo` when paused', async function () {
      await expect(
        ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, 0)
      ).to.be.revertedWithCustomError(ibcVoucher, 'EnforcedPause');
    });

    it('should disallow `spend` when paused', async function () {
      await expect(ibcVoucher.spend(amount)).to.be.revertedWithCustomError(ibcVoucher, 'EnforcedPause');
    });

    it('should disallow `spendTo` when paused', async function () {
      await expect(ibcVoucher.spendTo(signer1.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        'EnforcedPause'
      );
    });

    it('pauser can not unpause', async function () {
      await expect(ibcVoucher.connect(pauser).unpause()).to.be.rejectedWith('AccessControlUnauthorizedAccount');
    });

    it('admin can unpause', async function () {
      await expect(ibcVoucher.connect(admin).unpause()).to.emit(ibcVoucher, 'Unpaused').withArgs(admin.address);
      expect(await ibcVoucher.paused()).to.be.false;

      await ibcVoucher.connect(relayer)['wrap(uint256,uint256)'](amount, 0);
    });

    it('admin can be pauser', async function () {
      await ibcVoucher.connect(admin).grantRole(await ibcVoucher.PAUSER_ROLE(), admin.address);
      await expect(ibcVoucher.connect(admin).pause()).to.emit(ibcVoucher, 'Paused').withArgs(admin.address);
      expect(await ibcVoucher.paused()).to.be.true;
    });
  });

  describe('Rate limits', function () {
    let rateLimit = 0n;
    let rateLimitPercent = 1000n;
    let RATIO_MULTIPLIER = 0n;

    before(async function () {
      await snapshot.restore();
      RATIO_MULTIPLIER = await ibcVoucher.RATIO_MULTIPLIER();
      await ibcVoucher.connect(admin).setFee(0n);
      await lbtc.connect(admin)['mint(address,uint256)'](relayer.address, 10000_0000);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), 10000_0000);
    });

    it('setRateLimit: admin can set rate limit when supply > 0', async function () {
      const amount = 1000n;
      await ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, 0);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount);
      rateLimit = ((await ibcVoucher.totalSupply()) * rateLimitPercent) / RATIO_MULTIPLIER;

      const startTime = await time.latest();
      await expect(ibcVoucher.connect(admin).setRateLimit(rateLimitPercent, oneHour, startTime))
        .to.emit(ibcVoucher, 'RateLimitUpdated')
        .withArgs(rateLimit, oneHour, rateLimitPercent);

      const rateLimitConfig = await ibcVoucher.rateLimitConfig();
      const initialLeftover = await ibcVoucher.leftoverAmount();
      console.log('Initial leftover:', initialLeftover);

      expect(initialLeftover).to.be.equal(rateLimit);
      expect(rateLimitConfig.supplyAtUpdate).to.be.eq(amount);
      expect(rateLimitConfig.limit).to.be.eq(rateLimit);
      expect(rateLimitConfig.credit).to.be.eq(rateLimit);
      expect(rateLimitConfig.startTime).to.be.eq(startTime);
      expect(rateLimitConfig.window).to.be.eq(oneHour);
      expect(rateLimitConfig.epoch).to.be.eq(0n);
      expect(rateLimitConfig.threshold).to.be.eq(rateLimitPercent);
    });

    it('setRateLimit: rejects when called by not admin', async function () {
      await expect(
        ibcVoucher.connect(signer1).setRateLimit(rateLimitPercent, oneHour, await time.latest())
      ).to.be.revertedWithCustomError(ibcVoucher, 'AccessControlUnauthorizedAccount');
    });

    it('spend: rejects when amount > leftover and leftover > 0', async function () {
      const amount = await ibcVoucher.leftoverAmount();
      await expect(amount).to.be.gt(0n);
      await expect(ibcVoucher.connect(signer1).spend(amount + 1n)).to.be.revertedWithCustomError(
        ibcVoucher,
        'RateLimitExceeded'
      );
    });

    it('leftoverAmount increases by wrap amount', async function () {
      const amount = 1000n;
      const leftoverBefore = await ibcVoucher.leftoverAmount();
      const totalSupplyBefore = await ibcVoucher.totalSupply();

      await expect(ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, 0))
        .to.emit(ibcVoucher, 'RateLimitOutflowIncreased')
        .withArgs(rateLimit, amount)
        .to.not.emit(ibcVoucher, 'RateLimitUpdated');

      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after wrap:', leftoverAfter);

      expect(leftoverAfter - leftoverBefore).to.be.equal(amount);
      expect(await ibcVoucher.totalSupply()).to.be.eq(totalSupplyBefore + amount);
    });

    it('spend: can partially spend leftover', async function () {
      const leftoverBefore = await ibcVoucher.leftoverAmount();
      await expect(leftoverBefore).to.be.gt(0n);
      const amount = leftoverBefore / 2n;
      const ibcBalanceBefore = await ibcVoucher.balanceOf(signer1);

      await expect(ibcVoucher.connect(signer1).spend(amount))
        .to.emit(ibcVoucher, 'RateLimitInflowIncreased')
        .withArgs(leftoverBefore, amount)
        .to.not.emit(ibcVoucher, 'RateLimitUpdated');

      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after spend:', leftoverAfter);

      expect(ibcBalanceBefore - (await ibcVoucher.balanceOf(signer1.address))).to.be.equal(amount);
      expect(leftoverBefore - leftoverAfter).to.be.equal(amount);
    });

    it('spend: can spend all leftover', async function () {
      const leftoverBefore = await ibcVoucher.leftoverAmount();
      await expect(leftoverBefore).to.be.gt(0n);
      const amount = leftoverBefore;
      const ibcBalanceBefore = await ibcVoucher.balanceOf(signer1);

      await expect(ibcVoucher.connect(signer1).spend(amount))
        .to.emit(ibcVoucher, 'RateLimitInflowIncreased')
        .withArgs(leftoverBefore, amount)
        .to.not.emit(ibcVoucher, 'RateLimitUpdated');

      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after spend:', leftoverAfter);

      expect(ibcBalanceBefore - (await ibcVoucher.balanceOf(signer1.address))).to.be.equal(amount);
      expect(leftoverAfter).to.be.equal(0n);
    });

    it('leftover resets by the beginning of new epoch', async function () {
      const rateLimitConfig = await ibcVoucher.rateLimitConfig();
      await time.increaseTo(Number(rateLimitConfig.startTime) + oneHour + 1);
      rateLimit = ((await ibcVoucher.totalSupply()) * rateLimitPercent) / RATIO_MULTIPLIER;

      console.log(await ibcVoucher.leftoverAmount());
      expect(await ibcVoucher.leftoverAmount()).to.be.eq(rateLimit);
    });

    it('first wrap in the epoch resets rate limit', async function () {
      const amount = 1000n;
      const totalSupplyBefore = await ibcVoucher.totalSupply();

      rateLimit = (totalSupplyBefore * rateLimitPercent) / RATIO_MULTIPLIER;
      await expect(ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer2.address, amount, 0))
        .to.emit(ibcVoucher, 'RateLimitOutflowIncreased')
        .withArgs(rateLimit, amount)
        .to.emit(ibcVoucher, 'RateLimitUpdated')
        .withArgs(rateLimit, oneHour, rateLimitPercent);

      const rateLimitConfig = await ibcVoucher.rateLimitConfig();
      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after wrap:', leftoverAfter);

      expect(leftoverAfter).to.be.equal(rateLimit + amount);
      expect(await ibcVoucher.totalSupply()).to.be.eq(totalSupplyBefore + amount);
      expect(rateLimitConfig.supplyAtUpdate).to.be.eq(totalSupplyBefore);
      expect(rateLimitConfig.limit).to.be.eq(rateLimit);
      expect(rateLimitConfig.credit).to.be.eq(rateLimit + amount);
      expect(rateLimitConfig.window).to.be.eq(oneHour);
      expect(rateLimitConfig.epoch).to.be.eq(1n);
      expect(rateLimitConfig.threshold).to.be.eq(rateLimitPercent);
    });

    it('spend: can partially spend leftover', async function () {
      const leftoverBefore = await ibcVoucher.leftoverAmount();
      await expect(leftoverBefore).to.be.gt(0n);
      const ibcBalanceBefore = await ibcVoucher.balanceOf(signer2);
      const amount = ibcBalanceBefore;

      await expect(ibcVoucher.connect(signer2).spend(amount))
        .to.emit(ibcVoucher, 'RateLimitInflowIncreased')
        .withArgs(leftoverBefore, amount)
        .to.not.emit(ibcVoucher, 'RateLimitUpdated');

      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after spend:', leftoverAfter);

      expect(ibcBalanceBefore - (await ibcVoucher.balanceOf(signer2.address))).to.be.equal(amount);
      expect(leftoverBefore - leftoverAfter).to.be.equal(amount);
    });

    it('first spend in the epoch resets rate limit', async function () {
      const rateLimitConfigBefore = await ibcVoucher.rateLimitConfig();
      await time.increaseTo(Number(rateLimitConfigBefore.startTime) + oneHour * 2 + 1);
      const totalSupplyBefore = await ibcVoucher.totalSupply();
      rateLimit = (totalSupplyBefore * rateLimitPercent) / RATIO_MULTIPLIER;

      const amount = rateLimit;

      await expect(ibcVoucher.connect(signer1).spend(amount))
        .to.emit(ibcVoucher, 'RateLimitInflowIncreased')
        .withArgs(rateLimit, amount)
        .to.emit(ibcVoucher, 'RateLimitUpdated')
        .withArgs(rateLimit, oneHour, rateLimitPercent);

      const rateLimitConfig = await ibcVoucher.rateLimitConfig();
      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after spend:', leftoverAfter);

      expect(leftoverAfter).to.be.equal(0n);
      expect(await ibcVoucher.totalSupply()).to.be.eq(totalSupplyBefore - amount);
      expect(rateLimitConfig.supplyAtUpdate).to.be.eq(totalSupplyBefore);
      expect(rateLimitConfig.limit).to.be.eq(rateLimit);
      expect(rateLimitConfig.credit).to.be.eq(rateLimit - amount);
      expect(rateLimitConfig.window).to.be.eq(oneHour);
      expect(rateLimitConfig.epoch).to.be.eq(2n);
      expect(rateLimitConfig.threshold).to.be.eq(rateLimitPercent);
    });

    it('wrap to increase leftover', async function () {
      const amount = 1000n;
      const leftoverBefore = await ibcVoucher.leftoverAmount();
      const totalSupplyBefore = await ibcVoucher.totalSupply();

      await expect(ibcVoucher.connect(relayer)['wrapTo(address,uint256,uint256)'](signer1.address, amount, 0))
        .to.emit(ibcVoucher, 'RateLimitOutflowIncreased')
        .withArgs(leftoverBefore, amount)
        .to.not.emit(ibcVoucher, 'RateLimitUpdated');

      const leftoverAfter = await ibcVoucher.leftoverAmount();
      console.log('Leftover after wrap:', leftoverAfter);

      expect(leftoverAfter - leftoverBefore).to.be.equal(amount);
      expect(await ibcVoucher.totalSupply()).to.be.eq(totalSupplyBefore + amount);
    });

    it('change rate limit threshold', async function () {
      rateLimitPercent = 2000n;
      const totalSupplyBefore = await ibcVoucher.totalSupply();
      rateLimit = (totalSupplyBefore * rateLimitPercent) / RATIO_MULTIPLIER;

      const startTime = await time.latest();
      await expect(ibcVoucher.connect(admin).setRateLimit(rateLimitPercent, oneHour, startTime))
        .to.emit(ibcVoucher, 'RateLimitUpdated')
        .withArgs(rateLimit, oneHour, rateLimitPercent);

      const rateLimitConfig = await ibcVoucher.rateLimitConfig();
      const newLeftover = await ibcVoucher.leftoverAmount();
      console.log('Total supply:', totalSupplyBefore);
      console.log('New leftover:', newLeftover);

      expect(newLeftover).to.be.equal(rateLimit);
      expect(rateLimitConfig.supplyAtUpdate).to.be.eq(totalSupplyBefore);
      expect(rateLimitConfig.limit).to.be.eq(rateLimit);
      expect(rateLimitConfig.credit).to.be.eq(rateLimit);
      expect(rateLimitConfig.startTime).to.be.eq(startTime);
      expect(rateLimitConfig.window).to.be.eq(oneHour);
      expect(rateLimitConfig.epoch).to.be.eq(0n);
      expect(rateLimitConfig.threshold).to.be.eq(rateLimitPercent);
    });

    it('setRateLimit: rejects when start time in the future', async function () {
      await expect(
        ibcVoucher.connect(admin).setRateLimit(rateLimitPercent, oneHour, (await time.latest()) + 100)
      ).to.be.revertedWithCustomError(ibcVoucher, 'FutureStartTime');
    });

    it('setRateLimit: rejects when threshold is beyond 100%', async function () {
      await expect(
        ibcVoucher.connect(admin).setRateLimit(RATIO_MULTIPLIER + 1n, oneHour, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(ibcVoucher, 'InconsistentThreshold');
    });

    it('setRateLimit: rejects when window is less than minimum', async function () {
      await expect(
        ibcVoucher
          .connect(admin)
          .setRateLimit(rateLimitPercent, (await ibcVoucher.MIN_RATE_LIMIT_WINDOW()) - 1n, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(ibcVoucher, 'TooLowWindow');
    });

    it('setRateLimit: rejects when threshold is 0', async function () {
      await expect(
        ibcVoucher.connect(admin).setRateLimit(0n, oneHour, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(ibcVoucher, 'ZeroThreshold');
    });
  });
});
