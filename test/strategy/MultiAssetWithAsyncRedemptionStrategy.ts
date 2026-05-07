import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import {
  Addressable,
  calculateStorageSlot,
  deployContract,
  e18,
  getSignersWithPrivateKeys,
  randomBigInt,
  Signer
} from '../helpers';
import type {
  ChainlinkCompositeConverter,
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
import { randomBytes } from 'ethers';
import { bigint } from 'hardhat/internal/core/params/argumentTypes';

describe('MultiAssetWithAsyncRedemptionStrategy (happy path)', function () {
  let admin: Signer;
  let redeemOperator: Signer;
  let user: Signer;
  let treasury: Signer;
  let operator: Signer;

  let underlying: TokenMock & Addressable;
  let altDeposit: TokenMock & Addressable;
  let directConverter: DirectConverter & Addressable;
  let strategy: MultiAssetWithAsyncRedemptionStrategy & Addressable;

  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    underlying = (await deployContract<TokenMock>('TokenMock', ['Underlying', 'UND', 18], false)) as TokenMock &
      Addressable;
    underlying.address = await underlying.getAddress();
    altDeposit = (await deployContract<TokenMock>('TokenMock', ['Alt Deposit', 'ALT', 18], false)) as TokenMock &
      Addressable;
    altDeposit.address = await altDeposit.getAddress();

    directConverter = (await deployContract<DirectConverter>('DirectConverter', [], false)) as DirectConverter &
      Addressable;
    directConverter.address = await directConverter.getAddress();

    strategy = (await deployContract<MultiAssetWithAsyncRedemptionStrategy>(
      'MultiAssetWithAsyncRedemptionStrategy',
      ['Multi Strategy Shares', 'mSTRAT', underlying.address, admin.address, 0],
      true
    )) as MultiAssetWithAsyncRedemptionStrategy & Addressable;
    strategy.address = await strategy.getAddress();

    await strategy.connect(admin).grantRole(await strategy.PRICE_SETTER_ROLE(), operator.address);
    await strategy.connect(admin).grantRole(await strategy.PAY_REDEMPTIONS_ROLE(), redeemOperator.address);
    await strategy.connect(admin).grantRole(await strategy.MANAGER_ROLE(), admin.address);

    snapshot = await takeSnapshot();
  });

  beforeEach(async function () {
    await snapshot.restore();
  });

  it('initializes with expected metadata, asset, and version', async function () {
    expect(await strategy.name()).to.equal('Multi Strategy Shares');
    expect(await strategy.symbol()).to.equal('mSTRAT');
    expect(await strategy.asset()).to.equal(underlying.address);
    expect(await strategy.version()).to.equal('MultiAssetWithAsyncRedemptionStrategy-0.0.1');
  });

  it('Verify StrategyBaseUpgradeableStorage slot', async function () {
    const base = calculateStorageSlot('lombardfinance.storage.StrategyBaseUpgradeable');
    // pricePerShare (uint256) is at base+2, after the 2-slot EnumerableSet for shards
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), base + 2n);
    expect(storage).to.equal(ethers.toBeHex(e18, 32));
  });

  it('Verify MultiAssetDepositStorage slot', async function () {
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
    const base = calculateStorageSlot('lombardfinance.storage.MultiAssetDepositUpgradeable');
    // depositAssets EnumerableSet stores its array length at base+0 (= 1 after adding one asset)
    const storage = await ethers.provider.getStorage(await strategy.getAddress(), base);
    expect(storage).to.equal(ethers.toBeHex(1n, 32));
  });

  it('Verify AsyncRedemptionStorage slot', async function () {
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
    const depositAmt = 1000n * e18;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(strategy.address, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);
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

  it('optional defaultShard forwards net deposit tokens to a registered address', async function () {
    const sink = ethers.Wallet.createRandom().address;

    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
    await strategy.connect(admin).registerShard(sink);
    await expect(strategy.connect(admin).setDefaultShard(sink)).to.emit(strategy, 'DefaultShardSet').withArgs(sink);

    expect(await strategy.defaultShard()).to.equal(sink);

    const assets = 10_000n * e18;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(strategy.address, assets);

    await expect(strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, assets, user.address))
      .to.emit(strategy, 'DepositRoutedToDefaultShard')
      .withArgs(sink, altDeposit.address, assets);

    expect(await altDeposit.balanceOf(sink)).to.equal(assets);
    expect(await altDeposit.balanceOf(strategy.address)).to.equal(0n);
  });

  it('setDefaultShard reverts if strategy is not registered', async function () {
    const rogue = ethers.Wallet.createRandom().address;
    await expect(strategy.connect(admin).setDefaultShard(rogue)).to.be.revertedWithCustomError(
      strategy,
      'Strategy_ShardNotRegistered'
    );
  });

  it('lists a deposit asset and records converter + fee', async function () {
    const depositFeeBps = randomBigInt(3);
    // prettier-ignore
    await expect(strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, depositFeeBps))
      .to.emit(strategy, 'DepositAssetAdded')
      .withArgs(admin.address, altDeposit.address)
      .and
      .to.emit(strategy, 'DepositFeeBpsSet')
      .withArgs(altDeposit.address, depositFeeBps);

    expect(await strategy.isDepositAsset(altDeposit.address)).to.be.true;
    expect(await strategy.converterOf(altDeposit.address)).to.equal(directConverter.address);
    expect(await strategy.depositFee(altDeposit.address)).to.equal(depositFeeBps);
    expect(await strategy.maxDeposit(altDeposit.address, user.address)).to.equal(ethers.MaxUint256);
    expect(await strategy.maxMint(altDeposit.address, user.address)).to.equal(ethers.MaxUint256);
  });

  describe('Deposit different amount of assets', function () {
    const args = [
      {
        name: 'amount is >> 0 and fee is 0',
        assets: randomBigInt(21),
        depositFeeBps: 0n
      },
      {
        name: 'amount is >> 0 and fee is max',
        assets: randomBigInt(21),
        depositFeeBps: 9999n
      },
      {
        name: 'amount is >> 0 and fee is > 0',
        assets: randomBigInt(21),
        depositFeeBps: randomBigInt(2)
      },
      {
        name: 'amount = 11111 and fee is 7000',
        assets: 11111n,
        depositFeeBps: 7000n
      },
      {
        name: 'amount = 11111 and fee is 5000',
        assets: 11111n,
        depositFeeBps: 5000n
      },
      {
        name: 'amount = 19999 and fee is 1',
        assets: 19999n,
        depositFeeBps: 1n
      },
      {
        name: 'amount = 10000 and fee is 1',
        assets: 10000n,
        depositFeeBps: 1n
      },
      {
        name: 'amount = 9999 and fee is 1',
        assets: 9999n,
        depositFeeBps: 1n
      },
      {
        name: 'amount < 10000n and fee is 1',
        assets: randomBigInt(4),
        depositFeeBps: 1n
      },
      {
        name: 'amount = 1000 and fee is 10',
        assets: 1000n,
        depositFeeBps: 10n
      },
      {
        name: 'amount = 99 and fee is 100',
        assets: 99n,
        depositFeeBps: 100n
      },
      {
        name: 'amount is 1 and fee is 1',
        assets: 1n,
        depositFeeBps: 1n
      }
    ];

    const rows: { assets: number; feeBps: number; fee: number; net: number }[] = [];

    args.forEach(arg => {
      it(`preview and deposit ${arg.name}`, async function () {
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, arg.depositFeeBps);
        const treasuryRole = await strategy.TREASURY_ROLE();
        await strategy.connect(admin).grantRole(treasuryRole, treasury.address);
        await strategy.connect(admin).setFeeTreasury(treasury.address);

        const assets = arg.assets;
        await altDeposit.mint(user.address, assets);
        await altDeposit.connect(user).approve(strategy.address, assets);

        const fee = (assets * arg.depositFeeBps) / 10_000n;
        const net = assets - fee;

        const previewShares = await strategy.previewDeposit(altDeposit.address, assets);
        // prettier-ignore
        await expect(strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, assets, user.address))
          .to.emit(strategy, 'Deposit')
          .withArgs(user.address, user.address, altDeposit.address, assets, previewShares);

        expect(await strategy.balanceOf(user.address)).to.equal(previewShares);
        expect(await strategy.convertToShares(altDeposit.address, net)).to.equal(previewShares);
        expect(await altDeposit.balanceOf(strategy.address)).to.equal(net);
        expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);

        rows.push({
          assets: Number(assets),
          feeBps: Number(arg.depositFeeBps),
          fee: Number(fee),
          net: Number(net)
        });
      });
    });

    after(function () {
      console.table(rows);
    });
  });

  it('defaultShard forwards net only; deposit fee transfers immediately to treasury', async function () {
    const sink = ethers.Wallet.createRandom().address;

    await strategy.connect(admin).setFeeTreasury(treasury.address);

    const depositFeeBps = 100n; // 1%
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, depositFeeBps);
    await strategy.connect(admin).registerShard(sink);
    await strategy.connect(admin).setDefaultShard(sink);

    const assets = 10_000n * e18;
    const fee = (assets * depositFeeBps) / 10_000n;
    const net = assets - fee;

    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(strategy.address, assets);

    // prettier-ignore
    await expect(strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, assets, user.address))
      .to.emit(strategy, 'DepositRoutedToDefaultShard')
      .withArgs(sink, altDeposit.address, net)
      .and
      .to.emit(strategy, 'DepositFeeTransferred')
      .withArgs(altDeposit.address, treasury.address, fee);

    expect(await altDeposit.balanceOf(sink)).to.equal(net);
    expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
    expect(await altDeposit.balanceOf(strategy.address)).to.equal(0n);
  });

  it('deposit with non-zero fee reverts if fee treasury is unset', async function () {
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 100);

    const assets = 1_000n * e18;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(strategy.address, assets);

    await expect(strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, assets, user.address))
      .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_FeeTreasuryNotSet')
      .withArgs(altDeposit.address);
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
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

    const targetShares = 5_000n * e18;
    const assetsNeeded = await strategy.previewMint(altDeposit.address, targetShares);
    await altDeposit.mint(user.address, assetsNeeded);
    await altDeposit.connect(user).approve(strategy.address, assetsNeeded);

    const pulled = await strategy
      .connect(user)
      ['mint(address,uint256,address)'].staticCall(altDeposit.address, targetShares, user.address);
    expect(pulled).to.equal(assetsNeeded);

    await strategy.connect(user)['mint(address,uint256,address)'](altDeposit.address, targetShares, user.address);
    expect(await strategy.balanceOf(user.address)).to.equal(targetShares);
  });

  describe('Convert assets <> shares', function () {
    const args = [
      {
        name: 'pps = 1eth, amount = 1eth',
        pps: e18,
        amount: e18
      },
      {
        name: 'pps = 1eth, amount = 1wei',
        pps: e18,
        amount: 1n
      },
      {
        name: 'pps = 2eth, amount = 11wei',
        pps: 2n * e18,
        amount: 11n
      },
      {
        name: 'pps = 0.5eth, amount = 11wei',
        pps: e18 / 2n,
        amount: 11n
      },
      {
        name: 'pps = 1eth+1, amount = 1eth ',
        pps: e18 + 1n,
        amount: e18
      },
      {
        name: 'pps = 1eth+10, amount = 1eth ',
        pps: e18 + 10n,
        amount: e18
      },
      {
        name: 'pps = 1eth+100, amount = 1eth ',
        pps: e18 + 100n,
        amount: e18
      },
      {
        name: 'pps = 1.1eth, amount = 1eth ',
        pps: (e18 * 11n) / 10n,
        amount: e18
      }
    ];

    const rows: { pps: string; shares: string; assets: string }[] = [];

    args.forEach(arg => {
      let row: { pps: string; shares: string; assets: string } = {
        pps: arg.pps.toString(),
        shares: '',
        assets: ''
      };
      it(`convertToShares ${arg.name}`, async () => {
        const priceManagerRole = await strategy.PRICE_SETTER_ROLE();
        await strategy.connect(admin).grantRole(priceManagerRole, admin.address);
        await strategy.connect(admin).postPricePerShare(arg.pps, false);

        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const amount = arg.amount;
        const sharesExpected = (amount * e18) / arg.pps;
        const shares = await strategy.convertToShares(altDeposit.address, amount);
        row.shares = shares.toString();
        expect(shares).to.equal(sharesExpected);
      });

      it(`convertToAssets ${arg.name}`, async () => {
        const priceManagerRole = await strategy.PRICE_SETTER_ROLE();
        await strategy.connect(admin).grantRole(priceManagerRole, admin.address);
        await strategy.connect(admin).postPricePerShare(arg.pps, false);

        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const amount = arg.amount;
        const expectedAssets = (amount * arg.pps) / e18;
        const assets = await strategy.convertToAssets(altDeposit.address, amount);
        row.assets = assets.toString();
        expect(assets).to.equal(expectedAssets);
      });

      it(`requestRedeem ${arg.name}`, async () => {
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const priceManagerRole = await strategy.PRICE_SETTER_ROLE();
        await strategy.connect(admin).grantRole(priceManagerRole, admin.address);
        await strategy.connect(admin).postPricePerShare(arg.pps, false);
        if (await strategy.strategyOperationsPaused()) {
          await strategy.connect(admin).unpauseStrategyOperations();
        }

        const depositAmt = arg.amount;
        await altDeposit.mint(user.address, depositAmt);
        await altDeposit.connect(user).approve(strategy.address, depositAmt);
        await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

        const shares = await strategy.balanceOf(user);
        const sharesExpected = (depositAmt * e18) / arg.pps;
        expect(shares).to.equal(sharesExpected);

        const expectedAssets = (shares * arg.pps) / e18;
        const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
        const tx = await strategy.connect(user).requestRedeem(shares, user.address);

        await expect(tx).to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, user.address, user.address, expectedAssets, shares);
        await expect(tx).to.changeTokenBalance(strategy, user, -shares);
        expect(await strategy.pendingRedeemRequest(rid)).to.equal(shares);

        const balanceBefore = await underlying.balanceOf(user.address);
        await underlying.mint(strategy.address, expectedAssets);
        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
          .to.emit(strategy, 'RedeemRequestsFulfilled')
          .withArgs([rid]);
        const balanceAfter = await underlying.balanceOf(user.address);
        expect(balanceAfter - balanceBefore).to.equal(expectedAssets);
      });

      rows.push(row);
    });

    after(function () {
      console.table(rows);
    });
  });

  describe('requestRedeem', function () {
    const args = [
      {
        name: 'amount = 11wei, fee = 5000',
        redeemShares: 11n,
        redeemFee: 5000n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = e18, no fee',
        redeemShares: e18,
        redeemFee: 0n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = e18, fee = 1',
        redeemShares: e18,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = 10001, fee = 1',
        redeemShares: 10001n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = 10000, fee = 1',
        redeemShares: 10000n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = 9999, fee = 1',
        redeemShares: 9999n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      },
      {
        name: 'amount = rnd(10^18), fee = rnd(999)',
        redeemShares: randomBigInt(17),
        redeemFee: randomBigInt(3),
        expectedRedeemAmount: (amount: bigint, fee: bigint) => amount - (amount * fee) / 10000n
      }
    ];

    const rows: { redeemShares: number; feeBps: number; fee: number; net: number }[] = [];

    args.forEach(arg => {
      it(`${arg.name}`, async function () {
        const treasuryRole = await strategy.TREASURY_ROLE();
        await strategy.connect(admin).grantRole(treasuryRole, treasury.address);
        await strategy.connect(admin).setFeeTreasury(treasury.address);
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const redeemFee = arg.redeemFee;
        await strategy.connect(admin).setWithdrawalFeeBps(redeemFee);
        expect(await strategy.withdrawalFee()).to.be.equal(redeemFee);

        const depositAmt = e18;
        await altDeposit.mint(user.address, depositAmt);
        await altDeposit.connect(user).approve(strategy.address, depositAmt);
        await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

        // Shares to asset conversion is omitted as the default pps = 1:1 => underlying = shares;
        const shares = arg.redeemShares;
        const expectedRedeemAmount = arg.expectedRedeemAmount(shares, redeemFee);
        const expectedFee = shares - expectedRedeemAmount;

        await underlying.mint(strategy.address, shares + 1n);
        const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
        const tx = await strategy.connect(user).requestRedeem(shares, user.address);


        await expect(tx).to.changeTokenBalance(strategy, user, -shares);
        if (expectedFee > 0) {
          await expect(tx).to.emit(strategy, 'WithdrawalFeeCharged').withArgs(treasury.address, expectedFee);
        }
        await expect(tx).to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, user.address, user.address, expectedRedeemAmount, shares);


        expect(await underlying.balanceOf(user.address)).to.equal(0n);
        expect(await strategy.pendingRedeemRequest(rid)).to.equal(expectedRedeemAmount);

        const balanceBefore = await underlying.balanceOf(user.address);
        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
          .to.emit(strategy, 'Redeem')
          .withArgs(redeemOperator.address, user.address, expectedRedeemAmount, shares)
          .and
      .to.emit(strategy, 'RedeemRequestsFulfilled')
          .withArgs([rid]);
        const balanceAfter = await underlying.balanceOf(user.address);
        expect(balanceAfter - balanceBefore).to.equal(expectedRedeemAmount);

        rows.push({
          redeemShares: Number(shares),
          feeBps: Number(redeemFee),
          fee: Number(expectedFee),
          net: Number(expectedRedeemAmount)
        });
      });
    });

    after(function () {
      console.table(rows);
    });
  });

  it('fulfillRedeemRequests: reverts when strategy holds no underlying for the redeemed shares', async function () {
    // Deposit alt token — strategy holds altDeposit, NOT underlying.
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

    const depositAmt = 1_000n * e18;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(strategy.address, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

    const shares = await strategy.balanceOf(user.address);
    const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
    await strategy.connect(user).requestRedeem(shares, user.address);
    expect(await strategy.balanceOf(user.address)).to.equal(0n); // shares already burned

    // Strategy holds no underlying — fulfillment must revert (transfer fails).
    await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid])).to.be.reverted;
  });

  describe('harvestPerformanceFee at different pps', function () {
    const args = [
      {
        name: 'pps increased by 1wei and fee is 99.99%',
        supply: e18,
        performanceFeeBps: 9999n,
        newRate: (pps: bigint): bigint => pps + 1n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 3wei and fee is 50%',
        supply: e18,
        performanceFeeBps: 5000n,
        newRate: (pps: bigint): bigint => pps + 3n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 10% and fee is 10%',
        supply: e18,
        performanceFeeBps: 1000n,
        newRate: (pps: bigint): bigint => (pps * 110n) / 100n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },

      {
        name: 'pps increased by 10% and fee is 0.01%',
        supply: e18,
        performanceFeeBps: 1n,
        newRate: (pps: bigint): bigint => (pps * 110n) / 100n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 19999wei and fee is 0.01%',
        supply: e18,
        performanceFeeBps: 1n,
        newRate: (pps: bigint): bigint => pps + 19999n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 10000wei and fee is 0.01%',
        supply: e18,
        performanceFeeBps: 1n,
        newRate: (pps: bigint): bigint => pps + 10000n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 9999wei and fee is 0.01%',
        supply: e18,
        performanceFeeBps: 1n,
        newRate: (pps: bigint): bigint => pps + 9999n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by 1wei and fee is 0.01%',
        supply: e18,
        performanceFeeBps: 1n,
        newRate: (pps: bigint): bigint => pps + 1n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'pps increased by rnd(10^9) and fee is rnd(100)',
        supply: e18,
        performanceFeeBps: randomBigInt(2),
        newRate: (pps: bigint): bigint => pps + randomBigInt(9),
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => {
          return (((supply * (ppsNew - pps)) / pps) * fee) / 10000n;
        }
      },
      {
        name: 'no mint when fee is 0',
        supply: e18,
        performanceFeeBps: 0n,
        newRate: (pps: bigint): bigint => pps + randomBigInt(9),
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => 0n
      },
      {
        name: 'no mint when pps didnt change',
        supply: e18,
        performanceFeeBps: randomBigInt(2),
        newRate: (pps: bigint): bigint => pps,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => 0n
      },
      {
        name: 'no mint when pps decreased',
        supply: e18,
        performanceFeeBps: randomBigInt(2),
        newRate: (pps: bigint): bigint => pps - 1n,
        expectedShares: (supply: bigint, pps: bigint, ppsNew: bigint, fee: bigint): bigint => 0n
      }
    ];

    const rows: { name: string; rateDiff: number; fee: number; mintedShares: number }[] = [];

    args.forEach((arg, i) => {
      it(`${arg.name}`, async function () {
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

        // const treasuryRole = await strategy.TREASURY_ROLE();
        // await strategy.connect(admin).grantRole(treasuryRole, treasury.address);
        const perfFeeClaimRole = await strategy.PERF_FEE_CLAIM_ROLE();
        await strategy.connect(admin).grantRole(perfFeeClaimRole, treasury.address);

        const priceManagerRole = await strategy.PRICE_SETTER_ROLE();
        await strategy.connect(admin).grantRole(priceManagerRole, admin.address);

        const performanceFeeBps = arg.performanceFeeBps;
        await strategy.connect(admin).setPerformanceFeeBps(performanceFeeBps, treasury.address, true);

        const depositAmt = arg.supply;
        await altDeposit.mint(user.address, depositAmt);
        await altDeposit.connect(user).approve(strategy.address, depositAmt);
        await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

        // Raise pps +10% via soft post (default bucket has no capacity — drains, applies NAV, pauses).
        const defaultRate = await strategy.pricePerShare();
        const newRate = arg.newRate(defaultRate);
        await strategy.connect(admin).postPricePerShare(newRate, false);
        if (await strategy.strategyOperationsPaused()) {
          await strategy.connect(admin).unpauseStrategyOperations();
        }

        const supplyBefore = await strategy.totalSupply();
        const expectedShares = arg.expectedShares(supplyBefore, defaultRate, newRate, performanceFeeBps);
        const tx = await strategy.connect(treasury).harvestPerformanceFee(treasury.address);

        const supplyAfter = await strategy.totalSupply();
        rows.push({
          name: arg.name,
          rateDiff: Number(newRate - defaultRate),
          fee: Number(performanceFeeBps),
          mintedShares: Number(supplyAfter - supplyBefore)
        });

        if (expectedShares > 0n) {
          await expect(tx)
            .to.emit(strategy, 'PerformanceFeeHarvested')
            .withArgs(treasury.address, expectedShares, defaultRate, newRate);
        } else {
          await expect(tx).to.not.emit(strategy, 'PerformanceFeeHarvested');
        }
        expect(supplyAfter - supplyBefore).to.be.eq(expectedShares); // fee shares minted
        expect(await strategy.pricePerShare()).to.equal(newRate);

        // repeat harvest
        await strategy.connect(treasury).harvestPerformanceFee(treasury.address);
        expect(await strategy.totalSupply()).to.be.eq(supplyAfter);
      });
    });

    after(function () {
      console.table(rows);
    });
  });

  it('admin can update deposit fee bps', async function () {
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

    await expect(strategy.connect(admin).setFeeTreasury(treasury.address))
      .to.emit(strategy, 'FeeTreasurySet')
      .withArgs(treasury.address);

    await expect(strategy.connect(admin).setDepositFeeBps(altDeposit.address, 10))
      .to.emit(strategy, 'DepositFeeBpsSet')
      .withArgs(altDeposit.address, 10);
    expect(await strategy.depositFee(altDeposit.address)).to.equal(10);
    expect(await strategy.feeTreasury()).to.equal(treasury.address);
  });

  it('admin can swap asset converter for a listed deposit asset', async function () {
    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

    const convFactory = await ethers.getContractFactory('DirectConverter');
    const next = (await convFactory.deploy()) as DirectConverter;
    await next.waitForDeployment();
    const nextAddr = await next.getAddress();

    await expect(strategy.connect(admin).setAssetConverter(altDeposit.address, nextAddr))
      .to.emit(strategy, 'DepositAssetConverterSet')
      .withArgs(altDeposit.address, nextAddr);
    expect(await strategy.converterOf(altDeposit.address)).to.equal(nextAddr);
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
  const ONE_ETHER = e18; // oracle ratio scale

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
    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.MANAGER_ROLE(), admin.address);
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
      0,
      false
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
    await clStrategy.connect(admin).grantRole(await clStrategy.MANAGER_ROLE(), admin.address);
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
        0,
        false
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
          GRACE_PERIOD,
          false
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

  describe('ChainlinkConverter (inverted)', function () {
    const ONE_BTC = 10n ** 8n;
    const HEARTBEAT = 3600n;

    it('peg (answer=1e8, 8-dec feed): inverted 8/8/8 token-per-base is 1:1', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const invFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await invFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      const inv = (await convFactory.deploy(
        await invFeed.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkConverter;
      await inv.waitForDeployment();
      expect(await inv.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      expect(await inv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_BTC);
    });

    it('USDC (6 dec) / BTC (8 dec) via 8-dec BTC/USD-style feed', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const price = 100_000n * ONE_BTC; // 100k USD per 1 BTC
      const usdFeed = (await feedFactory.deploy(8, price)) as ChainlinkFeedMock;
      await usdFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      const conv = (await convFactory.deploy(
        await usdFeed.getAddress(),
        6,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkConverter;
      await conv.waitForDeployment();
      const usdcIn = 100_000n * 10n ** 6n;
      expect(await conv.toBaseUnits(usdcIn, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(usdcIn);
    });

    it('inverted: decimals underflow when feedDec + baseDec < tokenDec', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const invFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await invFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      await expect(
        convFactory.deploy(await invFeed.getAddress(), 18, 8, HEARTBEAT, ethers.ZeroAddress, 0, true)
      ).to.be.revertedWithCustomError(convFactory, 'ChainlinkConverter_DecimalsUnderflow');
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) >= x and diff <= 1 token wei (inverted)', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const invFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await invFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      const invConv = (await convFactory.deploy(
        await invFeed.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkConverter;
      await invConv.waitForDeployment();

      // Inverted uses mulDiv(token, SF, answer); keep answer <= SF so rounding matches forward-style bounds.
      const answers = [(ONE_BTC * 95n) / 100n, (ONE_BTC * 99n) / 100n, ONE_BTC];
      const amounts = [ONE_BTC / 2n, ONE_BTC, ONE_BTC * 100n];

      for (const answer of answers) {
        await invFeed.setAnswer(answer);
        for (const amt of amounts) {
          const btcOut = await invConv.toBaseUnits(amt, 0);
          const tokenOut = await invConv.fromBaseUnits(btcOut, 1);
          expect(tokenOut).to.be.gte(amt);
          expect(tokenOut - amt).to.be.lte(1n);
        }
      }
    });
  });

  describe('ChainlinkCompositeConverter', function () {
    const ONE_BTC = 10n ** 8n;
    const HEARTBEAT = 3600n;

    it('peg (both answers 1e8, 8-dec feeds, 8/8): toBaseUnits and fromBaseUnits are 1:1', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const feedNum = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      expect(await conv.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_BTC);
    });

    it('ETH/USD ÷ BTC/USD style cross: 1 ETH wei → expected satoshi', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // USD per ETH = 2500 (8-dec), USD per BTC = 50_000 (8-dec) → 0.05 BTC per ETH
      const ethUsd = (await feedFactory.deploy(8, 2500n * ONE_BTC)) as ChainlinkFeedMock;
      const btcUsd = (await feedFactory.deploy(8, 50_000n * ONE_BTC)) as ChainlinkFeedMock;
      await ethUsd.waitForDeployment();
      await btcUsd.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await ethUsd.getAddress(),
        await btcUsd.getAddress(),
        18,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      const oneEth = 10n ** 18n;
      const expectedSat = (oneEth * 2500n * ONE_BTC) / (50_000n * ONE_BTC) / 10n ** 10n; // 5e6
      expect(expectedSat).to.equal(5n * 10n ** 6n);
      expect(await conv.toBaseUnits(oneEth, 0)).to.equal(expectedSat);
      expect(await conv.fromBaseUnits(expectedSat, 1)).to.equal(oneEth);
    });

    it('stale numerator feed reverts', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const feedNum = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      const block = await ethers.provider.getBlock('latest');
      await feedNum.setUpdatedAt(BigInt(block!.timestamp) - HEARTBEAT - 1n);
      await expect(conv.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
        conv,
        'ChainlinkCompositeConverter_StaleAnswer'
      );
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) within 2 token wei (dual mulDiv)', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const feedNum = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        8,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      const numAnswers = [(ONE_BTC * 95n) / 100n, ONE_BTC, (ONE_BTC * 101n) / 100n];
      const denAnswers = [(ONE_BTC * 98n) / 100n, ONE_BTC + ONE_BTC / 10n, ONE_BTC];
      const amounts = [ONE_BTC / 2n, ONE_BTC, ONE_BTC * 100n];

      for (const n of numAnswers) {
        for (const d of denAnswers) {
          await feedNum.setAnswer(n);
          await feedDen.setAnswer(d);
          for (const amt of amounts) {
            const btcOut = await conv.toBaseUnits(amt, 0);
            const tokenOut = await conv.fromBaseUnits(btcOut, 1);
            const diff = tokenOut >= amt ? tokenOut - amt : amt - tokenOut;
            expect(diff).to.be.lte(2n);
          }
        }
      }
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
