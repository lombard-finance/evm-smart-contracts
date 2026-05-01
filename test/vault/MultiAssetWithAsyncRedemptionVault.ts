import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import { calculateStorageSlot, getSignersWithPrivateKeys, Signer } from '../helpers';
import type {
  ChainlinkConverter,
  ChainlinkFeedMock,
  DirectConverter,
  MockVaultToken,
  WBTCMock,
  MultiAssetWithAsyncRedemptionVault,
  RatioFeedMock,
  StakedLBTCConverter,
  StakedLBTCMock
} from '../../typechain-types';

const ERC7540_ASYNC_REDEEM = '0x620ee8e4';
const ERC7540_OPERATORS = '0xe3bc4e65';

describe('MultiAssetWithAsyncRedemptionVault (happy path)', function () {
  let admin: Signer;
  let strategyDeployer: Signer;
  let controllerManager: Signer;
  let redeemController: Signer;
  let redeemOperator: Signer;
  let user: Signer;
  let treasury: Signer;
  let operator: Signer;

  let underlying: MockVaultToken;
  let altDeposit: MockVaultToken;
  let converter: DirectConverter;
  let vault: MultiAssetWithAsyncRedemptionVault;

  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, controllerManager, redeemController, redeemOperator, user, treasury, operator] =
      await getSignersWithPrivateKeys();

    const tokenFactory = await ethers.getContractFactory('MockVaultToken');
    underlying = (await tokenFactory.deploy()) as MockVaultToken;
    altDeposit = (await tokenFactory.deploy()) as MockVaultToken;
    await underlying.waitForDeployment();
    await altDeposit.waitForDeployment();

    const convFactory = await ethers.getContractFactory('DirectConverter');
    converter = (await convFactory.deploy()) as DirectConverter;
    await converter.waitForDeployment();

    const factory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionVault');
    const proxy = await upgrades.deployProxy(
      factory,
      [
        'Multi Vault Shares',
        'mVAULT',
        await underlying.getAddress(),
        admin.address,
        0,
        controllerManager.address,
        strategyDeployer.address
      ],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await proxy.waitForDeployment();
    vault = factory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionVault;

    await vault.connect(admin).grantRole(await vault.OPERATOR_ROLE(), operator.address);

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  it('initializes with expected metadata, asset, and version', async function () {
    expect(await vault.name()).to.equal('Multi Vault Shares');
    expect(await vault.symbol()).to.equal('mVAULT');
    expect(await vault.asset()).to.equal(await underlying.getAddress());
    expect(await vault.version()).to.equal('MultiAssetWithAsyncRedemptionVault-0.0.1');
  });

  it('Verify VaultBaseUpgradeableStorage slot', async function () {
    const base = calculateStorageSlot('lombardfinance.storage.VaultBaseUpgradeable');
    // pricePerShare (uint256) is at base+2, after the 2-slot EnumerableSet for strategies
    const storage = await ethers.provider.getStorage(await vault.getAddress(), base + 2n);
    expect(storage).to.equal(ethers.toBeHex(10n ** 18n, 32));
  });

  it('Verify MultiAssetDepositStorage slot', async function () {
    await vault.connect(admin).addDepositAsset(await altDeposit.getAddress(), await converter.getAddress(), 0);
    const base = calculateStorageSlot('lombardfinance.storage.MultiAssetDepositUpgradeable');
    // depositAssets EnumerableSet stores its array length at base+0 (= 1 after adding one asset)
    const storage = await ethers.provider.getStorage(await vault.getAddress(), base);
    expect(storage).to.equal(ethers.toBeHex(1n, 32));
  });

  it('Verify ERC7540RedemptionStorage slot', async function () {
    await vault.connect(controllerManager).registerRedeemController(redeemController.address, ethers.MaxUint256);
    const base = calculateStorageSlot('lombardfinance.storage.ERC7540RedemptionUpgradeable');
    // controllers EnumerableSet length is at base+2, after 2 mapping slots (pendingShares, pendingAssets)
    const storage = await ethers.provider.getStorage(await vault.getAddress(), base + 2n);
    expect(storage).to.equal(ethers.toBeHex(1n, 32));
  });

  it('Verify FeeManagerStorage slot', async function () {
    const slot = calculateStorageSlot('lombardfinance.storage.FeeManagerUpgradeable');
    const storage = await ethers.provider.getStorage(await vault.getAddress(), slot);
    // Slot packs managementFeeBps (uint16, 0) | performanceFeeBps (uint16, 0) | lastFeeHarvestAt (uint48, block.timestamp at init)
    const lastHarvest = await vault.lastFeeHarvestAt();
    const expected = ethers.toBeHex(BigInt(lastHarvest) << 32n, 32);
    expect(storage).to.equal(expected);
  });

  it('advertises ERC-7540 and operator interface ids', async function () {
    expect(await vault.supportsInterface(ERC7540_ASYNC_REDEEM)).to.be.true;
    expect(await vault.supportsInterface(ERC7540_OPERATORS)).to.be.true;
  });

  it('lists a deposit asset and records converter + fee', async function () {
    const alt = await altDeposit.getAddress();
    const conv = await converter.getAddress();

    await expect(vault.connect(admin).addDepositAsset(alt, conv, 0))
      .to.emit(vault, 'DepositAssetAdded')
      .withArgs(admin.address, alt);

    expect(await vault.isDepositAsset(alt)).to.be.true;
    expect(await vault.converterOf(alt)).to.equal(conv);
    expect(await vault.depositFeeBps(alt)).to.equal(0);
    expect(await vault.maxDeposit(alt, user.address)).to.equal(ethers.MaxUint256);
    expect(await vault.maxMint(alt, user.address)).to.equal(ethers.MaxUint256);
  });

  it('deposits alt asset and mints shares (preview matches execution)', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    const preview = await vault.previewDeposit(alt, assets);
    await expect(vault.connect(user).deposit(alt, assets, user.address))
      .to.emit(vault, 'Deposit')
      .withArgs(user.address, user.address, alt, assets, preview);

    expect(await vault.balanceOf(user.address)).to.equal(preview);
    expect(await altDeposit.balanceOf(v)).to.equal(assets);
  });

  it('optional defaultStrategy forwards net deposit tokens to a registered address', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    const sink = ethers.Wallet.createRandom().address;

    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);
    await vault.connect(strategyDeployer).registerStrategy(sink);
    await expect(vault.connect(admin).setDefaultStrategy(sink)).to.emit(vault, 'DefaultStrategySet').withArgs(sink);

    expect(await vault.defaultStrategy()).to.equal(sink);

    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(vault.connect(user).deposit(alt, assets, user.address))
      .to.emit(vault, 'DepositRoutedToDefaultStrategy')
      .withArgs(sink, alt, assets);

    expect(await altDeposit.balanceOf(sink)).to.equal(assets);
    expect(await altDeposit.balanceOf(v)).to.equal(0n);
  });

  it('setDefaultStrategy reverts if strategy is not registered', async function () {
    const rogue = ethers.Wallet.createRandom().address;
    await expect(vault.connect(admin).setDefaultStrategy(rogue)).to.be.revertedWithCustomError(
      vault,
      'Vault_StrategyNotRegistered'
    );
  });

  it('defaultStrategy forwards net only; deposit fee transfers immediately to treasury', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    const sink = ethers.Wallet.createRandom().address;

    const wfRole = await vault.WITHDRAWAL_FEE_MANAGER_ROLE();
    await vault.connect(admin).grantRole(wfRole, treasury.address);
    await vault.connect(treasury).setWithdrawalTreasury(treasury.address);

    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 100); // 1%
    await vault.connect(strategyDeployer).registerStrategy(sink);
    await vault.connect(admin).setDefaultStrategy(sink);

    const assets = 10_000n * 10n ** 18n;
    const fee = (assets * 100n) / 10_000n;
    const net = assets - fee;

    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(vault.connect(user).deposit(alt, assets, user.address))
      .to.emit(vault, 'DepositRoutedToDefaultStrategy')
      .withArgs(sink, alt, net);

    expect(await altDeposit.balanceOf(sink)).to.equal(net);
    expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
    expect(await altDeposit.balanceOf(v)).to.equal(0n);
  });

  it('deposit with non-zero fee reverts if deposit treasury is unset', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();

    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 100);

    const assets = 1_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    await expect(vault.connect(user).deposit(alt, assets, user.address)).to.be.revertedWithCustomError(
      vault,
      'VaultDeposit_DepositTreasuryNotSet'
    );
  });

  it('deregisterStrategy clears defaultStrategy when it matches', async function () {
    const sink = ethers.Wallet.createRandom().address;
    await vault.connect(strategyDeployer).registerStrategy(sink);
    await vault.connect(admin).setDefaultStrategy(sink);
    await expect(vault.connect(strategyDeployer).deregisterStrategy(sink))
      .to.emit(vault, 'DefaultStrategySet')
      .withArgs(ethers.ZeroAddress);
    expect(await vault.defaultStrategy()).to.equal(ethers.ZeroAddress);
  });

  it('mints via mint() using previewMint assets', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const targetShares = 5_000n * 10n ** 18n;
    const assetsNeeded = await vault.previewMint(alt, targetShares);
    await altDeposit.mint(user.address, assetsNeeded);
    await altDeposit.connect(user).approve(v, assetsNeeded);

    const pulled = await vault.connect(user).mint.staticCall(alt, targetShares, user.address);
    expect(pulled).to.equal(assetsNeeded);

    await vault.connect(user).mint(alt, targetShares, user.address);
    expect(await vault.balanceOf(user.address)).to.equal(targetShares);
  });

  it('convertToShares / convertToAssets round-trip for listed deposit asset', async function () {
    const alt = await altDeposit.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const assets = 1_000n * 10n ** 18n;
    const shares = await vault.convertToShares(alt, assets);
    const back = await vault.convertToAssets(alt, shares);
    expect(back).to.equal(assets);
  });

  it('full async redeem: request then operator fulfills with underlying paid out', async function () {
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();

    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await vault.connect(user).deposit(alt, depositAmt, user.address);

    const shares = await vault.balanceOf(user.address);
    const dec = BigInt(await vault.decimals());
    const pps = await vault.pricePerShare();
    // Matches VaultBase _convertToAssets(shares, Floor)
    const assetsOut = (shares * pps) / 10n ** dec;

    await underlying.mint(v, assetsOut + 1n);

    await vault.connect(controllerManager).registerRedeemController(redeemController.address, ethers.MaxUint256);
    await vault.connect(redeemController).setOperator(redeemOperator.address, true);
    expect(await vault.isOperator(redeemController.address, redeemOperator.address)).to.be.true;

    const beforeU = await underlying.balanceOf(user.address);
    const rid = await vault.connect(user).requestRedeem.staticCall(shares, redeemController.address, user.address);
    await vault.connect(user).requestRedeem(shares, redeemController.address, user.address);

    expect(await vault.balanceOf(user.address)).to.equal(0n);
    expect(await vault.pendingRedeemRequest(rid, redeemController.address)).to.equal(shares);

    await expect(vault.connect(redeemOperator).fulfillRedeemRequests([rid]))
      .to.emit(vault, 'RedeemRequestsFulfilled')
      .withArgs([rid]);

    const afterU = await underlying.balanceOf(user.address);
    expect(afterU - beforeU).to.equal(assetsOut);
  });

  it('fulfillRedeemRequests: reverts when vault holds no underlying for the redeemed shares', async function () {
    // Deposit alt token — vault holds altDeposit, NOT underlying.
    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 1_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await vault.connect(user).deposit(alt, depositAmt, user.address);

    const shares = await vault.balanceOf(user.address);
    await vault.connect(controllerManager).registerRedeemController(redeemController.address, ethers.MaxUint256);
    await vault.connect(redeemController).setOperator(redeemOperator.address, true);

    const rid = await vault.connect(user).requestRedeem.staticCall(shares, redeemController.address, user.address);
    await vault.connect(user).requestRedeem(shares, redeemController.address, user.address);
    expect(await vault.balanceOf(user.address)).to.equal(0n); // shares already burned

    // Vault holds no underlying — fulfillment must revert (transfer fails).
    await expect(vault.connect(redeemOperator).fulfillRedeemRequests([rid])).to.be.reverted;
  });

  it('harvestPerformanceFee: mints fee shares without automatically adjusting pricePerShare', async function () {
    const treasuryRole = await vault.TREASURY_ROLE();
    await vault.connect(admin).grantRole(treasuryRole, treasury.address);

    const alt = await altDeposit.getAddress();
    const v = await vault.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const depositAmt = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await vault.connect(user).deposit(alt, depositAmt, user.address);

    await vault.connect(treasury).setPerformanceFeeBps(1000); // 10%

    // Raise pps +10% via guardian (guardian call forces a vault pause).
    const ppsGuardianRole = await vault.PRICE_PER_SHARE_GUARDIAN_ROLE();
    await vault.connect(admin).grantRole(ppsGuardianRole, admin.address);
    const pps0 = await vault.pricePerShare();
    await vault.connect(admin).forcePostPricePerShare((pps0 * 11n) / 10n);
    await vault.connect(admin).unpauseVaultOperations();

    const supplyBefore = await vault.totalSupply();
    const ppsBefore = await vault.pricePerShare();

    await vault.connect(treasury).harvestPerformanceFee(treasury.address);

    expect(await vault.totalSupply()).to.be.gt(supplyBefore); // fee shares minted
    // pricePerShare is unchanged — operator must post a lower value to correct NAV.
    expect(await vault.pricePerShare()).to.equal(ppsBefore);
  });

  it('controller manager can set max redeem per controller', async function () {
    await vault.connect(controllerManager).registerRedeemController(redeemController.address, 1000n);
    expect(await vault.maxControllerRedeem(redeemController.address)).to.equal(1000n);

    await vault.connect(controllerManager).setMaxControllerRedeem(redeemController.address, 2000n);
    expect(await vault.maxControllerRedeem(redeemController.address)).to.equal(2000n);
  });

  it('treasury can update deposit fee bps', async function () {
    const alt = await altDeposit.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const treasuryRole = await vault.TREASURY_ROLE();
    await vault.connect(admin).grantRole(treasuryRole, treasury.address);

    const wfRole = await vault.WITHDRAWAL_FEE_MANAGER_ROLE();
    await vault.connect(admin).grantRole(wfRole, treasury.address);

    await expect(vault.connect(treasury).setWithdrawalTreasury(treasury.address))
      .to.emit(vault, 'WithdrawalTreasurySet')
      .withArgs(treasury.address);

    await expect(vault.connect(treasury).setDepositFeeBps(alt, 10))
      .to.emit(vault, 'DepositFeeBpsSet')
      .withArgs(alt, 10);
    expect(await vault.depositFeeBps(alt)).to.equal(10);
    expect(await vault.getWithdrawalTreasury()).to.equal(treasury.address);
  });

  it('admin can swap asset converter for a listed deposit asset', async function () {
    const alt = await altDeposit.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const convFactory = await ethers.getContractFactory('DirectConverter');
    const next = (await convFactory.deploy()) as DirectConverter;
    await next.waitForDeployment();
    const nextAddr = await next.getAddress();

    await expect(vault.connect(admin).setAssetConverter(alt, nextAddr))
      .to.emit(vault, 'DepositAssetConverterSet')
      .withArgs(alt, nextAddr);
    expect(await vault.converterOf(alt)).to.equal(nextAddr);
  });

  describe('price-per-share rate limit', function () {
    it('2.5% yearly allowed change with weekly bucket', async function () {
      // 2.5%/yr = 2_5000 bps/yr ÷ 52 weeks ≈ 500 bps/week
      const maxBps = 500;
      const weekSeconds = 604800n;
      // refillRate fills the full bucket in exactly one week: ceil(maxBps * 2^32 / weekSeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await vault.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await vault.pricePerShare();
      // +0.05% (500 bps) — consumes the entire weekly budget
      const p1 = (p0 * 10005n) / 10000n;
      await expect(vault.connect(operator).postPricePerShare(p1)).to.emit(vault, 'PricePerShareUpdated');
      expect((await vault.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);

      // Any further move is blocked until the bucket refills
      await expect(vault.connect(operator).postPricePerShare(p1 + 1n)).to.be.revertedWithCustomError(
        vault,
        'PriceRateLimiter_RateLimitExceeded'
      );

      // After one week the bucket is full again
      await ethers.provider.send('evm_increaseTime', [604800]);
      await ethers.provider.send('evm_mine', []);

      const p2 = (p1 * 10005n) / 10000n;
      await expect(vault.connect(operator).postPricePerShare(p2)).to.emit(vault, 'PricePerShareUpdated');
    });

    it('50% yearly allowed change with daily bucket', async function () {
      // 50%/yr = 500000 bps/yr ÷ 365 days ≈ 1400 bps/day
      const maxBps = 1400;
      const daySeconds = 86400n;
      // refillRate fills the full bucket in exactly one day: ceil(maxBps * 2^32 / daySeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + daySeconds - 1n) / daySeconds;

      await vault.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await vault.pricePerShare();
      // +0.13% (1300 bps) — within daily budget, leaving 100 bps
      const p1 = (p0 * 10013n) / 10000n;
      await expect(vault.connect(operator).postPricePerShare(p1)).to.emit(vault, 'PricePerShareUpdated');
      expect((await vault.pricePerShareRateLimiterState()).capacityBps).to.equal(100n);

      // 2 bps exceeds the 1 bps remaining in the bucket
      const p2 = (p1 * 10002n) / 10000n;
      await expect(vault.connect(operator).postPricePerShare(p2)).to.be.revertedWithCustomError(
        vault,
        'PriceRateLimiter_RateLimitExceeded'
      );

      // After one day the bucket is full again
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);

      const p3 = (p1 * 10013n) / 10000n;
      await expect(vault.connect(operator).postPricePerShare(p3)).to.emit(vault, 'PricePerShareUpdated');
    });
  });
});

describe('StakedLBTC as deposit token', function () {
  // All amounts in 8-decimal satoshi units (1 LBTC = 1e8).
  const ONE_LBTC = 10n ** 8n;
  const ONE_ETHER = 10n ** 18n; // oracle ratio scale

  let admin: Signer;
  let strategyDeployer: Signer;
  let controllerManager: Signer;
  let treasury: Signer;
  let operator: Signer;
  let user: Signer;

  let lbtcUnderlying: WBTCMock;
  let stakedToken: StakedLBTCMock;
  let oracle: RatioFeedMock;
  let stakedConverter: StakedLBTCConverter;
  let stakedVault: MultiAssetWithAsyncRedemptionVault;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, controllerManager, , , user, treasury, operator] = await getSignersWithPrivateKeys();

    const wbtcFactory = await ethers.getContractFactory('WBTCMock');
    const wbtcProxy = await upgrades.deployProxy(wbtcFactory, [], {
      initializer: 'initialize',
      unsafeAllow: ['constructor']
    });
    await wbtcProxy.waitForDeployment();
    lbtcUnderlying = wbtcFactory.attach(await wbtcProxy.getAddress()) as WBTCMock;

    const stakedFactory = await ethers.getContractFactory('StakedLBTCMock');
    const stakedProxy = await upgrades.deployProxy(stakedFactory, [treasury.address, admin.address, 0], {
      initializer: 'initialize',
      unsafeAllow: ['constructor', 'missing-initializer', 'missing-initializer-call']
    });
    await stakedProxy.waitForDeployment();
    stakedToken = stakedFactory.attach(await stakedProxy.getAddress()) as StakedLBTCMock;

    const oracleFactory = await ethers.getContractFactory('RatioFeedMock');
    oracle = (await oracleFactory.deploy()) as RatioFeedMock;
    await oracle.waitForDeployment();

    const convFactory = await ethers.getContractFactory('StakedLBTCConverter');
    stakedConverter = (await convFactory.deploy(await oracle.getAddress())) as StakedLBTCConverter;
    await stakedConverter.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionVault');
    const proxy = await upgrades.deployProxy(
      vaultFactory,
      [
        'Lombard BTC Vault',
        'LBTCV',
        await lbtcUnderlying.getAddress(),
        admin.address,
        0,
        controllerManager.address,
        strategyDeployer.address
      ],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await proxy.waitForDeployment();
    stakedVault = vaultFactory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionVault;

    await stakedVault.connect(admin).grantRole(await stakedVault.OPERATOR_ROLE(), operator.address);
    await stakedVault
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

  describe('vault deposit / mint integration', function () {
    it('at-par: deposit 1 stakedLBTC mints 1 share', async function () {
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedVault.getAddress();

      await stakedToken.mintTo(user.address, ONE_LBTC);
      await stakedToken.connect(user).approve(vAddr, ONE_LBTC);

      const preview = await stakedVault.previewDeposit(sAddr, ONE_LBTC);
      await expect(stakedVault.connect(user).deposit(sAddr, ONE_LBTC, user.address))
        .to.emit(stakedVault, 'Deposit')
        .withArgs(user.address, user.address, sAddr, ONE_LBTC, preview);

      expect(await stakedVault.balanceOf(user.address)).to.equal(ONE_LBTC);
      expect(preview).to.equal(ONE_LBTC);
    });

    it('yield-accrued: 0.9 stakedLBTC deposits as 1 share at ratio 0.9e18', async function () {
      await oracle.setRatio((ONE_ETHER * 9n) / 10n);

      const depositAmt = (ONE_LBTC * 9n) / 10n; // 0.9 stakedLBTC = 90_000_000 satoshi
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedVault.getAddress();

      await stakedToken.mintTo(user.address, depositAmt);
      await stakedToken.connect(user).approve(vAddr, depositAmt);

      const preview = await stakedVault.previewDeposit(sAddr, depositAmt);
      await stakedVault.connect(user).deposit(sAddr, depositAmt, user.address);

      // 0.9 stakedLBTC * (1e18 / 0.9e18) = 1 LBTC worth → 1 share at pps=1e8
      expect(preview).to.equal(ONE_LBTC);
      expect(await stakedVault.balanceOf(user.address)).to.equal(ONE_LBTC);
    });

    it('mint path: previewMint returns fewer stakedLBTC needed when yield-accrued', async function () {
      await oracle.setRatio((ONE_ETHER * 9n) / 10n);

      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedVault.getAddress();
      const targetShares = ONE_LBTC;
      const assetsNeeded = await stakedVault.previewMint(sAddr, targetShares);

      // 1 share requires 1 LBTC BTC unit → toTokenAmount(1e8) = 1e8 * 0.9e18 / 1e18 = 90_000_000
      expect(assetsNeeded).to.equal(90_000_000n);

      await stakedToken.mintTo(user.address, assetsNeeded);
      await stakedToken.connect(user).approve(vAddr, assetsNeeded);

      const pulled = await stakedVault.connect(user).mint.staticCall(sAddr, targetShares, user.address);
      expect(pulled).to.equal(assetsNeeded);

      await stakedVault.connect(user).mint(sAddr, targetShares, user.address);
      expect(await stakedVault.balanceOf(user.address)).to.equal(targetShares);
    });

    it('deposit fee transfers to treasury in stakedLBTC; net amount drives share calculation', async function () {
      const sAddr = await stakedToken.getAddress();
      const vAddr = await stakedVault.getAddress();

      const treasuryRole = await stakedVault.TREASURY_ROLE();
      await stakedVault.connect(admin).grantRole(treasuryRole, treasury.address);
      const wfRole = await stakedVault.WITHDRAWAL_FEE_MANAGER_ROLE();
      await stakedVault.connect(admin).grantRole(wfRole, treasury.address);
      await stakedVault.connect(treasury).setWithdrawalTreasury(treasury.address);
      await stakedVault.connect(treasury).setDepositFeeBps(sAddr, 100); // 1%

      const depositAmt = ONE_LBTC;
      const expectedFee = (depositAmt * 100n) / 10_000n; // floor: 1_000_000
      const net = depositAmt - expectedFee; // 99_000_000

      await stakedToken.mintTo(user.address, depositAmt);
      await stakedToken.connect(user).approve(vAddr, depositAmt);

      await stakedVault.connect(user).deposit(sAddr, depositAmt, user.address);

      expect(await stakedToken.balanceOf(treasury.address)).to.equal(expectedFee);
      // Net amount converts to BTC units at 1:1 (at-par ratio) → net shares minted
      expect(await stakedVault.balanceOf(user.address)).to.equal(net);
    });

    it('convertToShares / convertToAssets round-trip at yield-accrued ratio', async function () {
      await oracle.setRatio((ONE_ETHER * 95n) / 100n); // 0.95e18

      const sAddr = await stakedToken.getAddress();
      const assets = 5n * ONE_LBTC;
      const shares = await stakedVault.convertToShares(sAddr, assets);
      const back = await stakedVault.convertToAssets(sAddr, shares);

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
  let controllerManager: Signer;
  let operator: Signer;
  let user: Signer;

  let depositToken: WBTCMock;
  let clFeed: ChainlinkFeedMock;
  let clConverter: ChainlinkConverter;
  let clVault: MultiAssetWithAsyncRedemptionVault;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, controllerManager, , , user, , operator] = await getSignersWithPrivateKeys();

    const wbtcFactory = await ethers.getContractFactory('WBTCMock');
    const wbtcProxy = await upgrades.deployProxy(wbtcFactory, [], {
      initializer: 'initialize',
      unsafeAllow: ['constructor']
    });
    await wbtcProxy.waitForDeployment();
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

    const vaultFactory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionVault');
    const proxy = await upgrades.deployProxy(
      vaultFactory,
      [
        'Chainlink BTC Vault',
        'clVAULT',
        await depositToken.getAddress(),
        admin.address,
        0,
        controllerManager.address,
        strategyDeployer.address
      ],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await proxy.waitForDeployment();
    clVault = vaultFactory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionVault;

    await clVault.connect(admin).grantRole(await clVault.OPERATOR_ROLE(), operator.address);
    await clVault.connect(admin).addDepositAsset(await depositToken.getAddress(), await clConverter.getAddress(), 0);

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

  describe('vault deposit / mint integration', function () {
    it('at-par: deposit 1 depositToken mints 1 share', async function () {
      const tAddr = await depositToken.getAddress();
      const vAddr = await clVault.getAddress();

      await depositToken.mint(user.address, ONE_BTC);
      await depositToken.connect(user).approve(vAddr, ONE_BTC);

      const preview = await clVault.previewDeposit(tAddr, ONE_BTC);
      await expect(clVault.connect(user).deposit(tAddr, ONE_BTC, user.address))
        .to.emit(clVault, 'Deposit')
        .withArgs(user.address, user.address, tAddr, ONE_BTC, preview);

      expect(preview).to.equal(ONE_BTC);
      expect(await clVault.balanceOf(user.address)).to.equal(ONE_BTC);
    });

    it('mint path: previewMint at non-peg answer returns correct token amount', async function () {
      // answer = 0.9e8 → 1 token = 0.9 BTC → toTokenAmount(1e8) = mulDiv(1e8, 1e8, 0.9e8, Ceil) = 111_111_112
      await clFeed.setAnswer((ONE_BTC * 9n) / 10n);

      const tAddr = await depositToken.getAddress();
      const vAddr = await clVault.getAddress();
      const targetShares = ONE_BTC;
      const assetsNeeded = await clVault.previewMint(tAddr, targetShares);
      expect(assetsNeeded).to.equal(111_111_112n);

      await depositToken.mint(user.address, assetsNeeded);
      await depositToken.connect(user).approve(vAddr, assetsNeeded);

      await clVault.connect(user).mint(tAddr, targetShares, user.address);
      expect(await clVault.balanceOf(user.address)).to.equal(targetShares);
    });

    it('convertToShares / convertToAssets round-trip at non-peg answer', async function () {
      await clFeed.setAnswer((ONE_BTC * 95n) / 100n); // 0.95e8

      const tAddr = await depositToken.getAddress();
      const assets = 5n * ONE_BTC;
      const shares = await clVault.convertToShares(tAddr, assets);
      const back = await clVault.convertToAssets(tAddr, shares);

      expect(back).to.be.gte(assets);
      expect(back - assets).to.be.lte(1n);
    });
  });
});
