import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import { calculateStorageSlot, deployContract, getSignersWithPrivateKeys, Signer } from '../helpers';
import type {
  ChainlinkConverter,
  ChainlinkFeedMock,
  DirectConverter,
  WBTCMock,
  MultiAssetWithAsyncRedemptionStrategy,
  RatioFeedMock,
  StakedLBTCConverter,
  StakedLBTCMock,
  TokenMock
} from '../../typechain-types';

describe('MultiAssetWithAsyncRedemptionStrategy (happy path)', function () {
  let admin: Signer;
  let redeemOperator: Signer;
  let user: Signer;
  let treasury: Signer;
  let operator: Signer;

  let underlying: TokenMock;
  let altDeposit: TokenMock;
  let converter: DirectConverter;
  let strategy: MultiAssetWithAsyncRedemptionStrategy;

  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    underlying = await deployContract<TokenMock>('TokenMock', ['Underlying', 'UND', 18], false);
    altDeposit = await deployContract<TokenMock>('TokenMock', ['Alt Deposit', 'ALT', 18], false);

    const convFactory = await ethers.getContractFactory('DirectConverter');
    converter = (await convFactory.deploy()) as DirectConverter;
    await converter.waitForDeployment();

    const factory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const proxy = await deployContract('MultiAssetWithAsyncRedemptionStrategy', [
      'Multi Strategy Shares',
      'mSTRAT',
      await underlying.getAddress(),
      admin.address,
      0
    ]);
    await proxy.waitForDeployment();
    strategy = factory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionStrategy;

    await strategy.connect(admin).grantRole(await strategy.PRICE_SETTER_ROLE(), operator.address);
    await strategy.connect(admin).grantRole(await strategy.PAY_REDEMPTIONS_ROLE(), redeemOperator.address);
    await strategy.connect(admin).grantRole(await strategy.LIMITED_ADMIN_ROLE(), admin.address);

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  it('initializes with expected metadata, asset, and version', async function () {
    expect(await strategy.name()).to.equal('Multi Strategy Shares');
    expect(await strategy.symbol()).to.equal('mSTRAT');
    expect(await strategy.asset()).to.equal(await underlying.getAddress());
    expect(await strategy.version()).to.equal('MultiAssetWithAsyncRedemptionStrategy-0.0.1');
  });

  it('Verify StrategyBaseUpgradeableStorage slot', async function () {
    const base = calculateStorageSlot('lombardfinance.storage.StrategyBaseUpgradeable');
    // pricePerShare (uint256) is at base+2, after the 2-slot EnumerableSet for shards
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), base + 2n);
    expect(storage).to.equal(ethers.toBeHex(10n ** 18n, 32));
  });

  it('Verify MultiAssetDepositStorage slot', async function () {
    await strategy.connect(admin).addDepositAsset(await altDeposit.getAddress(), await converter.getAddress(), 0);
    const base = calculateStorageSlot('lombardfinance.storage.MultiAssetDepositUpgradeable');
    // depositAssets EnumerableSet stores its array length at base+0 (= 1 after adding one asset)
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), base);
    expect(storage).to.equal(ethers.toBeHex(1n, 32));
  });

  it('Verify AsyncRedemptionStorage slot', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);
    const depositAmt = 1000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);
    const shares = await strategy.balanceOf(user.address);
    await strategy.connect(user).requestRedeem(shares, user.address);

    const base = calculateStorageSlot('lombardfinance.storage.AsyncRedemptionUpgradeable');
    // nextRequestId is the third word (totalPendingShares, totalPendingAssets, nextRequestId)
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), base + 2n);
    expect(storage).to.equal(ethers.toBeHex(1n, 32));
  });

  it('Verify FeeManagerStorage slot', async function () {
    const slot = calculateStorageSlot('lombardfinance.storage.FeeManagerUpgradeable');
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), slot);
    // Slot packs managementFeeBps (uint16, 0) | performanceFeeBps (uint16, 0) | lastFeeHarvestAt (uint48, block.timestamp at init)
    const [, , lastHarvest] = await strategy.managementFee();
    const expected = ethers.toBeHex(BigInt(lastHarvest) << 32n, 32);
    expect(storage).to.equal(expected);
  });

  it('lists a deposit asset and records converter + fee', async function () {
    const alt = await altDeposit.getAddress();
    const conv = await converter.getAddress();

    await expect(strategy.connect(admin).addDepositAsset(alt, conv, 0))
      .to.emit(strategy, 'DepositAssetAdded')
      .withArgs(admin.address, alt);

    expect(await strategy.isDepositAsset(alt)).to.be.true;
    expect(await strategy.converterOf(alt)).to.equal(conv);
    expect(await strategy.depositFee(alt)).to.equal(0);
    expect(await strategy.maxDeposit(alt, user.address)).to.equal(ethers.MaxUint256);
    expect(await strategy.maxMint(alt, user.address)).to.equal(ethers.MaxUint256);
  });

  it('deposits alt asset and mints shares (preview matches execution)', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    const preview = await strategy.previewDeposit(alt, assets);
    await expect(strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address))
      .to.emit(strategy, 'Deposit')
      .withArgs(user.address, user.address, alt, assets, preview);

    expect(await strategy.balanceOf(user.address)).to.equal(preview);
    expect(await altDeposit.balanceOf(v)).to.equal(assets);
  });

  it('optional defaultShard forwards net deposit tokens to a registered address', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    const sink = ethers.Wallet.createRandom().address;

    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);
    await strategy.connect(admin).registerShard(sink);
    await expect(strategy.connect(admin).setDefaultShard(sink)).to.emit(strategy, 'DefaultShardSet').withArgs(sink);

    expect(await strategy.defaultShard()).to.equal(sink);

    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address))
      .to.emit(strategy, 'DepositRoutedToDefaultShard')
      .withArgs(sink, alt, assets);

    expect(await altDeposit.balanceOf(sink)).to.equal(assets);
    expect(await altDeposit.balanceOf(v)).to.equal(0n);
  });

  it('setDefaultShard reverts if strategy is not registered', async function () {
    const rogue = ethers.Wallet.createRandom().address;
    await expect(strategy.connect(admin).setDefaultShard(rogue)).to.be.revertedWithCustomError(
      strategy,
      'Strategy_ShardNotRegistered'
    );
  });

  it('defaultShard forwards net only; deposit fee transfers immediately to treasury', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    const sink = ethers.Wallet.createRandom().address;

    const treasuryRole = await strategy.TREASURY_ROLE();
    await strategy.connect(admin).grantRole(treasuryRole, treasury.address);
    await strategy.connect(admin).setFeeTreasury(treasury.address);

    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 100); // 1%
    await strategy.connect(admin).registerShard(sink);
    await strategy.connect(admin).setDefaultShard(sink);

    const assets = 10_000n * 10n ** 18n;
    const fee = (assets * 100n) / 10_000n;
    const net = assets - fee;

    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address))
      .to.emit(strategy, 'DepositRoutedToDefaultShard')
      .withArgs(sink, alt, net);

    expect(await altDeposit.balanceOf(sink)).to.equal(net);
    expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
    expect(await altDeposit.balanceOf(v)).to.equal(0n);
  });

  it('deposit with non-zero fee reverts if fee treasury is unset', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();

    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 100);

    const assets = 1_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address))
      .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_FeeTreasuryNotSet')
      .withArgs(alt);
  });

  it('deregisterShard clears defaultShard when it matches', async function () {
    const sink = ethers.Wallet.createRandom().address;
    await strategy.connect(admin).registerShard(sink);
    await strategy.connect(admin).setDefaultShard(sink);
    await expect(strategy.connect(admin).deregisterShard(sink))
      .to.emit(strategy, 'DefaultShardSet')
      .withArgs(ethers.ZeroAddress);
    expect(await strategy.defaultShard()).to.equal(ethers.ZeroAddress);
  });

  it('mints via mint() using previewMint assets', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const targetShares = 5_000n * 10n ** 18n;
    const assetsNeeded = await strategy.previewMint(alt, targetShares);
    await altDeposit.mint(user.address, assetsNeeded);
    await altDeposit.connect(user).approve(v, assetsNeeded);

    const pulled = await strategy
      .connect(user)
      ['mint(address,uint256,address)'].staticCall(alt, targetShares, user.address);
    expect(pulled).to.equal(assetsNeeded);

    await strategy.connect(user)['mint(address,uint256,address)'](alt, targetShares, user.address);
    expect(await strategy.balanceOf(user.address)).to.equal(targetShares);
  });

  it('convertToShares / convertToAssets round-trip for listed deposit asset', async function () {
    const alt = await altDeposit.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const assets = 1_000n * 10n ** 18n;
    const shares = await strategy.convertToShares(alt, assets);
    const back = await strategy.convertToAssets(alt, shares);
    expect(back).to.equal(assets);
  });

  it('full async redeem: request then operator fulfills with underlying paid out', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();

    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);

    const shares = await strategy.balanceOf(user.address);
    const dec = BigInt(await strategy.decimals());
    const pps = await strategy.pricePerShare();
    // Matches StrategyBase _convertToAssets(shares, Floor)
    const assetsOut = (shares * pps) / 10n ** dec;

    await underlying.mint(v, assetsOut + 1n);

    const beforeU = await underlying.balanceOf(user.address);
    const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
    await strategy.connect(user).requestRedeem(shares, user.address);

    expect(await strategy.balanceOf(user.address)).to.equal(0n);
    expect(await strategy.pendingRedeemRequest(rid)).to.equal(shares);

    await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
      .to.emit(strategy, 'RedeemRequestsFulfilled')
      .withArgs([rid]);

    const afterU = await underlying.balanceOf(user.address);
    expect(afterU - beforeU).to.equal(assetsOut);
  });

  it('fulfillRedeemRequests: reverts when strategy holds no underlying for the redeemed shares', async function () {
    // Deposit alt token — strategy holds altDeposit, NOT underlying.
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 1_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);

    const shares = await strategy.balanceOf(user.address);
    const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
    await strategy.connect(user).requestRedeem(shares, user.address);
    expect(await strategy.balanceOf(user.address)).to.equal(0n); // shares already burned

    // Strategy holds no underlying — fulfillment must revert (transfer fails).
    await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid])).to.be.reverted;
  });

  it('harvestPerformanceFee: mints fee shares without automatically adjusting pricePerShare', async function () {
    const treasuryRole = await strategy.TREASURY_ROLE();
    await strategy.connect(admin).grantRole(treasuryRole, treasury.address);

    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);

    await strategy.connect(admin).setPerformanceFeeBps(1000, treasury.address, true); // 10%

    // Raise pps +10% via soft post (default bucket has no capacity — drains, applies NAV, pauses).
    const priceManagerRole = await strategy.PRICE_SETTER_ROLE();
    await strategy.connect(admin).grantRole(priceManagerRole, admin.address);
    const pps0 = await strategy.pricePerShare();
    await strategy.connect(admin).postPricePerShare((pps0 * 11n) / 10n, false);
    await strategy.connect(admin).unpauseStrategyOperations();

    const supplyBefore = await strategy.totalSupply();
    const ppsBefore = await strategy.pricePerShare();

    await strategy.connect(treasury).harvestPerformanceFee(treasury.address);

    expect(await strategy.totalSupply()).to.be.gt(supplyBefore); // fee shares minted
    // pricePerShare is unchanged — operator must post a lower value to correct NAV.
    expect(await strategy.pricePerShare()).to.equal(ppsBefore);
  });

  it('treasury can update deposit fee bps', async function () {
    const alt = await altDeposit.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const treasuryRole = await strategy.TREASURY_ROLE();
    await strategy.connect(admin).grantRole(treasuryRole, treasury.address);

    await expect(strategy.connect(admin).setFeeTreasury(treasury.address))
      .to.emit(strategy, 'FeeTreasurySet')
      .withArgs(treasury.address);

    await expect(strategy.connect(admin).setDepositFeeBps(alt, 10))
      .to.emit(strategy, 'DepositFeeBpsSet')
      .withArgs(alt, 10);
    expect(await strategy.depositFee(alt)).to.equal(10);
    expect(await strategy.feeTreasury()).to.equal(treasury.address);
  });

  it('admin can swap asset converter for a listed deposit asset', async function () {
    const alt = await altDeposit.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const convFactory = await ethers.getContractFactory('DirectConverter');
    const next = (await convFactory.deploy()) as DirectConverter;
    await next.waitForDeployment();
    const nextAddr = await next.getAddress();

    await expect(strategy.connect(admin).setAssetConverter(alt, nextAddr))
      .to.emit(strategy, 'DepositAssetConverterSet')
      .withArgs(alt, nextAddr);
    expect(await strategy.converterOf(alt)).to.equal(nextAddr);
  });

  describe('price-per-share rate limit', function () {
    it('2.5% yearly allowed change with weekly bucket', async function () {
      // 2.5%/yr = 2_5000 bps/yr ÷ 52 weeks ≈ 500 bps/week
      const maxBps = 500;
      const weekSeconds = 604800n;
      // refillRate fills the full bucket in exactly one week: ceil(maxBps * 2^32 / weekSeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await strategy.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      // +0.05% (500 bps) — consumes the entire weekly budget
      const p1 = (p0 * 10005n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p1, true)).to.emit(strategy, 'PricePerShareUpdated');
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);

      // Any further move is blocked until the bucket refills
      await expect(strategy.connect(operator).postPricePerShare(p1 + 1n, true)).to.be.revertedWithCustomError(
        strategy,
        'PriceRateLimiter_RateLimitExceeded'
      );

      // After one week the bucket is full again
      await ethers.provider.send('evm_increaseTime', [604800]);
      await ethers.provider.send('evm_mine', []);

      const p2 = (p1 * 10005n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p2, true)).to.emit(strategy, 'PricePerShareUpdated');
    });

    it('soft overflow: applies price, drains bucket, and pauses strategy', async function () {
      const maxBps = 500;
      const weekSeconds = 604800n;
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await strategy.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      const p1 = (p0 * 10005n) / 10000n;
      await strategy.connect(operator).postPricePerShare(p1, true);

      const tinyBump = p1 + 1n;
      await expect(strategy.connect(operator).postPricePerShare(tinyBump, false)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect(await strategy.strategyOperationsPaused()).to.be.true;
      expect(await strategy.pricePerShare()).to.equal(tinyBump);
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);
    });

    it('50% yearly allowed change with daily bucket', async function () {
      // 50%/yr = 500000 bps/yr ÷ 365 days ≈ 1400 bps/day
      const maxBps = 1400;
      const daySeconds = 86400n;
      // refillRate fills the full bucket in exactly one day: ceil(maxBps * 2^32 / daySeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + daySeconds - 1n) / daySeconds;

      await strategy.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      // +0.13% (1300 bps) — within daily budget, leaving 100 bps
      const p1 = (p0 * 10013n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p1, true)).to.emit(strategy, 'PricePerShareUpdated');
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(100n);

      // 2 bps exceeds the 1 bps remaining in the bucket
      const p2 = (p1 * 10002n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p2, true)).to.be.revertedWithCustomError(
        strategy,
        'PriceRateLimiter_RateLimitExceeded'
      );

      // After one day the bucket is full again
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);

      const p3 = (p1 * 10013n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p3, true)).to.emit(strategy, 'PricePerShareUpdated');
    });
  });
});

describe('StakedLBTC as deposit token', function () {
  // All amounts in 8-decimal satoshi units (1 LBTC = 1e8).
  const ONE_LBTC = 10n ** 8n;
  const ONE_ETHER = 10n ** 18n; // oracle ratio scale

  let admin: Signer;
  let strategyDeployer: Signer;
  let redeemOperator: Signer;
  let treasury: Signer;
  let operator: Signer;
  let user: Signer;

  let lbtcUnderlying: WBTCMock;
  let stakedToken: StakedLBTCMock;
  let oracle: RatioFeedMock;
  let stakedConverter: StakedLBTCConverter;
  let stakedStrategy: MultiAssetWithAsyncRedemptionStrategy;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    const wbtcFactory = await ethers.getContractFactory('WBTCMock');
    const wbtcProxy = await deployContract('WBTCMock', [], true, { initializer: 'initialize' });
    lbtcUnderlying = wbtcFactory.attach(await wbtcProxy.getAddress()) as WBTCMock;

    stakedToken = await deployContract<StakedLBTCMock>('StakedLBTCMock', [treasury.address, admin.address, 0], true, {
      initializer: 'initialize',
      unsafeAllow: ['missing-initializer', 'missing-initializer-call']
    });

    const oracleFactory = await ethers.getContractFactory('RatioFeedMock');
    oracle = (await oracleFactory.deploy()) as RatioFeedMock;
    await oracle.waitForDeployment();

    const convFactory = await ethers.getContractFactory('StakedLBTCConverter');
    stakedConverter = (await convFactory.deploy(await oracle.getAddress())) as StakedLBTCConverter;
    await stakedConverter.waitForDeployment();

    stakedStrategy = await deployContract<MultiAssetWithAsyncRedemptionStrategy>(
      'MultiAssetWithAsyncRedemptionStrategy',
      ['Lombard BTC Strategy', 'LBTCSTR', await lbtcUnderlying.getAddress(), admin.address, 0]
    );

    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.PRICE_SETTER_ROLE(), operator.address);
    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.PAY_REDEMPTIONS_ROLE(), redeemOperator.address);
    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.LIMITED_ADMIN_ROLE(), admin.address);
    await stakedStrategy
      .connect(admin)
      .addDepositAsset(await stakedToken.getAddress(), await stakedConverter.getAddress(), 0);

    snap = await takeSnapshot();
  });

  beforeEach(async function () {
    await snap.restore();
  });

  describe('StakedLBTCConverter', function () {
    it('at-par ratio (1e18): toBaseUnits and fromBaseUnits are 1:1', async function () {
      expect(await stakedConverter.toBaseUnits(ONE_LBTC, 0)).to.equal(ONE_LBTC);
      expect(await stakedConverter.fromBaseUnits(ONE_LBTC, 1)).to.equal(ONE_LBTC);
    });

    it('yield-accrued ratio (0.9e18): 1 stakedLBTC converts to more base units', async function () {
      // Each stakedLBTC is worth 1/0.9 ≈ 1.1111 LBTC when ratio = 0.9e18.
      await oracle.setRatio((ONE_ETHER * 9n) / 10n);

      // 1e8 * 1e18 / 0.9e18 = 111_111_111.111… → floor → 111_111_111
      expect(await stakedConverter.toBaseUnits(ONE_LBTC, 0)).to.equal(111_111_111n);

      // Inverse: 111_111_111 * 0.9e18 / 1e18 = 99_999_999.9 → ceil → 100_000_000
      expect(await stakedConverter.fromBaseUnits(111_111_111n, 1)).to.equal(ONE_LBTC);
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) differs from x by at most 1 satoshi', async function () {
      const amounts = [ONE_LBTC / 2n, ONE_LBTC, ONE_LBTC * 100n];
      const ratios = [ONE_ETHER, (ONE_ETHER * 9n) / 10n, (ONE_ETHER * 95n) / 100n];

      for (const ratio of ratios) {
        await oracle.setRatio(ratio);
        for (const amt of amounts) {
          const btcOut = await stakedConverter.toBaseUnits(amt, 0);
          const tokenOut = await stakedConverter.fromBaseUnits(btcOut, 1);
          // Ceil in fromBaseUnits means tokenOut >= amt, but by at most 1 satoshi.
          expect(tokenOut).to.be.gte(amt);
          expect(tokenOut - amt).to.be.lte(1n);
        }
      }
    });
  });

  describe('strategy deposit / mint integration', function () {
    it('at-par: deposit 1 stakedLBTC mints 1 share', async function () {
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedStrategy.getAddress();

      await stakedToken.mintTo(user.address, ONE_LBTC);
      await stakedToken.connect(user).approve(vAddr, ONE_LBTC);

      const preview = await stakedStrategy.previewDeposit(sAddr, ONE_LBTC);
      await expect(stakedStrategy.connect(user)['deposit(address,uint256,address)'](sAddr, ONE_LBTC, user.address))
        .to.emit(stakedStrategy, 'Deposit')
        .withArgs(user.address, user.address, sAddr, ONE_LBTC, preview);

      expect(await stakedStrategy.balanceOf(user.address)).to.equal(ONE_LBTC);
      expect(preview).to.equal(ONE_LBTC);
    });

    it('yield-accrued: 0.9 stakedLBTC deposits as 1 share at ratio 0.9e18', async function () {
      await oracle.setRatio((ONE_ETHER * 9n) / 10n);

      const depositAmt = (ONE_LBTC * 9n) / 10n; // 0.9 stakedLBTC = 90_000_000 satoshi
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedStrategy.getAddress();

      await stakedToken.mintTo(user.address, depositAmt);
      await stakedToken.connect(user).approve(vAddr, depositAmt);

      const preview = await stakedStrategy.previewDeposit(sAddr, depositAmt);
      await stakedStrategy.connect(user)['deposit(address,uint256,address)'](sAddr, depositAmt, user.address);

      // 0.9 stakedLBTC * (1e18 / 0.9e18) = 1 LBTC worth → 1 share at pps=1e8
      expect(preview).to.equal(ONE_LBTC);
      expect(await stakedStrategy.balanceOf(user.address)).to.equal(ONE_LBTC);
    });

    it('mint path: previewMint returns fewer stakedLBTC needed when yield-accrued', async function () {
      await oracle.setRatio((ONE_ETHER * 9n) / 10n);

      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedStrategy.getAddress();
      const targetShares = ONE_LBTC;
      const assetsNeeded = await stakedStrategy.previewMint(sAddr, targetShares);

      // 1 share requires 1 LBTC BTC unit → toTokenAmount(1e8) = 1e8 * 0.9e18 / 1e18 = 90_000_000
      expect(assetsNeeded).to.equal(90_000_000n);

      await stakedToken.mintTo(user.address, assetsNeeded);
      await stakedToken.connect(user).approve(vAddr, assetsNeeded);

      const pulled = await stakedStrategy
        .connect(user)
        ['mint(address,uint256,address)'].staticCall(sAddr, targetShares, user.address);
      expect(pulled).to.equal(assetsNeeded);

      await stakedStrategy.connect(user)['mint(address,uint256,address)'](sAddr, targetShares, user.address);
      expect(await stakedStrategy.balanceOf(user.address)).to.equal(targetShares);
    });

    it('deposit fee transfers to treasury in stakedLBTC; net amount drives share calculation', async function () {
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedStrategy.getAddress();

      const treasuryRole = await stakedStrategy.TREASURY_ROLE();
      await stakedStrategy.connect(admin).grantRole(treasuryRole, treasury.address);
      await stakedStrategy.connect(admin).setFeeTreasury(treasury.address);
      await stakedStrategy.connect(admin).setDepositFeeBps(sAddr, 100); // 1%

      const depositAmt = ONE_LBTC;
      const expectedFee = (depositAmt * 100n) / 10_000n; // floor: 1_000_000
      const net = depositAmt - expectedFee; // 99_000_000

      await stakedToken.mintTo(user.address, depositAmt);
      await stakedToken.connect(user).approve(vAddr, depositAmt);

      await stakedStrategy.connect(user)['deposit(address,uint256,address)'](sAddr, depositAmt, user.address);

      expect(await stakedToken.balanceOf(treasury.address)).to.equal(expectedFee);
      // Net amount converts to BTC units at 1:1 (at-par ratio) → net shares minted
      expect(await stakedStrategy.balanceOf(user.address)).to.equal(net);
    });

    it('convertToShares / convertToAssets round-trip at yield-accrued ratio', async function () {
      await oracle.setRatio((ONE_ETHER * 95n) / 100n); // 0.95e18

      const sAddr = await stakedToken.getAddress();
      const assets = 5n * ONE_LBTC;
      const shares = await stakedStrategy.convertToShares(sAddr, assets);
      const back = await stakedStrategy.convertToAssets(sAddr, shares);

      // back may differ from assets by at most 1 satoshi due to rounding
      expect(back).to.be.gte(assets);
      expect(back - assets).to.be.lte(1n);
    });
  });
});

describe('Chainlink as deposit token', function () {
  // All amounts in 8-decimal satoshi units (1 BTC = 1e8).
  const ONE_BTC = 10n ** 8n;
  const HEARTBEAT = 3600n; // 1 hour

  let admin: Signer;
  let strategyDeployer: Signer;
  let redeemOperator: Signer;
  let operator: Signer;
  let user: Signer;

  let depositToken: WBTCMock;
  let clFeed: ChainlinkFeedMock;
  let clConverter: ChainlinkConverter;
  let clStrategy: MultiAssetWithAsyncRedemptionStrategy;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, , , redeemOperator, user, , operator] = await getSignersWithPrivateKeys();

    const wbtcFactory = await ethers.getContractFactory('WBTCMock');
    const wbtcProxy = await deployContract('WBTCMock', [], true, { initializer: 'initialize' });
    depositToken = wbtcFactory.attach(await wbtcProxy.getAddress()) as WBTCMock;

    // 8-decimal feed, answer = 1e8 (peg: 1 token = 1 BTC)
    const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
    clFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
    await clFeed.waitForDeployment();

    const convFactory = await ethers.getContractFactory('ChainlinkConverter');
    clConverter = (await convFactory.deploy(
      await clFeed.getAddress(),
      8,
      8,
      HEARTBEAT,
      ethers.ZeroAddress,
      0
    )) as ChainlinkConverter;
    await clConverter.waitForDeployment();

    const strategyFactory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const proxy = await deployContract(
      'MultiAssetWithAsyncRedemptionStrategy',
      ['Chainlink BTC Strategy', 'clSTRAT', await depositToken.getAddress(), admin.address, 0],
      true
    );
    await proxy.waitForDeployment();
    clStrategy = strategyFactory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionStrategy;

    await clStrategy.connect(admin).grantRole(await clStrategy.PRICE_SETTER_ROLE(), operator.address);
    await clStrategy.connect(admin).grantRole(await clStrategy.PAY_REDEMPTIONS_ROLE(), redeemOperator.address);
    await clStrategy.connect(admin).grantRole(await clStrategy.LIMITED_ADMIN_ROLE(), admin.address);
    await clStrategy.connect(admin).addDepositAsset(await depositToken.getAddress(), await clConverter.getAddress(), 0);

    snap = await takeSnapshot();
  });

  beforeEach(async function () {
    await snap.restore();
  });

  describe('ChainlinkConverter', function () {
    it('peg (answer=1e8, 8-dec feed): toBaseUnits and fromBaseUnits are 1:1', async function () {
      expect(await clConverter.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      expect(await clConverter.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_BTC);
    });

    it('non-peg (answer=1.111…e18, 18-dec feed): converts correctly', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // 18-dec feed, answer = 111_111_111 * 1e10 so that 1e8 token → 111_111_111 BTC units
      const feed18 = (await feedFactory.deploy(18, 111_111_111n * 10n ** 10n)) as ChainlinkFeedMock;
      await feed18.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      const conv18 = (await convFactory.deploy(
        await feed18.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0
      )) as ChainlinkConverter;
      await conv18.waitForDeployment();

      // scalingFactor = 10^(18+8-8) = 1e18
      // btcOut = 1e8 * 111_111_111e10 / 1e18 = 111_111_111
      expect(await conv18.toBaseUnits(ONE_BTC, 0)).to.equal(111_111_111n);
      // tokenOut = 111_111_111 * 1e18 / 111_111_111e10 = 1e8 (exact)
      expect(await conv18.fromBaseUnits(111_111_111n, 1)).to.equal(ONE_BTC);
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) differs from x by at most 1 satoshi', async function () {
      const answers = [ONE_BTC, ONE_BTC + ONE_BTC / 10n, (ONE_BTC * 95n) / 100n];
      const amounts = [ONE_BTC / 2n, ONE_BTC, ONE_BTC * 100n];

      for (const answer of answers) {
        await clFeed.setAnswer(answer);
        for (const amt of amounts) {
          const btcOut = await clConverter.toBaseUnits(amt, 0);
          const tokenOut = await clConverter.fromBaseUnits(btcOut, 1);
          expect(tokenOut).to.be.gte(amt);
          expect(tokenOut - amt).to.be.lte(1n);
        }
      }
    });

    it('stale answer reverts with StaleAnswer', async function () {
      const block = await ethers.provider.getBlock('latest');
      await clFeed.setUpdatedAt(BigInt(block!.timestamp) - HEARTBEAT - 1n);
      await expect(clConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverter_StaleAnswer'
      );
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverter_StaleAnswer'
      );
    });

    it('zero answer reverts with InvalidAnswer', async function () {
      await clFeed.setAnswer(0);
      await expect(clConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverter_InvalidAnswer'
      );
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverter_InvalidAnswer'
      );
    });

    describe('sequencer uptime check', function () {
      const GRACE_PERIOD = 3600n;
      let seqFeed: ChainlinkFeedMock;
      let seqConverter: ChainlinkConverter;

      beforeEach(async function () {
        const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
        // answer=0 → sequencer up; startedAt = far in the past so grace period has elapsed
        seqFeed = (await feedFactory.deploy(8, 0)) as ChainlinkFeedMock;
        await seqFeed.waitForDeployment();
        const block = await ethers.provider.getBlock('latest');
        await seqFeed.setStartedAt(BigInt(block!.timestamp) - GRACE_PERIOD - 1n);

        const convFactory = await ethers.getContractFactory('ChainlinkConverter');
        seqConverter = (await convFactory.deploy(
          await clFeed.getAddress(),
          8,
          8,
          HEARTBEAT,
          await seqFeed.getAddress(),
          GRACE_PERIOD
        )) as ChainlinkConverter;
        await seqConverter.waitForDeployment();
      });

      it('sequencer up and past grace period: converts normally', async function () {
        expect(await seqConverter.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      });

      it('sequencer down (answer=1): reverts with SequencerDown', async function () {
        await seqFeed.setAnswer(1);
        await expect(seqConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverter_SequencerDown'
        );
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverter_SequencerDown'
        );
      });

      it('sequencer just recovered (within grace period): reverts with GracePeriodNotOver', async function () {
        const block = await ethers.provider.getBlock('latest');
        await seqFeed.setStartedAt(BigInt(block!.timestamp)); // just came back up
        await expect(seqConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverter_GracePeriodNotOver'
        );
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverter_GracePeriodNotOver'
        );
      });

      it('no sequencer feed (address(0)): skips check and converts normally', async function () {
        // clConverter has sequencerUptimeFeed = address(0); should still work regardless
        expect(await clConverter.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      });
    });
  });

  describe('strategy deposit / mint integration', function () {
    it('at-par: deposit 1 depositToken mints 1 share', async function () {
      const tAddr = await depositToken.getAddress();
      const vAddr = await clStrategy.getAddress();

      await depositToken.mint(user.address, ONE_BTC);
      await depositToken.connect(user).approve(vAddr, ONE_BTC);

      const preview = await clStrategy.previewDeposit(tAddr, ONE_BTC);
      await expect(clStrategy.connect(user)['deposit(address,uint256,address)'](tAddr, ONE_BTC, user.address))
        .to.emit(clStrategy, 'Deposit')
        .withArgs(user.address, user.address, tAddr, ONE_BTC, preview);

      expect(preview).to.equal(ONE_BTC);
      expect(await clStrategy.balanceOf(user.address)).to.equal(ONE_BTC);
    });

    it('mint path: previewMint at non-peg answer returns correct token amount', async function () {
      // answer = 0.9e8 → 1 token = 0.9 BTC → toTokenAmount(1e8) = mulDiv(1e8, 1e8, 0.9e8, Ceil) = 111_111_112
      await clFeed.setAnswer((ONE_BTC * 9n) / 10n);

      const tAddr = await depositToken.getAddress();
      const vAddr = await clStrategy.getAddress();
      const targetShares = ONE_BTC;
      const assetsNeeded = await clStrategy.previewMint(tAddr, targetShares);
      expect(assetsNeeded).to.equal(111_111_112n);

      await depositToken.mint(user.address, assetsNeeded);
      await depositToken.connect(user).approve(vAddr, assetsNeeded);

      await clStrategy.connect(user)['mint(address,uint256,address)'](tAddr, targetShares, user.address);
      expect(await clStrategy.balanceOf(user.address)).to.equal(targetShares);
    });

    it('convertToShares / convertToAssets round-trip at non-peg answer', async function () {
      await clFeed.setAnswer((ONE_BTC * 95n) / 100n); // 0.95e8

      const tAddr = await depositToken.getAddress();
      const assets = 5n * ONE_BTC;
      const shares = await clStrategy.convertToShares(tAddr, assets);
      const back = await clStrategy.convertToAssets(tAddr, shares);

      expect(back).to.be.gte(assets);
      expect(back - assets).to.be.lte(1n);
    });
  });
});
