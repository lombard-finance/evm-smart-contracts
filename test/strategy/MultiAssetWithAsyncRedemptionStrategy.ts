import {
  Addressable,
  advanceTime,
  calculateStorageSlot,
  deployContract,
  e18,
  getSignersWithPrivateKeys,
  proxyOpts,
  randomBigInt,
  Signer
} from '../helpers';
import { DenialReason } from './fixtures/blocklist';
import type {
  BlocklistOracle,
  ChainlinkCompositeConverter,
  ChainlinkConverter,
  ChainlinkFeedMock,
  DirectConverter,
  WBTCMock,
  MultiAssetWithAsyncRedemptionStrategy,
  RatioFeedMock,
  SanctionListMock,
  StakedLBTCMock,
  TokenMock
} from '../../typechain-types';

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';

describe('MultiAssetWithAsyncRedemptionStrategy', function () {
  const BPS_DENOMINATOR = 10_000n;
  const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
  const MGMT_FEE_BPS = 1000n;

  let admin: Signer;
  let manager: Signer;
  let priceSetter: Signer;
  let pauser: Signer;
  let transfersPauser: Signer;
  let perfFeeClaimer: Signer;
  let redeemOperator: Signer;
  let treasury: Signer;
  let sender: Signer;
  let receiver: Signer;

  let underlying: TokenMock & Addressable;
  let altDeposit: TokenMock & Addressable;
  let directConverter: DirectConverter & Addressable;
  let strategy: MultiAssetWithAsyncRedemptionStrategy & Addressable;
  let blocklistOracle: BlocklistOracle & Addressable;

  let snapshot: SnapshotRestorer;

  // Mirrors FeeManagerUpgradeable._computeManagementFeeShares: gross-up so the treasury ends up owning
  // f = num/den of the POST-mint supply (mint S*f/(1-f) = S*num/(den-num)), over the full elapsed interval.
  function expectedManagementFeeShares(supply: bigint, elapsedSeconds: bigint): bigint {
    const num = MGMT_FEE_BPS * elapsedSeconds;
    const den = BPS_DENOMINATOR * SECONDS_PER_YEAR;
    return (supply * num) / (den - num);
  }

  before(async function () {
    [admin, manager, priceSetter, pauser, transfersPauser, perfFeeClaimer, redeemOperator, treasury, sender, receiver] =
      await getSignersWithPrivateKeys();

    underlying = await deployContract<TokenMock>('TokenMock', ['Underlying', 'UND', 18], false);
    altDeposit = await deployContract<TokenMock>('TokenMock', ['Alt Deposit', 'ALT', 18], false);

    blocklistOracle = await deployContract<BlocklistOracle>('BlocklistOracle', [0, admin.address], true, proxyOpts);

    directConverter = await deployContract<DirectConverter>('DirectConverter', [], false);

    strategy = await deployContract<MultiAssetWithAsyncRedemptionStrategy>('MultiAssetWithAsyncRedemptionStrategy', [
      'Multi Strategy Shares',
      'mSTRAT',
      await underlying.getAddress(),
      18,
      admin.address,
      0,
      treasury.address,
      blocklistOracle.address
    ]);

    await strategy.connect(admin).grantRole(await strategy.MANAGER_ROLE(), manager.address);
    await strategy.connect(admin).grantRole(await strategy.PRICE_SETTER_ROLE(), priceSetter.address);
    await strategy.connect(admin).grantRole(await strategy.STRATEGY_PAUSER_ROLE(), pauser.address);
    await strategy.connect(admin).grantRole(await strategy.TRANSFERS_PAUSER_ROLE(), transfersPauser.address);
    await strategy.connect(admin).grantRole(await strategy.PERF_FEE_CLAIM_ROLE(), perfFeeClaimer.address);

    await strategy.connect(admin).grantRole(await strategy.PAY_REDEMPTIONS_ROLE(), redeemOperator.address);

    // feeTreasury is no longer an initializer arg; it is configured via setFeeTreasury (MANAGER_ROLE).
    await strategy.connect(manager).setFeeTreasury(treasury.address);

    snapshot = await takeSnapshot();
  });

  describe('Deployment', function () {
    describe('Default values', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('name() returns the configured share name', async function () {
        expect(await strategy.name()).to.equal('Multi Strategy Shares');
      });

      it('symbol() returns the configured share symbol', async function () {
        expect(await strategy.symbol()).to.equal('mSTRAT');
      });

      it('asset() returns the underlying asset', async function () {
        expect(await strategy.asset()).to.equal(underlying.address);
      });

      it('version() returns the contract version', async function () {
        expect(await strategy.version()).to.equal('MAWARS-0.0.1');
      });

      it('blocklistOracle() returns the configured oracle', async function () {
        expect(await strategy.blocklistOracle()).to.equal(blocklistOracle.address);
      });

      it('feeTreasury() returns the configured fee treasury', async function () {
        expect(await strategy.feeTreasury()).to.equal(treasury.address);
      });
    });

    describe('Storage layout', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('Verify StrategyBaseUpgradeableStorage slot', async function () {
        const base = calculateStorageSlot('lombardfinance.storage.StrategyBaseUpgradeable');
        // pricePerShare (uint256) is at base+2, after the 2-slot EnumerableSet for shards
        const storage = await ethers.provider.getStorage(await strategy.getAddress(), base + 2n);
        expect(storage).to.equal(ethers.toBeHex(e18, 32));
      });

      it('Verify MultiAssetDepositStorage slot', async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const base = calculateStorageSlot('lombardfinance.storage.MultiAssetDepositUpgradeable');
        // depositAssets EnumerableSet stores its array length at base+0 (= 1 after adding one asset)
        const storage = await ethers.provider.getStorage(await strategy.getAddress(), base);
        expect(storage).to.equal(ethers.toBeHex(1n, 32));
      });

      it('Verify FeeManagerStorage slot', async function () {
        const slot = calculateStorageSlot('lombardfinance.storage.FeeManagerUpgradeable');
        const storage = await ethers.provider.getStorage(await strategy.getAddress(), slot);
        const [mgmtFeeBps, lastHarvest, mgmtTreasury] = await strategy.managementFee();
        const [perfFeeBps] = await strategy.performanceFee();
        const expected =
          BigInt(mgmtFeeBps) +
          (BigInt(perfFeeBps) << 16n) +
          (BigInt(lastHarvest) << 32n) +
          (BigInt(mgmtTreasury) << 80n);
        expect(storage).to.equal(ethers.toBeHex(expected, 32));
      });
    });

    describe('Initializer', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('initialize reverts when management fee treasury is zero', async function () {
        // prettier-ignore
        await expect(
          deployContract('MultiAssetWithAsyncRedemptionStrategy', [
            'Tmp',
            'TMP',
            underlying.address,
            18,
            admin.address,
            0,
            ethers.ZeroAddress,
            blocklistOracle.address
          ])
        ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('initialize reverts when blocklist oracle is zero', async function () {
        // prettier-ignore
        await expect(
          deployContract('MultiAssetWithAsyncRedemptionStrategy', [
            'Tmp',
            'TMP',
            underlying.address,
            18,
            admin.address,
            0,
            treasury.address,
            ethers.ZeroAddress
          ])
        ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('initialize reverts when fallback decimals is zero', async function () {
        // prettier-ignore
        await expect(
          deployContract('MultiAssetWithAsyncRedemptionStrategy', [
            'Tmp',
            'TMP',
            underlying.address,
            0,
            admin.address,
            0,
            treasury.address,
            blocklistOracle.address
          ])
        ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroDecimals');
      });
    });
  });

  describe('Setters and getters', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    describe('changeNameAndSymbol', function () {
      it('admin can update the name and symbol', async function () {
        const newName = 'Renamed Strategy Shares';
        const newSymbol = 'rSTRAT';

        // prettier-ignore
        await expect(strategy.connect(admin).changeNameAndSymbol(newName, newSymbol))
          .to.emit(strategy, 'NameAndSymbolChanged')
          .withArgs(newName, newSymbol);

        expect(await strategy.name()).to.equal(newName);
        expect(await strategy.symbol()).to.equal(newSymbol);
      });

      it('reverts for non-admin', async function () {
        const newName = 'Renamed Strategy Shares';
        const newSymbol = 'rSTRAT';

        // prettier-ignore
        await expect(strategy.connect(sender).changeNameAndSymbol(newName, newSymbol))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });
    });

    describe('setBlocklistOracle', function () {
      it('admin can set a new blocklist oracle', async function () {
        const newOracle = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(admin).setBlocklistOracle(newOracle))
          .to.emit(strategy, 'BlocklistOracleSet')
          .withArgs(newOracle);
        expect(await strategy.blocklistOracle()).to.equal(newOracle);
      });

      it('reverts for zero address', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).setBlocklistOracle(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('reverts for non-admin', async function () {
        const newOracle = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(sender).setBlocklistOracle(newOracle))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });
    });

    describe('setFeeTreasury', function () {
      it('manager can set the fee treasury', async function () {
        const newTreasury = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(manager).setFeeTreasury(newTreasury))
          .to.emit(strategy, 'FeeTreasurySet')
          .withArgs(newTreasury);
        expect(await strategy.feeTreasury()).to.equal(newTreasury);
      });

      it('reverts for non-manager', async function () {
        const newTreasury = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(sender).setFeeTreasury(newTreasury))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts for zero address', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setFeeTreasury(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });
    });

    describe('addDepositAsset', function () {
      it('getAssets is empty by default', async function () {
        expect(await strategy.getAssets()).to.be.empty;
      });

      it('manager can add a deposit asset', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 100))
          .to.emit(strategy, 'DepositAssetAdded')
          .withArgs(manager.address, altDeposit.address)
          .and.to.emit(strategy, 'DepositFeeBpsSet')
          .withArgs(altDeposit.address, 100)
          .and.to.emit(strategy, 'DepositAssetConverterSet')
          .withArgs(altDeposit.address, directConverter.address);
        expect(await strategy.isDepositAsset(altDeposit.address)).to.be.true;
        expect(await strategy.converterOf(altDeposit.address)).to.equal(directConverter.address);
        expect(await strategy.depositFee(altDeposit.address)).to.equal(100);
        expect(await strategy.maxDeposit(altDeposit.address, sender.address)).to.equal(ethers.MaxUint256);
        expect(await strategy.maxMint(altDeposit.address, sender.address)).to.equal(ethers.MaxUint256);
        expect([...(await strategy.getAssets())]).to.have.members([altDeposit.address]);
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).addDepositAsset(altDeposit.address, directConverter.address, 0))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts for zero asset address', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).addDepositAsset(ethers.ZeroAddress, directConverter.address, 0))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('reverts for zero converter', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).addDepositAsset(altDeposit.address, ethers.ZeroAddress, 0))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('reverts when fee bps is too high', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 10000))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_FeeBpsTooHigh');
      });

      it('reverts when the asset is already added', async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        // prettier-ignore
        await expect(strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_AssetAlreadyAdded');
      });
    });

    describe('removeDepositAsset', function () {
      beforeEach(async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      });

      it('manager can remove a deposit asset', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).removeDepositAsset(altDeposit.address))
          .to.emit(strategy, 'DepositAssetRemoved')
          .withArgs(altDeposit.address);
        expect(await strategy.isDepositAsset(altDeposit.address)).to.be.false;
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).removeDepositAsset(altDeposit.address))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts when the asset is not listed', async function () {
        const altDeposit = ethers.Wallet.createRandom();
        // prettier-ignore
        await expect(strategy.connect(manager).removeDepositAsset(altDeposit.address))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_AssetNotListed');
      });
    });

    describe('setAssetConverter', function () {
      beforeEach(async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      });

      it('manager can swap the converter for a listed deposit asset', async function () {
        const next = await deployContract<DirectConverter>('DirectConverter', [], false);
        const nextAddr = await next.getAddress();

        // prettier-ignore
        await expect(strategy.connect(manager).setAssetConverter(altDeposit.address, nextAddr))
          .to.emit(strategy, 'DepositAssetConverterSet')
          .withArgs(altDeposit.address, nextAddr);
        expect(await strategy.converterOf(altDeposit.address)).to.equal(nextAddr);
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setAssetConverter(altDeposit.address, directConverter.address))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts when the asset is not listed', async function () {
        const altDeposit = ethers.Wallet.createRandom();
        // prettier-ignore
        await expect(strategy.connect(manager).setAssetConverter(altDeposit.address, directConverter.address))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_AssetNotListed');
      });

      it('reverts for zero converter', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setAssetConverter(altDeposit.address, ethers.ZeroAddress))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });
    });

    describe('setDefaultShard', function () {
      it('manager can set a registered shard as default', async function () {
        const sink = ethers.Wallet.createRandom().address;
        await strategy.connect(admin).registerShard(sink);
        // prettier-ignore
        await expect(strategy.connect(manager).setDefaultShard(sink))
          .to.emit(strategy, 'DefaultShardSet')
          .withArgs(sink, manager.address);
        expect(await strategy.defaultShard()).to.equal(sink);
      });

      it('reverts for non-manager', async function () {
        const sink = ethers.Wallet.createRandom().address;
        await strategy.connect(admin).registerShard(sink);
        // prettier-ignore
        await expect(strategy.connect(sender).setDefaultShard(sink))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts if the shard is not registered', async function () {
        const rogue = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(manager).setDefaultShard(rogue))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ShardNotRegistered');
      });

      it('manager can set default shard to 0', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setDefaultShard(ethers.ZeroAddress))
          .to.emit(strategy, 'DefaultShardSet')
          .withArgs(ethers.ZeroAddress, manager.address);
        expect(await strategy.defaultShard()).to.equal(ethers.ZeroAddress);
      });
    });

    describe('registerShard', function () {
      it('admin can register a shard', async function () {
        const sink = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(admin).registerShard(sink))
          .to.emit(strategy, 'ShardRegistered')
          .withArgs(sink, admin.address);
        expect(await strategy.isRegisteredShard(sink)).to.be.true;

        expect([...(await strategy.shards())]).to.have.members([sink]);
      });

      it('reverts for non-admin', async function () {
        const sink = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(sender).registerShard(sink))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });

      it('reverts for zero address', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).registerShard(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });

      it('reverts when already registered', async function () {
        const sink = ethers.Wallet.createRandom().address;
        await strategy.connect(admin).registerShard(sink);
        // prettier-ignore
        await expect(strategy.connect(admin).registerShard(sink))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ShardAlreadyRegistered');
      });
    });

    describe('deregisterShard', function () {
      it('manager can clear the default shard when it matches', async function () {
        const sink = ethers.Wallet.createRandom().address;
        await strategy.connect(admin).registerShard(sink);
        await strategy.connect(manager).setDefaultShard(sink);
        // prettier-ignore
        await expect(strategy.connect(manager).deregisterShard(sink))
          .to.emit(strategy, 'DefaultShardSet')
          .withArgs(ethers.ZeroAddress, manager.address);
        expect(await strategy.defaultShard()).to.equal(ethers.ZeroAddress);

        expect(await strategy.shards()).to.be.empty;
      });

      it('reverts for non-manager', async function () {
        const sink = ethers.Wallet.createRandom().address;
        await strategy.connect(admin).registerShard(sink);
        // prettier-ignore
        await expect(strategy.connect(sender).deregisterShard(sink))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts when the shard is not registered', async function () {
        const rogue = ethers.Wallet.createRandom().address;
        // prettier-ignore
        await expect(strategy.connect(manager).deregisterShard(rogue))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ShardNotRegistered');
      });
    });

    describe('setManagementFeeTreasury', function () {
      it('manager can set the management fee treasury', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setManagementFeeTreasury(sender.address))
          .to.emit(strategy, 'ManagementFeeTreasurySet')
          .withArgs(manager.address, sender.address);
        expect((await strategy.managementFee())[2]).to.equal(sender.address);
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setManagementFeeTreasury(sender.address))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts for zero address', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setManagementFeeTreasury(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
      });
    });

    describe('setPricePerShareRateLimit', function () {
      it('manager can set the rate limit', async function () {
        const maxBps = 500;
        const refillRate = 10;
        await strategy.connect(manager).setPricePerShareRateLimit(maxBps, refillRate);
        expect((await strategy.pricePerShareRateLimiterState()).maxBps).to.equal(maxBps);
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setPricePerShareRateLimit(500, 10))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });
    });
  });

  describe('Fee setters', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    describe('setDepositFeeBps', function () {
      beforeEach(async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      });

      it('manager can set the deposit fee bps', async function () {
        const feeBps = 9999;
        // prettier-ignore
        await expect(strategy.connect(manager).setDepositFeeBps(altDeposit.address, feeBps))
          .to.emit(strategy, 'DepositFeeBpsSet')
          .withArgs(altDeposit.address, feeBps);
        expect(await strategy.depositFee(altDeposit.address)).to.equal(feeBps);
      });

      it('manager can set 0 deposit fee bps', async function () {
        const feeBps = 0;
        // prettier-ignore
        await expect(strategy.connect(manager).setDepositFeeBps(altDeposit.address, feeBps))
          .to.emit(strategy, 'DepositFeeBpsSet')
          .withArgs(altDeposit.address, feeBps);
        expect(await strategy.depositFee(altDeposit.address)).to.equal(feeBps);
      });

      it('reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setDepositFeeBps(altDeposit.address, 10))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('reverts when the asset is not listed', async function () {
        const altDeposit = ethers.Wallet.createRandom();
        // prettier-ignore
        await expect(strategy.connect(manager).setDepositFeeBps(altDeposit.address, 10))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_AssetNotListed');
      });

      it('reverts when fee bps is too high', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).setDepositFeeBps(altDeposit.address, 10000))
          .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_FeeBpsTooHigh');
      });
    });

    describe('setManagementFeeBps', function () {
      it('admin can set the management fee bps', async function () {
        const feeBps = 9999;
        // prettier-ignore
        await expect(strategy.connect(admin).setManagementFeeBps(feeBps))
          .to.emit(strategy, 'ManagementFeeBpsSet')
          .withArgs(admin.address, feeBps);
        expect((await strategy.managementFee())[0]).to.equal(feeBps);
      });

      it('admin can set 0 management fee bps', async function () {
        const feeBps = 0;
        // prettier-ignore
        await expect(strategy.connect(admin).setManagementFeeBps(feeBps))
          .to.emit(strategy, 'ManagementFeeBpsSet')
          .withArgs(admin.address, feeBps);
        expect((await strategy.managementFee())[0]).to.equal(feeBps);
      });

      it('reverts for non-admin', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setManagementFeeBps(500))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });

      it('reverts when fee bps is too high', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).setManagementFeeBps(10000))
          .to.be.revertedWithCustomError(strategy, 'FeeManager_ManagementFeeBpsTooHigh');
      });
    });

    describe('setPerformanceFeeBps', function () {
      it('admin can set the performance fee bps', async function () {
        const feeBps = 9999;
        // prettier-ignore
        await expect(strategy.connect(admin).setPerformanceFeeBps(feeBps, treasury.address, false))
          .to.emit(strategy, 'PerformanceFeeBpsSet')
          .withArgs(admin.address, feeBps);
        expect((await strategy.performanceFee())[0]).to.equal(feeBps);
      });

      it('admin can set 0 performance fee bps', async function () {
        const feeBps = 0;
        // prettier-ignore
        await expect(strategy.connect(admin).setPerformanceFeeBps(feeBps, treasury.address, false))
          .to.emit(strategy, 'PerformanceFeeBpsSet')
          .withArgs(admin.address, feeBps);
        expect((await strategy.performanceFee())[0]).to.equal(feeBps);
      });

      it('reverts for non-admin', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setPerformanceFeeBps(500, treasury.address, false))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });

      it('reverts when fee bps is too high', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).setPerformanceFeeBps(10000, treasury.address, false))
          .to.be.revertedWithCustomError(strategy, 'FeeManager_PerformanceFeeBpsTooHigh');
      });

      it('reverts for zero fee recipient', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).setPerformanceFeeBps(500, ethers.ZeroAddress, false))
          .to.be.revertedWithCustomError(strategy, 'FeeManager_FeeRecipientRequired');
      });
    });

    describe('setRedeemFeeBps', function () {
      it('admin can set the redeem fee bps', async function () {
        const feeBps = 9999;
        // prettier-ignore
        await expect(strategy.connect(admin).setRedeemFeeBps(feeBps))
          .to.emit(strategy, 'RedeemFeeBpsSet')
          .withArgs(feeBps);
        expect(await strategy.redeemFee()).to.equal(feeBps);
      });

      it('admin can set 0 redeem fee bps', async function () {
        const feeBps = 0;
        // prettier-ignore
        await expect(strategy.connect(admin).setRedeemFeeBps(feeBps))
          .to.emit(strategy, 'RedeemFeeBpsSet')
          .withArgs(feeBps);
        expect(await strategy.redeemFee()).to.equal(feeBps);
      });

      it('reverts for non-admin', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).setRedeemFeeBps(100))
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.DEFAULT_ADMIN_ROLE());
      });

      it('reverts when fee bps is too high', async function () {
        // prettier-ignore
        await expect(strategy.connect(admin).setRedeemFeeBps(10000))
          .to.be.revertedWithCustomError(strategy, 'AsyncRedemption_RedeemFeeBpsTooHigh');
      });
    });
  });

  describe('Pausing', function () {
    describe('Deposits', function () {
      const SEED = 1000n * e18;

      before(async function () {
        await snapshot.restore();
        // Seed `sender` with shares while deposits are still open, so the redeem path has a balance once paused.
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        await altDeposit.mint(sender.address, SEED);
        await altDeposit.connect(sender).approve(strategy.address, SEED);
        await strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, SEED, sender.address);
      });

      it('pauseDeposit() STRATEGY_PAUSER_ROLE can pause deposits', async function () {
        // prettier-ignore
        await expect(strategy.connect(pauser).pauseDeposit())
          .to.emit(strategy, 'DepositPaused')
          .withArgs(pauser.address);
        expect(await strategy.depositPaused()).to.be.true;
      });

      it('maxDeposit() reverts while deposits are paused', async function () {
        // prettier-ignore
        expect(await strategy.connect(sender).maxDeposit(altDeposit.address, sender.address))
          .to.be.eq(0n);
      });

      it('deposit(address,uint256,address) reverts while deposits are paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, 1n, sender.address))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedDepositPause');
      });

      it('deposit(address,uint256,address,uint256) reverts while deposits are paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender)['deposit(address,uint256,address,uint256)'](altDeposit.address, 1n, sender.address, 0n))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedDepositPause');
      });

      it(`mint(address,uint256,address) reverts while deposits are paused`, async function () {
        // prettier-ignore
        await expect(strategy.connect(sender)
          ['mint(address,uint256,address)'](altDeposit.address, 1n, sender.address))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedDepositPause')
      });

      it(`mint(address,uint256,address,uint256) reverts while deposits are paused`, async function () {
        // prettier-ignore
        await expect(strategy.connect(sender)['mint(address,uint256,address,uint256)']
          (altDeposit.address, 1n, sender.address, ethers.MaxUint256))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedDepositPause');
      });

      it('requestRedeem() still works while deposits are paused', async function () {
        expect(await strategy.depositPaused()).to.be.true;
        const redeemShares = 100n * e18;
        // prettier-ignore
        await expect(strategy.connect(sender).requestRedeem(redeemShares, sender.address))
          .to.emit(strategy, 'RedeemRequested');
        const [pendingShares] = await strategy.totalPending();
        expect(pendingShares).to.equal(redeemShares);
      });

      it('unpauseDeposit() manager can unpause deposits', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).unpauseDeposit())
          .to.emit(strategy, 'DepositUnpaused')
          .withArgs(manager.address);
        expect(await strategy.depositPaused()).to.be.false;
      });

      it('pauseDeposit() reverts for non-pauser', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).pauseDeposit())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.STRATEGY_PAUSER_ROLE());
      });

      it('unpauseDeposit() reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).unpauseDeposit())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('unpauseDeposit() reverts when deposit is not paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).unpauseDeposit())
          .to.be.revertedWithCustomError(strategy, 'Strategy_ExpectedDepositPause');
      });
    });

    describe('Redemptions', function () {
      const REQUEST_SHARES = 100n * e18;

      before(async function () {
        await snapshot.restore();
        // List + fund so deposit/mint can run while redemptions are paused.
        const SEED = 1000n * e18;
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        await altDeposit.mint(sender.address, SEED);
        await altDeposit.connect(sender).approve(strategy.address, SEED);
        // Open a redeem request (while still allowed) so fulfillment can be asserted to revert after pausing.
        await strategy
          .connect(sender)
          ['deposit(address,uint256,address)'](altDeposit.address, REQUEST_SHARES, sender.address);
        await strategy.connect(sender).requestRedeem(REQUEST_SHARES, sender.address);
        await underlying.mint(strategy.address, REQUEST_SHARES);
      });

      it('pauseRedeem() STRATEGY_PAUSER_ROLE can pause redemptions', async function () {
        // prettier-ignore
        await expect(strategy.connect(pauser).pauseRedeem())
          .to.emit(strategy, 'RedeemPaused')
          .withArgs(pauser.address);
        expect(await strategy.redeemPaused()).to.be.true;
      });

      it('requestRedeem() reverts while redemptions are paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).requestRedeem(1n, sender.address))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedRedeemPause');
      });

      it('deposit() still works while redemptions are paused', async function () {
        expect(await strategy.redeemPaused()).to.be.true;
        const assets = 100n * e18;
        await expect(
          strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address)
        ).to.changeTokenBalance(strategy, sender, assets);
      });

      it('mint() still works while redemptions are paused', async function () {
        const targetShares = 100n * e18;
        await expect(
          strategy.connect(sender)['mint(address,uint256,address)'](altDeposit.address, targetShares, sender.address)
        ).to.changeTokenBalance(strategy, sender, targetShares);
      });

      it('fulfillRedeemRequests() reverts while redemptions are paused', async function () {
        expect(await strategy.redeemPaused()).to.be.true;
        await advanceTime(1);
        // prettier-ignore
        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([1n]))
          .to.be.revertedWithCustomError(strategy, 'Strategy_EnforcedRedeemPause');
      });

      it('unpauseRedeem() manager can unpause redemptions', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).unpauseRedeem())
          .to.emit(strategy, 'RedeemUnpaused')
          .withArgs(manager.address);
        expect(await strategy.redeemPaused()).to.be.false;
      });

      it('pauseRedeem() reverts for non-pauser', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).pauseRedeem())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.STRATEGY_PAUSER_ROLE());
      });

      it('unpauseRedeem() reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).unpauseRedeem())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });

      it('unpauseRedeem() reverts when redemption is not paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).unpauseRedeem())
          .to.be.revertedWithCustomError(strategy, 'Strategy_ExpectedRedeemPause');
      });
    });

    describe('Transfers', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('pause() TRANSFERS_PAUSER_ROLE can pause transfers', async function () {
        // prettier-ignore
        await expect(strategy.connect(transfersPauser).pause())
          .to.emit(strategy, 'Paused')
          .withArgs(transfersPauser.address);
        expect(await strategy.paused()).to.be.true;
      });

      it('maxDeposit() reverts while transfers are paused', async function () {
        // prettier-ignore
        expect(await strategy.connect(sender).maxDeposit(altDeposit.address, sender.address))
          .to.be.eq(0n);
      });

      it('transfer() reverts while transfers are paused', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).transfer(treasury.address, 1n))
          .to.be.revertedWithCustomError(strategy, 'EnforcedPause');
      });

      it('deposit() reverts while transfers are paused (share mint routes through the pause)', async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const assets = 100n * e18;
        await altDeposit.mint(sender.address, assets);
        await altDeposit.connect(sender).approve(strategy.address, assets);
        // prettier-ignore
        await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address))
          .to.be.revertedWithCustomError(strategy, 'EnforcedPause');
      });

      it('requestRedeem() reverts while transfers are paused (share transfer routes through the pause)', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).requestRedeem(1n, sender.address))
          .to.be.revertedWithCustomError(strategy, 'EnforcedPause');
      });

      it('unpause() manager can unpause transfers', async function () {
        // prettier-ignore
        await expect(strategy.connect(manager).unpause())
          .to.emit(strategy, 'Unpaused')
          .withArgs(manager.address);
        expect(await strategy.paused()).to.be.false;
      });

      it('pause() reverts for non-pauser', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).pause())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.TRANSFERS_PAUSER_ROLE());
      });

      it('unpause() reverts for non-manager', async function () {
        // prettier-ignore
        await expect(strategy.connect(sender).unpause())
          .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
          .withArgs(sender.address, await strategy.MANAGER_ROLE());
      });
    });
  });

  describe('Blocklist and Sanctions', function () {
    const DEPOSIT_AMT = 10n * e18;
    const MINT_SHARES = e18;

    let oracle: BlocklistOracle;

    beforeEach(async function () {
      await snapshot.restore();
      oracle = await ethers.getContractAt('BlocklistOracle', blocklistOracle.address);
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await altDeposit.mint(sender.address, 3n * DEPOSIT_AMT);
      await altDeposit.connect(sender).approve(strategy.address, ethers.MaxUint256);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, DEPOSIT_AMT, sender.address);
    });

    describe('Blocked and sanctioned accounts', function () {
      let sanctionList: SanctionListMock;
      let blocked: Signer;
      let sanctioned: Signer;

      const args = [
        {
          party: 'blocklisted sender',
          sender: () => blocked,
          receiver: () => receiver,
          reason: DenialReason.Blocklist
        },
        {
          party: 'blocklisted receiver',
          sender: () => sender,
          receiver: () => blocked,
          reason: DenialReason.Blocklist
        },
        {
          party: 'sanctioned sender',
          sender: () => sanctioned,
          receiver: () => receiver,
          reason: DenialReason.Sanction
        },
        {
          party: 'sanctioned receiver',
          sender: () => sender,
          receiver: () => sanctioned,
          reason: DenialReason.Sanction
        }
      ];

      beforeEach(async function () {
        [blocked, sanctioned] = (await getSignersWithPrivateKeys()).slice(10, 12);
        sanctionList = await deployContract<SanctionListMock>('SanctionListMock', [], false);
        await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
        await oracle.connect(admin).blockAccount([blocked.address]);
        await sanctionList.setSanctioned(sanctioned.address, true);
      });

      args.forEach(({ party, sender, receiver, reason }) => {
        it(`deposit(address,uint256,address) reverts with a ${party}`, async function () {
          // prettier-ignore
          await expect(
            strategy
              .connect(sender())
              ['deposit(address,uint256,address)'](altDeposit.address, DEPOSIT_AMT, receiver().address)
          )
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`deposit(address,uint256,address,uint256) reverts with a ${party}`, async function () {
          // prettier-ignore
          await expect(
            strategy
              .connect(sender())
              ['deposit(address,uint256,address,uint256)'](altDeposit.address, DEPOSIT_AMT, receiver().address, 0n)
          )
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`mint(address,uint256,address) reverts with a ${party}`, async function () {
          // prettier-ignore
          await expect(
            strategy.connect(sender())['mint(address,uint256,address)'](altDeposit.address, MINT_SHARES, receiver().address)
          )
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`mint(address,uint256,address,uint256) reverts with a ${party}`, async function () {
          // prettier-ignore
          await expect(
            strategy
              .connect(sender())
              [
              'mint(address,uint256,address,uint256)'
              ](altDeposit.address, MINT_SHARES, receiver().address, ethers.MaxUint256)
          )
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`transfer reverts with a ${party}`, async function () {
          // prettier-ignore
          await expect(strategy.connect(sender()).transfer(receiver().address, 1n))
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`transferFrom reverts with a ${party}`, async function () {
          await strategy.connect(sender()).approve(redeemOperator.address, 1n);
          // prettier-ignore
          await expect(strategy.connect(redeemOperator).transferFrom(sender().address, receiver().address, 1n))
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });
      });

      [
        {
          kind: 'blocklisted',
          reason: DenialReason.Blocklist,
          denyOwner: () => oracle.connect(admin).blockAccount([sender.address])
        },
        {
          kind: 'sanctioned',
          reason: DenialReason.Sanction,
          denyOwner: () => sanctionList.setSanctioned(sender.address, true)
        }
      ].forEach(({ kind, reason, denyOwner }) => {
        it(`requestRedeem reverts with a ${kind} owner`, async function () {
          await strategy.connect(admin).setRedeemFeeBps(100);
          await denyOwner();
          // prettier-ignore
          await expect(strategy.connect(sender).requestRedeem(MINT_SHARES, sender.address))
            .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
            .withArgs(reason);
        });

        it(`settleRedemption() fulfills even when the owner is ${kind}`, async function () {
          await underlying.mint(strategy.address, MINT_SHARES);
          await strategy.connect(sender).requestRedeem(MINT_SHARES, sender.address);
          await denyOwner();
          await advanceTime(1);
          const balanceBefore = await underlying.balanceOf(sender.address);
          // prettier-ignore
          await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([1n]))
            .to.emit(strategy, 'Redeem');
          expect((await underlying.balanceOf(sender.address)) - balanceBefore).to.equal(MINT_SHARES);
        });
      });

      it('requestRedeem on behalf reverts when the owner is blocklisted', async function () {
        const shares = await strategy.balanceOf(sender.address);
        await strategy.connect(sender).approve(receiver.address, shares);
        // The caller (receiver) is compliant and approved, but shares burn from the owner, so the gate follows the owner.
        await oracle.connect(admin).blockAccount([sender.address]);
        // prettier-ignore
        await expect(strategy.connect(receiver).requestRedeem(shares, sender.address))
          .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
          .withArgs(DenialReason.Blocklist);
      });
    });

    // System addresses not affected by 3rd party sanction list when they are allowlisted
    describe('System addresses allowlisted against 3rd-party sanctions', function () {
      let sanctionList: SanctionListMock;

      beforeEach(async function () {
        sanctionList = await deployContract<SanctionListMock>('SanctionListMock', [], false);
        await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
        // Exempt every system address from external sanction lists.
        await oracle.connect(admin).allowAccount([strategy.address, treasury.address]);
      });

      it('a sanctioned strategy address does not block deposits', async function () {
        await sanctionList.setSanctioned(strategy.address, true);
        await strategy
          .connect(sender)
          ['deposit(address,uint256,address)'](altDeposit.address, DEPOSIT_AMT, sender.address);
        expect(await strategy.balanceOf(sender.address)).to.equal(DEPOSIT_AMT * 2n);
      });

      it('a sanctioned fee treasury does not block requestRedeem when a redeem fee > 0', async function () {
        await strategy.connect(admin).setRedeemFeeBps(100);
        await sanctionList.setSanctioned(treasury.address, true);
        // prettier-ignore
        await expect(strategy.connect(sender).requestRedeem(MINT_SHARES, sender.address))
          .to.emit(strategy, 'RedeemRequested');
      });

      it('a sanctioned fee treasury does not halt deposits while a management fee is accruing', async function () {
        await strategy.connect(admin).setManagementFeeBps(1000); // 10%
        await advanceTime(7 * 24 * 60 * 60);
        await sanctionList.setSanctioned(treasury.address, true);

        // Every deposit accrues the management fee by minting dilution shares to the treasury; because the
        // treasury is allowlisted, that mint passes the sanction check and the deposit still goes through.
        const treasuryBefore = await strategy.balanceOf(treasury.address);
        await strategy
          .connect(sender)
          ['deposit(address,uint256,address)'](altDeposit.address, DEPOSIT_AMT, sender.address);
        expect(await strategy.balanceOf(treasury.address)).to.be.gt(treasuryBefore);
      });
    });
  });

  describe('Deposit and mint', function () {
    const args = [
      {
        name: 'amount is >> 0 and fee is 0',
        amount: randomBigInt(21),
        depositFeeBps: 0n
      },
      {
        name: 'amount is >> 0 and fee is max',
        amount: randomBigInt(21),
        depositFeeBps: 9999n
      },
      {
        name: 'amount is >> 0 and fee is > 0',
        amount: randomBigInt(21),
        depositFeeBps: randomBigInt(2)
      },
      {
        name: 'amount = 11111 and fee is 7000',
        amount: 11111n,
        depositFeeBps: 7000n
      },
      {
        name: 'amount = 11111 and fee is 5000',
        amount: 11111n,
        depositFeeBps: 5000n
      },
      {
        name: 'amount = 19999 and fee is 1',
        amount: 19999n,
        depositFeeBps: 1n
      },
      {
        name: 'amount = 10000 and fee is 5000',
        amount: 10000n,
        depositFeeBps: 5000n
      },
      {
        name: 'amount = 10000 and fee is 1',
        amount: 10000n,
        depositFeeBps: 1n
      },
      {
        name: 'amount = 9999 and fee is 1',
        amount: 9999n,
        depositFeeBps: 1n
      },
      {
        name: 'amount < 10000n and fee is 1',
        amount: randomBigInt(4),
        depositFeeBps: 1n
      },
      {
        name: 'amount = 1000 and fee is 10',
        amount: 1000n,
        depositFeeBps: 10n
      },
      {
        name: 'amount is 10000 and fee is 1 (ceil fee avoids zero net)',
        amount: 10_000n,
        depositFeeBps: 1n
      }
    ];

    const rows: { amount: number; feeBps: number; fee: number; net: number }[] = [];

    beforeEach(async function () {
      await snapshot.restore();
    });

    after(function () {
      console.table(rows);
    });

    args.forEach(arg => {
      it(`deposit matches preview ${arg.name}`, async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, arg.depositFeeBps);
        const assets = arg.amount;
        await altDeposit.mint(sender.address, assets);
        await altDeposit.connect(sender).approve(strategy.address, assets);

        const fee = arg.depositFeeBps === 0n ? 0n : (assets * arg.depositFeeBps + 10_000n - 1n) / 10_000n;
        const net = assets - fee;

        const previewShares = await strategy.previewDeposit(altDeposit.address, assets);
        // prettier-ignore
        await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address))
          .to.emit(strategy, 'Deposit')
        .withArgs(sender.address, sender.address, altDeposit.address, net, previewShares, fee);

        expect(await strategy.balanceOf(sender.address)).to.equal(previewShares);
        expect(await strategy.convertToShares(altDeposit.address, net)).to.equal(previewShares);
        expect(await altDeposit.balanceOf(strategy.address)).to.equal(net);
        expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);

        rows.push({
          amount: Number(assets),
          feeBps: Number(arg.depositFeeBps),
          fee: Number(fee),
          net: Number(net)
        });
      });
    });

    args.forEach(arg => {
      it(`deposit with minSharesOut ${arg.name}`, async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, arg.depositFeeBps);
        const assets = arg.amount;
        await altDeposit.mint(sender.address, assets);
        await altDeposit.connect(sender).approve(strategy.address, assets);

        const fee = arg.depositFeeBps === 0n ? 0n : (assets * arg.depositFeeBps + 10_000n - 1n) / 10_000n;
        const net = assets - fee;

        const previewShares = await strategy.previewDeposit(altDeposit.address, assets);
        // prettier-ignore
        await expect(strategy.connect(sender)
          ['deposit(address,uint256,address,uint256)'](altDeposit.address, assets, sender.address,previewShares))
          .to.emit(strategy, 'Deposit')
          .withArgs(sender.address, sender.address, altDeposit.address, net, previewShares, fee);

        expect(await strategy.balanceOf(sender.address)).to.equal(previewShares);
        expect(await strategy.convertToShares(altDeposit.address, net)).to.equal(previewShares);
        expect(await altDeposit.balanceOf(strategy.address)).to.equal(net);
        expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
      });
    });

    args.forEach(arg => {
      it(`mint matches preview ${arg.name}`, async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, arg.depositFeeBps);
        const net = arg.amount;
        //divide with rounding up
        const amount = (net * 10_000n + (10_000n - arg.depositFeeBps) - 1n) / (10_000n - arg.depositFeeBps);
        const fee = amount - net;
        await altDeposit.mint(sender.address, amount);
        await altDeposit.connect(sender).approve(strategy.address, amount);

        const previewAssets = await strategy.previewMint(altDeposit.address, net);
        expect(previewAssets).to.be.equal(amount);
        // prettier-ignore
        await expect(strategy.connect(sender)['mint(address,uint256,address)'](altDeposit.address, net, sender.address))
          .to.emit(strategy, 'Deposit')
          .withArgs(sender.address, sender.address, altDeposit.address, net, net, fee);

        expect(await strategy.balanceOf(sender.address)).to.equal(net);
        expect(await altDeposit.balanceOf(strategy.address)).to.equal(net);
        expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
      });
    });

    it('reverts deposit for an unlisted asset', async function () {
      const v = await strategy.getAddress();

      const assets = 10_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, assets);
      await altDeposit.connect(sender).approve(v, assets);

      await expect(
        strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address)
      ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAmount');

      expect(await altDeposit.balanceOf(v)).to.equal(0n);
      expect(await strategy.balanceOf(sender.address)).to.equal(0n);
    });

    it('reverts deposit of a dust amount that rounds to zero shares', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 1);
      // prettier-ignore
      await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, 1n, sender.address))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAmount');
    });

    it('reverts deposit when shares are below minSharesOut', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      const assets = e18;
      await altDeposit.mint(sender.address, assets);
      await altDeposit.connect(sender).approve(strategy.address, assets);
      const previewShares = await strategy.previewDeposit(altDeposit.address, assets);
      // prettier-ignore
      await expect(strategy.connect(sender)['deposit(address,uint256,address,uint256)'](altDeposit.address, assets, sender.address, previewShares + 1n))
        .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_InsufficientSharesOut');
    });

    it('reverts mint when assets needed exceed maxAssetsIn', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      const shares = 5_000n * e18;
      const assetsNeeded = await strategy.previewMint(altDeposit.address, shares);
      // prettier-ignore
      await expect(strategy.connect(sender)['mint(address,uint256,address,uint256)'](altDeposit.address, shares, sender.address, assetsNeeded - 1n))
        .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_ExcessiveAssetsIn');
    });

    it('previewMint returns 0 for an unsupported asset', async function () {
      expect(await strategy.previewMint(altDeposit.address, e18)).to.equal(0n);
    });

    it('convertToShares returns 0 for an unsupported asset', async function () {
      expect(await strategy.convertToShares(altDeposit.address, e18)).to.equal(0n);
    });

    it('convertToAssets returns 0 for an unsupported asset', async function () {
      expect(await strategy.convertToAssets.staticCall(altDeposit.address, e18)).to.equal(0n);
    });
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

    const rows: { pps: string; shares: string; amount: string }[] = [];

    beforeEach(async function () {
      await snapshot.restore();
    });

    args.forEach(arg => {
      let row: { pps: string; shares: string; amount: string } = {
        pps: arg.pps.toString(),
        shares: '',
        amount: ''
      };
      it(`convertToShares ${arg.name}`, async () => {
        await strategy.connect(priceSetter).postPricePerShare(arg.pps, e18, false);

        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const amount = arg.amount;
        const sharesExpected = (amount * e18) / arg.pps;
        const shares = await strategy.convertToShares(altDeposit.address, amount);
        row.shares = shares.toString();
        expect(shares).to.equal(sharesExpected);
      });

      it(`convertToAssets ${arg.name}`, async () => {
        await strategy.connect(priceSetter).postPricePerShare(arg.pps, e18, false);

        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const amount = arg.amount;
        const expectedAssets = (amount * arg.pps) / e18;
        const assets = await strategy.convertToAssets.staticCall(altDeposit.address, amount);
        row.amount = assets.toString();
        expect(assets).to.equal(expectedAssets);
      });

      it(`deposit redeem roundtrip ${arg.name}`, async () => {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
        await strategy.connect(priceSetter).postPricePerShare(arg.pps, e18, false);
        if (await strategy.depositPaused()) {
          await strategy.connect(manager).unpauseDeposit();
        }
        if (await strategy.redeemPaused()) {
          await strategy.connect(manager).unpauseRedeem();
        }

        const depositAmt = arg.amount;
        await altDeposit.mint(sender.address, depositAmt);
        await altDeposit.connect(sender).approve(strategy.address, depositAmt);
        await strategy
          .connect(sender)
          ['deposit(address,uint256,address)'](altDeposit.address, depositAmt, sender.address);

        const shares = await strategy.balanceOf(sender.address);
        const sharesExpected = (depositAmt * e18) / arg.pps;
        expect(shares).to.equal(sharesExpected);

        const expectedAssets = (shares * arg.pps) / e18;
        const rid = 1n;
        const tx = await strategy.connect(sender).requestRedeem(shares, sender.address);

        // prettier-ignore
        await expect(tx)
          .to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, sender.address, sender.address, expectedAssets, shares, 0n);
        await expect(tx).to.changeTokenBalance(strategy, sender, -shares);
        const pending = await strategy.pendingRedeemRequest(rid);
        expect(pending.pendingShares).to.equal(shares);
        expect(pending.pendingAssets).to.equal(expectedAssets);
        expect(pending.owner).to.equal(sender.address);
        expect(await strategy.pendingAssetsOf(sender.address)).to.equal(expectedAssets);

        const balanceBefore = await underlying.balanceOf(sender.address);
        await underlying.mint(strategy.address, expectedAssets);
        await advanceTime(1);
        // prettier-ignore
        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
          .to.emit(strategy, 'RedeemRequestsFulfilled')
          .withArgs([rid]);
        const balanceAfter = await underlying.balanceOf(sender.address);
        expect(balanceAfter - balanceBefore).to.equal(expectedAssets);
      });

      rows.push(row);
    });

    after(function () {
      console.table(rows);
    });
  });

  describe('Request redeem', function () {
    const rows: { redeemShares: number; feeBps: number; fee: number; net: number }[] = [];

    const depositAmt = e18;
    beforeEach(async function () {
      await snapshot.restore();
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      await altDeposit.mint(sender.address, depositAmt);
      await altDeposit.connect(sender).approve(strategy.address, depositAmt);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, depositAmt, sender.address);
    });

    const args = [
      {
        name: 'amount = 11wei, fee = 5000',
        redeemShares: 11n,
        redeemFee: 5000n
      },
      {
        name: 'amount = e18, no fee',
        redeemShares: e18,
        redeemFee: 0n
      },
      {
        name: 'amount = e18, fee = 1',
        redeemShares: e18,
        redeemFee: 1n
      },
      {
        name: 'amount = 10001, fee = 1',
        redeemShares: 10001n,
        redeemFee: 1n
      },
      {
        name: 'amount = 10000, fee = 1',
        redeemShares: 10000n,
        redeemFee: 1n
      },
      {
        name: 'amount = 9999, fee = 1',
        redeemShares: 9999n,
        redeemFee: 1n
      },
      {
        name: 'amount = rnd(10^18), fee = rnd(999)',
        redeemShares: randomBigInt(17),
        redeemFee: randomBigInt(3)
      }
    ];

    args.forEach(arg => {
      it(`${arg.name}`, async function () {
        const redeemFee = arg.redeemFee;
        await strategy.connect(admin).setRedeemFeeBps(redeemFee);
        expect(await strategy.redeemFee()).to.be.equal(redeemFee);

        const shares = arg.redeemShares;
        const BPS = 10_000n;
        const feeShares = redeemFee === 0n ? 0n : (shares * redeemFee + BPS - 1n) / BPS;
        const netShares = shares - feeShares;
        const assetsOut = netShares;

        await underlying.mint(strategy.address, assetsOut + 1n);
        const beforeU = await underlying.balanceOf(sender.address);

        const tx = await strategy.connect(sender).requestRedeem(shares, sender.address);
        const rid = 1n;
        await expect(tx).to.changeTokenBalance(strategy, sender, -shares);
        await expect(tx).to.changeTokenBalance(strategy, treasury, feeShares);
        // prettier-ignore
        await expect(tx)
          .to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, sender.address, sender.address, assetsOut, netShares, feeShares);

        // Net shares are burned; fee shares are transferred to the treasury (not burned).
        expect(await strategy.balanceOf(sender.address)).to.equal(depositAmt - shares);
        expect(await strategy.totalSupply()).to.equal(depositAmt - netShares);
        const pending = await strategy.pendingRedeemRequest(rid);
        expect(pending.pendingShares).to.equal(netShares);
        expect(pending.pendingAssets).to.equal(assetsOut);
        expect(pending.owner).to.equal(sender.address);
        const [totalPendingShares, totalPendingAssets] = await strategy.totalPending();
        expect(totalPendingShares).to.equal(netShares);
        expect(totalPendingAssets).to.equal(assetsOut);
        expect(await strategy.balanceOf(treasury.address)).to.equal(feeShares);

        await advanceTime(1);
        // prettier-ignore
        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
          .to.emit(strategy, 'Redeem')
          .withArgs(redeemOperator.address, sender.address, assetsOut, netShares)
          .and.to.emit(strategy, 'RedeemRequestsFulfilled')
          .withArgs([rid]);
        if (feeShares > 0) {
          expect(await strategy.balanceOf(treasury.address)).to.equal(feeShares);
        }

        const afterU = await underlying.balanceOf(sender.address);
        expect(afterU - beforeU).to.equal(assetsOut);

        rows.push({
          redeemShares: Number(shares),
          feeBps: Number(redeemFee),
          fee: Number(feeShares),
          net: Number(netShares)
        });
      });
    });

    after(function () {
      console.table(rows);
    });

    it('requestRedeem can be called on behalf of owner with allowance', async function () {
      const shares = await strategy.balanceOf(sender.address);
      await strategy.connect(sender).approve(receiver.address, shares);
      const rid = 1n;
      // prettier-ignore
      await expect(strategy.connect(receiver).requestRedeem(shares, sender.address))
        .to.emit(strategy, 'RedeemRequested')
        .withArgs(rid, sender.address, receiver.address, shares, shares, 0n);
      expect(await strategy.balanceOf(sender.address)).to.equal(0n);
    });

    it('requestRedeem reverts when fee shares consume the whole request', async function () {
      await strategy.connect(admin).setRedeemFeeBps(1);
      // prettier-ignore
      await expect(strategy.connect(sender).requestRedeem(1n, sender.address))
        .to.be.revertedWithCustomError(strategy, 'AsyncRedemption_FeeSharesGreaterThanShares');
    });

    it('requestRedeem reverts when net shares convert to zero assets', async function () {
      await strategy.connect(priceSetter).postPricePerShare(e18 - 1n, e18, false);
      await strategy.connect(manager).unpauseRedeem();
      // prettier-ignore
      await expect(strategy.connect(sender).requestRedeem(1n, sender.address))
        .to.be.revertedWithCustomError(strategy, 'AsyncRedemption_ZeroAssets');
    });

    it('fulfillRedeemRequests: reverts when strategy holds no underlying for the redeemed shares', async function () {
      const shares = await strategy.balanceOf(sender.address);
      const rid = 1n;
      await strategy.connect(sender).requestRedeem(shares, sender.address);
      expect(await strategy.balanceOf(sender.address)).to.equal(0n);
      const [pendingShares] = await strategy.totalPending();
      expect(pendingShares).to.equal(shares);

      await advanceTime(1);
      // Strategy holds no underlying — fulfillment must revert (transfer fails).
      await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid])).to.be.reverted;
    });

    it('fulfillRedeemRequests reverts for a caller without PAY_REDEMPTIONS_ROLE', async function () {
      // prettier-ignore
      await expect(strategy.connect(sender).fulfillRedeemRequests([1n]))
        .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount');
    });

    it('fulfillRedeemRequests reverts when fulfilled in the request block', async function () {
      const shares = await strategy.balanceOf(sender.address);
      const rid = 1n;
      const receipt = await (await strategy.connect(sender).requestRedeem(shares, sender.address)).wait();
      // Replaying the fulfillment at the request's own block makes block.number == requestBlock.
      // prettier-ignore
      await expect(strategy.connect(redeemOperator).fulfillRedeemRequests.staticCall([rid], { blockTag: receipt!.blockNumber }))
        .to.be.revertedWithCustomError(strategy, 'AsyncRedemption_FulfillTooEarly');
    });
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

    beforeEach(async function () {
      await snapshot.restore();
    });

    args.forEach((arg, i) => {
      it(`${arg.name}`, async function () {
        await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

        const performanceFeeBps = arg.performanceFeeBps;
        await strategy.connect(admin).setPerformanceFeeBps(performanceFeeBps, treasury.address, true);

        const depositAmt = arg.supply;
        await altDeposit.mint(sender.address, depositAmt);
        await altDeposit.connect(sender).approve(strategy.address, depositAmt);
        await strategy
          .connect(sender)
          ['deposit(address,uint256,address)'](altDeposit.address, depositAmt, sender.address);

        const defaultRate = await strategy.pricePerShare();
        const newRate = arg.newRate(defaultRate);

        if (newRate !== defaultRate) {
          const supplyAtSnapshot = await strategy.totalSupply();
          const navAtSnapshot = (newRate * supplyAtSnapshot) / e18;
          await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);
          if (await strategy.depositPaused()) {
            await strategy.connect(manager).unpauseDeposit();
          }
          if (await strategy.redeemPaused()) {
            await strategy.connect(manager).unpauseRedeem();
          }
        }

        const supplyBefore = await strategy.totalSupply();
        const expectedShares = arg.expectedShares(supplyBefore, defaultRate, newRate, performanceFeeBps);
        const tx = await strategy.connect(perfFeeClaimer).harvestPerformanceFee(treasury.address);

        const supplyAfter = await strategy.totalSupply();
        rows.push({
          name: arg.name,
          rateDiff: Number(newRate - defaultRate),
          fee: Number(performanceFeeBps),
          mintedShares: Number(supplyAfter - supplyBefore)
        });

        if (expectedShares > 0n) {
          // prettier-ignore
          await expect(tx)
            .to.emit(strategy, 'PerformanceFeeHarvested')
            .withArgs(treasury.address, expectedShares, defaultRate, newRate);
        } else {
          await expect(tx).to.not.emit(strategy, 'PerformanceFeeHarvested');
        }
        expect(supplyAfter - supplyBefore).to.be.eq(expectedShares);
        expect(await strategy.pricePerShare()).to.equal(newRate);

        await strategy.connect(perfFeeClaimer).harvestPerformanceFee(treasury.address);
        expect(await strategy.totalSupply()).to.be.eq(supplyAfter);
      });
    });

    it('harvestPerformanceFee reverts for a caller without PERF_FEE_CLAIM_ROLE', async function () {
      // prettier-ignore
      await expect(strategy.connect(sender).harvestPerformanceFee(treasury.address))
        .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount');
    });

    after(function () {
      console.table(rows);
    });
  });

  describe('postPricePerShare reconciliation', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('reconciles down for mid-epoch deposit (frontrun protection)', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      const supplyAtSnapshot = await strategy.totalSupply();
      expect(supplyAtSnapshot).to.equal(baseDeposit);
      expect(await strategy.pricePerShare()).to.equal(e18);

      // Operator off-chain: NAV = 101, supply = 100 → declared PPS = 1.01.
      const navAtSnapshot = 101n * e18;

      // Frontrun: 50-asset deposit at the still-stored PPS = 1.0 mints 50 shares before the post lands.
      const frontrunAmt = 50n * e18;
      await altDeposit.mint(sender.address, frontrunAmt);
      await altDeposit.connect(sender).approve(strategy.address, frontrunAmt);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, frontrunAmt, sender.address);

      expect(await strategy.totalSupply()).to.equal(150n * e18);
      expect(await strategy.pricePerShare()).to.equal(e18);

      // Post: reconciledNav = 101 + 50 * 1.0 = 151, stored PPS = 151/150 (Floor) — not the declared 1.01.
      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      const expectedPPS = (151n * e18) / 150n;
      const declaredPPS = (101n * e18) / 100n;
      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
      expect(await strategy.pricePerShare()).to.be.lessThan(declaredPPS);

      // totalAssets() matches real backing (151), modulo Floor truncation in the round-trip.
      expect(await strategy.totalAssets()).to.equal((150n * e18 * expectedPPS) / e18);
    });

    it('keeps effective supply unchanged for mid-epoch redeem request (pending shares included)', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      // Operator snapshots effective supply (= totalSupply + totalPendingShares). Pending is 0 here.
      const supplyAtSnapshot = await strategy.totalSupply();

      // Operator snapshot: NAV = 101, supply = 100 → declared PPS = 1.01.
      const navAtSnapshot = 101n * e18;

      // Mid-epoch redeem request burns 30 net shares; live totalSupply drops to 70, but pending keeps
      // them in effective supply (70 + 30 = 100), so reconciliation sees no supply change.
      const redeemShares = 30n * e18;
      await strategy.connect(sender).requestRedeem(redeemShares, sender.address);
      expect(await strategy.totalSupply()).to.equal(70n * e18);
      const [pendingShares] = await strategy.totalPending();
      expect(pendingShares).to.equal(redeemShares);

      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      const expectedPPS = (101n * e18) / 100n;
      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
      // totalAssets() reports only active-share backing; pending fraction stays reserved for redeemers.
      expect(await strategy.totalAssets()).to.equal((70n * e18 * expectedPPS) / e18);
    });

    it('does not concentrate a NAV loss onto residual active supply while redeem requests are pending', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await strategy.connect(manager).setPricePerShareRateLimit(1_000_000, 0);

      const victim = sender;
      const attacker = receiver;

      const victimDeposit = 900n * e18;
      const attackerDeposit = 100n * e18;
      const LOSS = 10n * e18;

      // deposit
      await altDeposit.mint(victim.address, victimDeposit);
      await altDeposit.mint(attacker.address, attackerDeposit);

      await altDeposit.connect(victim).approve(strategy.address, victimDeposit);
      await altDeposit.connect(attacker).approve(strategy.address, victimDeposit);
      await strategy
        .connect(victim)
        ['deposit(address,uint256,address)'](altDeposit.address, victimDeposit, victim.address);
      await strategy
        .connect(attacker)
        ['deposit(address,uint256,address)'](altDeposit.address, attackerDeposit, attacker.address);

      const victimShares = await strategy.balanceOf(victim.address);
      const attackerShares = await strategy.balanceOf(attacker.address);

      // redeem all & capture snapshot in between
      await strategy.connect(victim).requestRedeem(victimShares, victim.address);

      const effectiveSupplyAtSnapshot = (await strategy.totalSupply()) + (await strategy.totalPending())[0];
      const navAtSnapshot = victimDeposit + attackerDeposit - LOSS;

      await strategy.connect(attacker).requestRedeem(attackerShares, attacker.address);

      // check PPS
      const expectedPPS = (navAtSnapshot * e18) / effectiveSupplyAtSnapshot;
      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, effectiveSupplyAtSnapshot, true);

      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
    });

    it('pending-share inclusion prevents loss-concentration attack via residual deposit', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await strategy.connect(manager).setPricePerShareRateLimit(1_000_000, 0);

      // Scaled-down form of the async-redemption PPS-crater attack:
      // large pending redeem + small residual + mid-epoch deposit into residual + honest NAV loss post.
      const victimShares = 900n * e18;
      const attackerInitShares = 50n * e18;
      const otherShares = 50n * e18;
      const attackerDeposit = 40n * e18;
      const loss = 10n * e18; // real NAV loss shared across effective supply

      const supplyAtSnapshot = victimShares + attackerInitShares + otherShares;
      const navAtSnapshot = supplyAtSnapshot - loss;
      const activeAfterAttackDeposit = otherShares + attackerDeposit;
      const pendingShares = victimShares + attackerInitShares;

      await altDeposit.mint(sender.address, victimShares + otherShares);
      await altDeposit.mint(receiver.address, attackerInitShares + attackerDeposit);
      await altDeposit.connect(sender).approve(strategy.address, victimShares + otherShares);
      await altDeposit.connect(receiver).approve(strategy.address, attackerInitShares + attackerDeposit);

      const attackerDepBefore = await altDeposit.balanceOf(receiver.address);
      const attackerUndBefore = await underlying.balanceOf(receiver.address);
      const victimUndBefore = await underlying.balanceOf(sender.address);

      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, victimShares + otherShares, sender.address);
      await strategy
        .connect(receiver)
        ['deposit(address,uint256,address)'](altDeposit.address, attackerInitShares, receiver.address);
      expect(await strategy.totalSupply()).to.equal(supplyAtSnapshot);

      await strategy.connect(sender).requestRedeem(victimShares, sender.address);
      const victimPayoutExpected = await strategy.convertToAssets(altDeposit.address, victimShares);
      await strategy.connect(receiver).requestRedeem(attackerInitShares, receiver.address);
      expect(await strategy.totalSupply()).to.equal(otherShares);

      await strategy
        .connect(receiver)
        ['deposit(address,uint256,address)'](altDeposit.address, attackerDeposit, receiver.address);
      expect(await strategy.totalSupply()).to.equal(activeAfterAttackDeposit);

      // Vulnerable reconciliation (pending excluded) would crater PPS over the residual active supply.
      const vulnerableSharesRemoved = supplyAtSnapshot - activeAfterAttackDeposit;
      const vulnerableReconciledNav = navAtSnapshot - vulnerableSharesRemoved;
      const craterPPS = (vulnerableReconciledNav * e18) / activeAfterAttackDeposit;
      expect(craterPPS).to.equal((80n * e18) / 90n); // 80 residual NAV / 90 active shares

      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true);

      const effectiveSupplyNow = activeAfterAttackDeposit + pendingShares;
      // Reconcile mid-epoch deposit at stale PPS=1: (navAtSnapshot + attackerDeposit) / effectiveSupplyNow.
      const expectedPPS = ((navAtSnapshot + attackerDeposit) * e18) / effectiveSupplyNow;
      expect(expectedPPS).to.equal((1030n * e18) / 1040n);
      const ppsAfterPost = await strategy.pricePerShare();
      expect(ppsAfterPost).to.equal(expectedPPS);

      const victimPayout = await strategy.convertToAssets(altDeposit.address, victimShares);
      expect(victimPayout).to.be.lessThan(victimPayoutExpected);
      const oldPayout = (attackerInitShares * expectedPPS) / e18;
      await underlying.mint(strategy.address, victimPayout + oldPayout);
      await advanceTime(1);
      await strategy.connect(redeemOperator).fulfillRedeemRequests([1n, 2n]);

      const victimPaid = (await underlying.balanceOf(sender.address)) - victimUndBefore;
      // Snapshot pro-rata fair claim: 900/1000 of NAV 990.
      const victimFairClaim = (victimShares * navAtSnapshot) / supplyAtSnapshot;
      expect(victimFairClaim).to.equal(891n * e18);
      expect(victimPaid).to.eq(victimPayout);
      // Anti-dilution invariant: the redeeming victim is never paid below their snapshot pro-rata claim.
      expect(victimPaid).to.be.gte(victimFairClaim);
      // Here strictly above it — reconciled PPS (1030/1040) > snapshot PPS (990/1000). The exact
      // over-payment (in wei) is the characterization for these specific inputs.
      expect(victimPaid - victimFairClaim).to.equal(346153846153845600n);

      // Residual NAV after fair payout; corrective post over remaining active supply.
      const residualNav = navAtSnapshot + attackerDeposit - victimPayout - oldPayout;
      const expectedResidualPPS = (residualNav * e18) / activeAfterAttackDeposit;
      await strategy.connect(priceSetter).postPricePerShare(residualNav, activeAfterAttackDeposit, false);
      expect(await strategy.pricePerShare()).to.equal(expectedResidualPPS);
      if (await strategy.depositPaused()) await strategy.connect(manager).unpauseDeposit();
      if (await strategy.redeemPaused()) await strategy.connect(manager).unpauseRedeem();

      await strategy.connect(receiver).requestRedeem(attackerDeposit, receiver.address);
      const attackerPending = await strategy.pendingAssetsOf(receiver.address);
      const expectedAttackerPending = (attackerDeposit * expectedResidualPPS) / e18;
      expect(attackerPending).to.equal(expectedAttackerPending);
      // min(pending@request, shares×PPS) — both legs equal at the just-posted residual PPS.
      const payout2 = expectedAttackerPending;
      await underlying.mint(strategy.address, payout2);
      await advanceTime(1);
      await strategy.connect(redeemOperator).fulfillRedeemRequests([3n]);

      const attackerSpent = attackerDepBefore - (await altDeposit.balanceOf(receiver.address));
      const attackerReceived = (await underlying.balanceOf(receiver.address)) - attackerUndBefore;
      const attackerProfit = attackerReceived - attackerSpent;
      expect(attackerSpent).to.equal(attackerInitShares + attackerDeposit);
      expect(attackerReceived).to.equal(oldPayout + payout2);
      // Security invariant: the residual-deposit maneuver is never profitable — the attacker bears (not
      // sheds) their pro-rata share of the NAV loss. Under the vulnerable reconciliation, cratering the
      // residual PPS would have let the attacker's post-loss exit dump the loss onto the remaining holders.
      expect(attackerProfit).to.be.lessThan(0n);
    });

    it('reconciles a mid-epoch fulfillment as removed supply (conservative Ceil rounding)', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await strategy.connect(manager).setPricePerShareRateLimit(3_000_000, 0);

      // Seed 3 shares, then post a deliberately fractional PPS = 10/3 so the removed-supply term is not a
      // whole number of asset wei and the Ceil rounding is observable.
      const baseDeposit = 3n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      const navAtSnapshot = 10n * e18;
      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, baseDeposit, false);
      const pps = await strategy.pricePerShare();
      expect(pps).to.equal((10n * e18) / 3n); // 3.333...e18, floored

      // Mid-epoch redeem request burns shares into pending — effective supply is unchanged (net-zero).
      // The odd +1 wei keeps sharesRemoved off a whole-share boundary so Ceil ≠ Floor below.
      const redeemShares = 1n * e18 + 1n;
      await strategy.connect(sender).requestRedeem(redeemShares, sender.address);
      const effectiveSupplyAtSnapshot = (await strategy.totalSupply()) + (await strategy.totalPending())[0];
      expect(effectiveSupplyAtSnapshot).to.equal(baseDeposit);

      // Fulfill the request BEFORE the post → pending shares drop to 0, so effective supply falls to the
      // live shares. This is the only way effective supply shrinks between snapshot and post, and it drives
      // the removed-supply branch of reconciliation.
      const payout = await strategy.pendingAssetsOf(sender.address);
      await underlying.mint(strategy.address, payout);
      await advanceTime(1);
      await strategy.connect(redeemOperator).fulfillRedeemRequests([1n]);

      const effectiveSupplyNow = (await strategy.totalSupply()) + (await strategy.totalPending())[0];
      expect(effectiveSupplyNow).to.equal(baseDeposit - redeemShares);

      // Mirror the contract: reconciledNav = nav - ceil(sharesRemoved * pps / 1e18);
      //                      priceToSet    = floor(reconciledNav * 1e18 / effectiveSupplyNow).
      const sharesRemoved = effectiveSupplyAtSnapshot - effectiveSupplyNow;
      const removedFloor = (sharesRemoved * pps) / e18;
      const removedCeil = (sharesRemoved * pps + (e18 - 1n)) / e18;
      // Ceil is active at NAV granularity: it rounds the removed backing UP by 1 wei vs Floor, which is
      // solvency-favouring (never credits the remaining shares with backing that left). The 1-wei NAV
      // delta washes out in the floored PPS at this scale, so the stored price is never ABOVE the Floor
      // variant — that direction is the invariant we assert.
      expect(removedCeil).to.equal(removedFloor + 1n);
      const expectedPPS = ((navAtSnapshot - removedCeil) * e18) / effectiveSupplyNow;
      const expectedPPSIfFloor = ((navAtSnapshot - removedFloor) * e18) / effectiveSupplyNow;
      expect(expectedPPS).to.be.lte(expectedPPSIfFloor);

      // Declared PPS equals the still-stored PPS (nav/effSupply unchanged from the first post) → 0% move,
      // so the rate limiter is a no-op and the reconciled removed-supply price is what gets stored.
      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, effectiveSupplyAtSnapshot, false);
      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
    });

    it('postPricePerShare reverts when the strategy is paused', async function () {
      await strategy.connect(transfersPauser).pause();
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(e18, e18, false))
        .to.be.revertedWithCustomError(strategy, 'EnforcedPause');
    });

    it('postPricePerShare reverts when deposit and redeem are paused', async function () {
      await strategy.connect(pauser).pauseDeposit();
      await strategy.connect(pauser).pauseRedeem();
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(e18, e18, false))
        .to.be.revertedWithCustomError(strategy, 'Strategy_PricePerSharePaused');
    });

    it('postPricePerShare reverts when navAtSnapshot is zero', async function () {
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(0n, e18, false))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroNavAtSnapshot');
    });

    it('postPricePerShare reverts when effectiveSupplyAtSnapshot is zero', async function () {
      // A stale operator posting a zero effective supply (e.g. omitting pending shares on an empty active
      // book) must revert rather than divide by zero when computing the declared PPS.
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(e18, 0n, false))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroSharesAtSnapshot');
    });
  });

  describe('price-per-share rate limit', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('setPricePerShareRateLimit requires MANAGER_ROLE', async function () {
      // prettier-ignore
      await expect(strategy.connect(sender).setPricePerShareRateLimit(500, 1n))
        .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount');
      // prettier-ignore
      await expect(strategy.connect(priceSetter).setPricePerShareRateLimit(500, 1n))
        .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount');
    });

    it('2.5% yearly allowed change with weekly bucket', async function () {
      // 2.5%/yr = 2_5000 bps/yr ÷ 52 weeks ≈ 500 bps/week
      const maxBps = 500;
      const weekSeconds = 604800n;
      // refillRate fills the full bucket in exactly one week: ceil(maxBps * 2^32 / weekSeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await strategy.connect(manager).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      // +0.05% (500 bps) — consumes the entire weekly budget
      const p1 = (p0 * 10005n) / 10000n;
      await expect(strategy.connect(priceSetter).postPricePerShare(p1, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);

      // Any further move is blocked until the bucket refills
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(p1 + 1n, e18, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded');

      // After one week the bucket is full again
      await ethers.provider.send('evm_increaseTime', [604800]);
      await ethers.provider.send('evm_mine', []);

      const p2 = (p1 * 10005n) / 10000n;
      await expect(strategy.connect(priceSetter).postPricePerShare(p2, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
    });

    it('soft overflow: applies price, drains bucket, and pauses deposit and redeem', async function () {
      const maxBps = 500;
      const weekSeconds = 604800n;
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await strategy.connect(manager).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      const p1 = (p0 * 10005n) / 10000n;
      await strategy.connect(priceSetter).postPricePerShare(p1, e18, true);

      const tinyBump = p1 + 1n;
      await expect(strategy.connect(priceSetter).postPricePerShare(tinyBump, e18, false)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect(await strategy.depositPaused()).to.be.true;
      expect(await strategy.redeemPaused()).to.be.true;
      expect(await strategy.pricePerShare()).to.equal(tinyBump);
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);
    });

    it('50% yearly allowed change with daily bucket', async function () {
      // 50%/yr = 500000 bps/yr ÷ 365 days ≈ 1400 bps/day
      const maxBps = 1400;
      const daySeconds = 86400n;
      // refillRate fills the full bucket in exactly one day: ceil(maxBps * 2^32 / daySeconds)
      const refillRate = (BigInt(maxBps) * 2n ** 32n + daySeconds - 1n) / daySeconds;

      await strategy.connect(manager).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      // +0.13% (1300 bps) — within daily budget, leaving 100 bps
      const p1 = (p0 * 10013n) / 10000n;
      await expect(strategy.connect(priceSetter).postPricePerShare(p1, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(100n);

      // 2 bps exceeds the 1 bps remaining in the bucket
      const p2 = (p1 * 10002n) / 10000n;
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(p2, e18, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded');

      // After one day the bucket is full again
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);

      const p3 = (p1 * 10013n) / 10000n;
      await expect(strategy.connect(priceSetter).postPricePerShare(p3, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
    });

    it('gates on the declared NAV move, not the reconciled move (mid-epoch mint cannot mask a swing)', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      const supplyAtSnapshot = await strategy.totalSupply();
      expect(supplyAtSnapshot).to.equal(baseDeposit);

      // Bucket allows a +60% move (600_000 micro-bps); refillRate 0 keeps it full for the test.
      await strategy.connect(manager).setPricePerShareRateLimit(600_000, 0);

      // Frontrun: mint 100 more shares at the stale PPS = 1.0 before the post lands → supply doubles to 200.
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);
      expect(await strategy.totalSupply()).to.equal(200n * e18);

      // Operator declares NAV = 200 for the 100 snapshot shares → declared PPS = 2.0, a +100% move.
      // The reconciled move is only +50% (priceToSet = 300/200 = 1.5), which would slip under the 60% cap.
      // The limiter must measure the declared +100% (1_000_000 micro-bps) and reject it.
      const navAtSnapshot = 200n * e18;
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded')
        .withArgs(1_000_000n, 600_000n);
    });

    it('consumes the declared move from the bucket but stores the reconciled price', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a +150% move (1_500_000 micro-bps), so the declared +100% clears it; refillRate 0.
      await strategy.connect(manager).setPricePerShareRateLimit(1_500_000, 0);

      // Frontrun mint at stale PPS → supply 200.
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      // Declared PPS = 2.0 (+100%); reconciled priceToSet = 300/200 = 1.5.
      const navAtSnapshot = 200n * e18;
      await expect(strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );

      // Stored price is the reconciled 1.5, but the bucket was drained by the declared +100% (1_000_000),
      // not the reconciled +50% — leaving 1_500_000 - 1_000_000 = 500_000 of capacity.
      expect(await strategy.pricePerShare()).to.equal((3n * e18) / 2n);
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(500_000n);
    });

    it('pauses on a declared NAV decrease masked by a mid-epoch deposit (soft overflow)', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a -40% move (400_000 micro-bps); refillRate 0.
      await strategy.connect(manager).setPricePerShareRateLimit(400_000, 0);

      // Frontrun: deposit 100 more at the stale PPS = 1.0 → supply 200. Depositing at the (now too-high)
      // stale PPS props the reconciled NAV up and shrinks the apparent loss.
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);

      // Operator declares NAV = 50 for the 100 snapshot shares → declared PPS = 0.5, a -50% move (500_000).
      // Reconciled priceToSet = 150/200 = 0.75, only a -25% move — under the 40% cap. The limiter must
      // measure the declared -50%, exhaust the bucket, store the reconciled 0.75, and pause both paths.
      const navAtSnapshot = 50n * e18;
      await strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      expect(await strategy.pricePerShare()).to.equal((3n * e18) / 4n);
      expect(await strategy.depositPaused()).to.be.true;
      expect(await strategy.redeemPaused()).to.be.true;
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);
    });

    it('rejects a declared NAV decrease on the declared move even when a redemption amplifies it', async function () {
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(sender.address, baseDeposit);
      await altDeposit.connect(sender).approve(strategy.address, baseDeposit);
      await strategy
        .connect(sender)
        ['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, sender.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a -55% move (550_000 micro-bps); refillRate 0.
      await strategy.connect(manager).setPricePerShareRateLimit(550_000, 0);

      // Mid-epoch redeem request burns 30 net shares immediately; live supply drops to 70.
      await strategy.connect(sender).requestRedeem(30n * e18, sender.address);
      expect(await strategy.totalSupply()).to.equal(70n * e18);

      // Operator declares NAV = 40 for the 100 snapshot shares → declared PPS = 0.4, a -60% move (600_000).
      // Reconciled priceToSet = (40 - 30)/70 ≈ 0.143, a steeper ~-85.7% move. Either move trips the 55% cap,
      // but the limiter must report the *declared* 600_000 (not the reconciled ~857_143) as the requested move.
      const navAtSnapshot = 40n * e18;
      // prettier-ignore
      await expect(strategy.connect(priceSetter).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded')
        .withArgs(600_000n, 550_000n);
    });
  });

  describe('Management fee', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('accrues management fee on deposit and mints fee shares to management fee treasury', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 0);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

      const firstDeposit = 2_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, firstDeposit * 2n);
      await altDeposit.connect(sender).approve(v, firstDeposit * 2n);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const treasuryBefore = await strategy.balanceOf(treasury.address);
      const tx = await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsedSeconds = BigInt(block!.timestamp) - BigInt(lastHarvest);
      const expectedFeeShares = expectedManagementFeeShares(supplyBefore, elapsedSeconds);
      expect(expectedFeeShares).to.be.gt(0n);
      const treasuryAfter = await strategy.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFeeShares);
    });

    it('accrues management fee on mint and mints fee shares to management fee treasury', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 0);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

      const firstDeposit = 2_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, firstDeposit * 2n);
      await altDeposit.connect(sender).approve(v, firstDeposit * 2n);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const targetShares = 500n * 10n ** 18n;
      const requiredAssets = await strategy.previewMint(alt, targetShares);
      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const treasuryBefore = await strategy.balanceOf(treasury.address);
      const tx = await strategy
        .connect(sender)
        ['mint(address,uint256,address,uint256)'](alt, targetShares, sender.address, requiredAssets);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsedSeconds = BigInt(block!.timestamp) - BigInt(lastHarvest);
      const expectedFeeShares = expectedManagementFeeShares(supplyBefore, elapsedSeconds);
      expect(expectedFeeShares).to.be.gt(0n);
      const treasuryAfter = await strategy.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFeeShares);
    });

    it('accrues management fee on requestRedeem before locking user shares', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 0);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

      const depositAmt = 2_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, depositAmt);
      await altDeposit.connect(sender).approve(v, depositAmt);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, depositAmt, sender.address);

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const userShares = await strategy.balanceOf(sender.address);
      const redeemShares = userShares / 2n;
      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const treasuryBefore = await strategy.balanceOf(treasury.address);
      const tx = await strategy.connect(sender).requestRedeem(redeemShares, sender.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsedSeconds = BigInt(block!.timestamp) - BigInt(lastHarvest);
      const expectedFeeShares = expectedManagementFeeShares(supplyBefore, elapsedSeconds);
      expect(expectedFeeShares).to.be.gt(0n);
      const treasuryAfter = await strategy.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFeeShares);
    });

    it('keeps feeTreasury and managementFeeTreasury separated on flow fees and management accrual', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      const managementTreasury = ethers.Wallet.createRandom().address;
      await strategy.connect(manager).setManagementFeeTreasury(managementTreasury);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 100); // 1%

      const depositAmt = 10_000n * 10n ** 18n;
      const depositFee = (depositAmt * 100n) / 10_000n;
      await altDeposit.mint(sender.address, depositAmt * 2n);
      await altDeposit.connect(sender).approve(v, depositAmt * 2n);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, depositAmt, sender.address);

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const feeTreasuryAssetBefore = await altDeposit.balanceOf(treasury.address);
      const mgmtTreasurySharesBefore = await strategy.balanceOf(managementTreasury);
      const tx = await strategy.connect(sender)['deposit(address,uint256,address)'](alt, depositAmt, sender.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsedSeconds = BigInt(block!.timestamp) - BigInt(lastHarvest);
      const expectedFeeShares = expectedManagementFeeShares(supplyBefore, elapsedSeconds);
      const feeTreasuryAssetAfter = await altDeposit.balanceOf(treasury.address);
      const mgmtTreasurySharesAfter = await strategy.balanceOf(managementTreasury);
      const feeTreasuryShares = await strategy.balanceOf(treasury.address);

      expect(feeTreasuryAssetAfter - feeTreasuryAssetBefore).to.equal(depositFee);
      expect(feeTreasuryAssetAfter).to.equal(depositFee * 2n);
      expect(mgmtTreasurySharesAfter - mgmtTreasurySharesBefore).to.equal(expectedFeeShares);
      expect(feeTreasuryShares).to.equal(0n);
    });

    it('grosses up management fee shares so the treasury owns the configured fraction of post-mint supply', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 0);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

      const firstDeposit = 2_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, firstDeposit * 2n);
      await altDeposit.connect(sender).approve(v, firstDeposit * 2n);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);

      await ethers.provider.send('evm_increaseTime', [30 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const treasuryBefore = await strategy.balanceOf(treasury.address);
      const tx = await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsed = BigInt(block!.timestamp) - BigInt(lastHarvest);

      const minted = (await strategy.balanceOf(treasury.address)) - treasuryBefore;
      const num = MGMT_FEE_BPS * elapsed;
      const den = BPS_DENOMINATOR * SECONDS_PER_YEAR;

      // Grossed up amount, and strictly more than the old (buggy) naive mint that under-collected.
      const naive = (supplyBefore * num) / den;
      expect(minted).to.equal((supplyBefore * num) / (den - num));
      expect(minted).to.be.gt(naive);

      // Post-mint ownership fraction equals f = num/den (within one share of flooring), NOT f/(1+f).
      const postSupply = supplyBefore + minted;
      // minted/postSupply >= num/den  and  < num/den rounded up by one share:
      expect(minted * den).to.be.gte(num * postSupply - den);
      expect(minted * den).to.be.lt(num * postSupply + den);
    });

    it('charges the full elapsed interval on multi-year dormancy (no cap)', async function () {
      const alt = await altDeposit.getAddress();
      const v = await strategy.getAddress();
      await strategy.connect(manager).addDepositAsset(alt, await directConverter.getAddress(), 0);
      await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

      const firstDeposit = 2_000n * 10n ** 18n;
      await altDeposit.mint(sender.address, firstDeposit * 2n);
      await altDeposit.connect(sender).approve(v, firstDeposit * 2n);
      await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);

      // Three years of dormancy: at 10%/yr the gross-up stays well below 100% (num/den = 0.3), so no revert,
      // and the full ~3y interval is charged rather than being capped to one year.
      await ethers.provider.send('evm_increaseTime', [3 * 365 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);

      const supplyBefore = await strategy.totalSupply();
      const [, lastHarvest] = await strategy.managementFee();
      const treasuryBefore = await strategy.balanceOf(treasury.address);
      const tx = await strategy.connect(sender)['deposit(address,uint256,address)'](alt, firstDeposit, sender.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const elapsed = BigInt(block!.timestamp) - BigInt(lastHarvest);
      const minted = (await strategy.balanceOf(treasury.address)) - treasuryBefore;

      // Charged over the true (~3y) interval — and strictly more than a one-year charge would mint.
      const den = BPS_DENOMINATOR * SECONDS_PER_YEAR;
      const num = MGMT_FEE_BPS * elapsed;
      expect(elapsed).to.be.gt(SECONDS_PER_YEAR);
      expect(minted).to.equal((supplyBefore * num) / (den - num));
      const oneYearNum = MGMT_FEE_BPS * SECONDS_PER_YEAR;
      expect(minted).to.be.gt((supplyBefore * oneYearNum) / (den - oneYearNum));
    });
  });

  describe('Default shard routing', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('optional defaultShard forwards net deposit tokens to a registered address', async function () {
      const sink = ethers.Wallet.createRandom().address;

      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await strategy.connect(admin).registerShard(sink);
      // prettier-ignore
      await expect(strategy.connect(manager).setDefaultShard(sink))
        .to.emit(strategy, 'DefaultShardSet')
        .withArgs(sink, manager.address);

      expect(await strategy.defaultShard()).to.equal(sink);

      const assets = 10_000n * e18;
      await altDeposit.mint(sender.address, assets);
      await altDeposit.connect(sender).approve(strategy.address, assets);

      // prettier-ignore
      await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address))
        .to.emit(strategy, 'DepositRoutedToDefaultShard')
        .withArgs(sink, altDeposit.address, assets);

      expect(await altDeposit.balanceOf(sink)).to.equal(assets);
      expect(await altDeposit.balanceOf(strategy.address)).to.equal(0n);
    });

    it('defaultShard forwards net only; deposit fee transfers immediately to treasury', async function () {
      const sink = ethers.Wallet.createRandom().address;

      const depositFeeBps = 100n; // 1%
      await strategy.connect(manager).addDepositAsset(altDeposit.address, directConverter.address, depositFeeBps);
      await strategy.connect(admin).registerShard(sink);
      await strategy.connect(manager).setDefaultShard(sink);

      const assets = 10_000n * e18;
      const fee = (assets * depositFeeBps) / 10_000n;
      const net = assets - fee;

      await altDeposit.mint(sender.address, assets);
      await altDeposit.connect(sender).approve(strategy.address, assets);

      // prettier-ignore
      await expect(strategy.connect(sender)['deposit(address,uint256,address)'](altDeposit.address, assets, sender.address))
        .to.emit(strategy, 'DepositRoutedToDefaultShard')
        .withArgs(sink, altDeposit.address, net)
        .and
        .to.emit(strategy, 'DepositFeeTransferred')
        .withArgs(altDeposit.address, treasury.address, fee);

      expect(await altDeposit.balanceOf(sink)).to.equal(net);
      expect(await altDeposit.balanceOf(treasury.address)).to.equal(fee);
      expect(await altDeposit.balanceOf(strategy.address)).to.equal(0n);
    });
  });

  describe('requestFunding', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    const amount = 10n * e18;

    it('registered shard can pull funds', async function () {
      // `receiver` acts as the shard: it must be a real signer so it can call requestFunding.
      await strategy.connect(admin).registerShard(receiver.address);
      await altDeposit.mint(strategy.address, amount);
      // prettier-ignore
      await expect(strategy.connect(receiver).requestFunding(altDeposit.address, amount))
        .to.emit(strategy, 'FundingRequested')
        .withArgs(receiver.address, altDeposit.address, amount);
      expect(await altDeposit.balanceOf(receiver.address)).to.equal(amount);
      expect(await altDeposit.balanceOf(strategy.address)).to.equal(0n);
    });

    it('reverts when the caller is not a registered shard', async function () {
      await altDeposit.mint(strategy.address, amount);
      // prettier-ignore
      await expect(strategy.connect(sender).requestFunding(altDeposit.address, amount))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ShardNotRegistered');
    });

    it('reverts for zero amount', async function () {
      await strategy.connect(admin).registerShard(receiver.address);
      // prettier-ignore
      await expect(strategy.connect(receiver).requestFunding(altDeposit.address, 0n))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAmount');
    });

    it('reverts when requesting the strategy share token', async function () {
      await strategy.connect(admin).registerShard(receiver.address);
      // prettier-ignore
      await expect(strategy.connect(receiver).requestFunding(strategy.address, amount))
        .to.be.revertedWithCustomError(strategy, 'Strategy_ShareTransferNotAllowed');
    });
  });
});

describe('StakedLBTC as deposit token', function () {
  // All amounts in 8-decimal satoshi units (1 LBTC = 1e8).
  const ONE_LBTC = 10n ** 8n;
  const ONE_ETHER = e18; // oracle ratio scale
  const HEARTBEAT = 3600n;

  let admin: Signer;
  let strategyDeployer: Signer;
  let redeemOperator: Signer;
  let treasury: Signer;
  let operator: Signer;
  let user: Signer;

  let lbtcUnderlying: WBTCMock & Addressable;
  let stakedToken: StakedLBTCMock & Addressable;
  let oracle: RatioFeedMock;
  let stakedConverter: ChainlinkConverter & Addressable;
  let stakedStrategy: MultiAssetWithAsyncRedemptionStrategy & Addressable;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    lbtcUnderlying = await deployContract<WBTCMock>('WBTCMock', [], true, { initializer: 'initialize' });

    stakedToken = await deployContract<StakedLBTCMock>(
      'StakedLBTCMock',
      [treasury.address, admin.address, 0],
      true,
      true
    );

    oracle = await deployContract<RatioFeedMock>('RatioFeedMock', [], false);

    stakedConverter = await deployContract<ChainlinkConverter>(
      'ChainlinkConverter',
      [await oracle.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
      false
    );

    const blocklistOracleAddr = (await deployContract('BlocklistOracle', [0, admin.address], true, proxyOpts)).address;

    stakedStrategy = await deployContract<MultiAssetWithAsyncRedemptionStrategy>(
      'MultiAssetWithAsyncRedemptionStrategy',
      [
        'Lombard BTC Strategy',
        'LBTCSTR',
        await lbtcUnderlying.getAddress(),
        8,
        admin.address,
        0,
        treasury.address,
        blocklistOracleAddr
      ]
    );

    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.PRICE_SETTER_ROLE(), operator.address);
    await stakedStrategy.connect(admin).grantRole(await stakedStrategy.MANAGER_ROLE(), admin.address);
    await stakedStrategy
      .connect(admin)
      .addDepositAsset(await stakedToken.getAddress(), await stakedConverter.getAddress(), 0);
    await stakedStrategy.connect(admin).setFeeTreasury(treasury.address);

    snap = await takeSnapshot();
  });

  beforeEach(async function () {
    await snap.restore();
  });

  describe('ChainlinkConverter (ratio feed)', function () {
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
      // prettier-ignore
      await expect(stakedStrategy.connect(user)['deposit(address,uint256,address)'](sAddr, ONE_LBTC, user.address))
        .to.emit(stakedStrategy, 'Deposit')
        .withArgs(user.address, user.address, sAddr, ONE_LBTC, preview, 0n);

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
      const back = await stakedStrategy.convertToAssets.staticCall(sAddr, shares);

      // back may differ from assets by at most 1 satoshi due to rounding
      expect(back).to.be.lte(assets);
      expect(assets - back).to.be.lte(1n);
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

  let depositToken: WBTCMock & Addressable;
  let clFeed: ChainlinkFeedMock & Addressable;
  let clConverter: ChainlinkConverter & Addressable;
  let clStrategy: MultiAssetWithAsyncRedemptionStrategy & Addressable;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, , , redeemOperator, user, , operator] = await getSignersWithPrivateKeys();

    depositToken = await deployContract<WBTCMock>('WBTCMock', [], true, { initializer: 'initialize' });

    // 8-decimal feed, answer = 1e8 (peg: 1 token = 1 BTC)
    clFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);

    clConverter = await deployContract<ChainlinkConverter>(
      'ChainlinkConverter',
      [await clFeed.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
      false
    );

    const blocklistOracleAddr = (await deployContract('BlocklistOracle', [0, admin.address], true, proxyOpts)).address;

    clStrategy = await deployContract<MultiAssetWithAsyncRedemptionStrategy>(
      'MultiAssetWithAsyncRedemptionStrategy',
      [
        'Chainlink BTC Strategy',
        'clSTRAT',
        await depositToken.getAddress(),
        8,
        admin.address,
        0,
        admin.address,
        blocklistOracleAddr
      ],
      true,
      proxyOpts
    );
    await clStrategy.connect(admin).grantRole(await clStrategy.PRICE_SETTER_ROLE(), operator.address);
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
      // 18-dec feed, answer = 111_111_111 * 1e10 so that 1e8 token → 111_111_111 BTC units
      const feed18 = await deployContract<ChainlinkFeedMock>(
        'ChainlinkFeedMock',
        [18, 111_111_111n * 10n ** 10n],
        false
      );
      const conv18 = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await feed18.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

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

    it('forward: negative exponent (feedDec + tokenDec < baseDec) converts instead of reverting', async function () {
      // base-per-token feed at peg: answer/1e8 = 1 base natural per 1 token natural
      const feed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      // token 6 dec, base 18 dec, feed 8 dec → exponent = 8 + 6 - 18 = -4 (would previously underflow-revert)
      const conv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await feed.getAddress(), 6, 18, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

      // scale = 10^-4 → scaleNumerator = 1, scaleDenominator = 10000
      expect(await conv.scaleNumerator()).to.equal(1n);
      expect(await conv.scaleDenominator()).to.equal(10_000n);

      const ONE_TOKEN = 10n ** 6n;
      const ONE_BASE = 10n ** 18n;
      expect(await conv.toBaseUnits(ONE_TOKEN, 0)).to.equal(ONE_BASE);
      expect(await conv.fromBaseUnits(ONE_BASE, 1)).to.equal(ONE_TOKEN);
    });

    it('stale answer reverts with StaleAnswer', async function () {
      const block = await ethers.provider.getBlock('latest');
      await clFeed.setUpdatedAt(BigInt(block!.timestamp) - HEARTBEAT - 1n);
      // prettier-ignore
      await expect(clConverter.toBaseUnits(ONE_BTC, 0))
        .to.be.revertedWithCustomError(clConverter, 'ChainlinkConverterStaleAnswer');
      // prettier-ignore
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1))
        .to.be.revertedWithCustomError(clConverter, 'ChainlinkConverterStaleAnswer');
    });

    it('zero answer reverts with InvalidAnswer', async function () {
      await clFeed.setAnswer(0);
      // prettier-ignore
      await expect(clConverter.toBaseUnits(ONE_BTC, 0))
        .to.be.revertedWithCustomError(clConverter, 'ChainlinkConverterInvalidAnswer');
      // prettier-ignore
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1))
        .to.be.revertedWithCustomError(clConverter, 'ChainlinkConverterInvalidAnswer');
    });

    describe('sequencer uptime check', function () {
      const GRACE_PERIOD = 3600n;
      let seqFeed: ChainlinkFeedMock;
      let seqConverter: ChainlinkConverter;

      beforeEach(async function () {
        // answer=0 → sequencer up; startedAt = far in the past so grace period has elapsed
        seqFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 0], false);
        const block = await ethers.provider.getBlock('latest');
        await seqFeed.setStartedAt(BigInt(block!.timestamp) - GRACE_PERIOD - 1n);

        seqConverter = await deployContract<ChainlinkConverter>(
          'ChainlinkConverter',
          [await clFeed.getAddress(), 8, 8, HEARTBEAT, await seqFeed.getAddress(), GRACE_PERIOD, false],
          false
        );
      });

      it('sequencer up and past grace period: converts normally', async function () {
        expect(await seqConverter.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      });

      it('sequencer down (answer=1): reverts with SequencerDown', async function () {
        await seqFeed.setAnswer(1);
        // prettier-ignore
        await expect(seqConverter.toBaseUnits(ONE_BTC, 0))
          .to.be.revertedWithCustomError(seqConverter, 'ChainlinkConverterSequencerDown');
        // prettier-ignore
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1))
          .to.be.revertedWithCustomError(seqConverter, 'ChainlinkConverterSequencerDown');
      });

      it('sequencer just recovered (within grace period): reverts with GracePeriodNotOver', async function () {
        const block = await ethers.provider.getBlock('latest');
        await seqFeed.setStartedAt(BigInt(block!.timestamp)); // just came back up
        // prettier-ignore
        await expect(seqConverter.toBaseUnits(ONE_BTC, 0))
          .to.be.revertedWithCustomError(seqConverter, 'ChainlinkConverterGracePeriodNotOver');
        // prettier-ignore
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1))
          .to.be.revertedWithCustomError(seqConverter, 'ChainlinkConverterGracePeriodNotOver');
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
      const invFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const inv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await invFeed.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, true],
        false
      );
      expect(await inv.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      expect(await inv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_BTC);
    });

    it('USDC (6 dec) / BTC (8 dec) via 8-dec BTC/USD-style feed', async function () {
      const price = 100_000n * ONE_BTC; // 100k USD per 1 BTC
      const usdFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, price], false);
      const conv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await usdFeed.getAddress(), 6, 8, HEARTBEAT, ethers.ZeroAddress, 0, true],
        false
      );
      const usdcIn = 100_000n * 10n ** 6n;
      expect(await conv.toBaseUnits(usdcIn, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(usdcIn);
    });

    it('inverted: negative exponent (feedDec + baseDec < tokenDec) converts instead of reverting', async function () {
      // token-per-base feed at peg: answer/1e8 = 1 token natural per 1 base natural
      const invFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      // token 18 dec, base 8 dec, feed 8 dec → exponent = 8 + 8 - 18 = -2 (would previously underflow-revert)
      const conv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await invFeed.getAddress(), 18, 8, HEARTBEAT, ethers.ZeroAddress, 0, true],
        false
      );

      // scale = 10^-2 → scaleNumerator = 1, scaleDenominator = 100
      expect(await conv.scaleNumerator()).to.equal(1n);
      expect(await conv.scaleDenominator()).to.equal(100n);

      // 1 token (1e18) at peg → 1 base natural → 1e8 base units; and back.
      const ONE_TOKEN = 10n ** 18n;
      expect(await conv.toBaseUnits(ONE_TOKEN, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_TOKEN);
    });

    it('inverted: negative-exponent round-trip stays within 1 base wei', async function () {
      const invFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const conv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await invFeed.getAddress(), 18, 8, HEARTBEAT, ethers.ZeroAddress, 0, true],
        false
      );

      // Round-trip in the precision-preserving direction: base -> token -> base. (token has 18 dec, base 8,
      // so token -> base -> token would shed sub-base dust; that is decimal truncation, not a converter bug.)
      const answers = [(ONE_BTC * 95n) / 100n, (ONE_BTC * 99n) / 100n, ONE_BTC];
      const amounts = [ONE_BTC / 2n, ONE_BTC, ONE_BTC * 100n];
      for (const answer of answers) {
        await invFeed.setAnswer(answer);
        for (const amt of amounts) {
          const tokenOut = await conv.fromBaseUnits(amt, 1);
          const baseOut = await conv.toBaseUnits(tokenOut, 0);
          expect(baseOut).to.be.gte(amt);
          expect(baseOut - amt).to.be.lte(1n);
        }
      }
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) >= x and diff <= 1 token wei (inverted)', async function () {
      const invFeed = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const invConv = await deployContract<ChainlinkConverter>(
        'ChainlinkConverter',
        [await invFeed.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, true],
        false
      );

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
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [await feedNum.getAddress(), await feedDen.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

      expect(await conv.toBaseUnits(ONE_BTC, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_BTC);
    });

    it('ETH/USD ÷ BTC/USD style cross: 1 ETH wei → expected satoshi', async function () {
      // USD per ETH = 2500 (8-dec), USD per BTC = 50_000 (8-dec) → 0.05 BTC per ETH
      const ethUsd = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 2500n * ONE_BTC], false);
      const btcUsd = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 50_000n * ONE_BTC], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [await ethUsd.getAddress(), await btcUsd.getAddress(), 18, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

      const oneEth = 10n ** 18n;
      const expectedSat = (oneEth * 2500n * ONE_BTC) / (50_000n * ONE_BTC) / 10n ** 10n; // 5e6
      expect(expectedSat).to.equal(5n * 10n ** 6n);
      expect(await conv.toBaseUnits(oneEth, 0)).to.equal(expectedSat);
      expect(await conv.fromBaseUnits(expectedSat, 1)).to.equal(oneEth);
    });

    it('stale numerator feed reverts', async function () {
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [await feedNum.getAddress(), await feedDen.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

      const block = await ethers.provider.getBlock('latest');
      await feedNum.setUpdatedAt(BigInt(block!.timestamp) - HEARTBEAT - 1n);
      // prettier-ignore
      await expect(conv.toBaseUnits(ONE_BTC, 0))
        .to.be.revertedWithCustomError(conv, 'ChainlinkCompositeConverter_StaleAnswer');
    });

    it('round-trip: fromBaseUnits(toBaseUnits(x)) within 2 token wei (dual mulDiv)', async function () {
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, ONE_BTC], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [await feedNum.getAddress(), await feedDen.getAddress(), 8, 8, HEARTBEAT, ethers.ZeroAddress, 0, false],
        false
      );

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

    it('mismatched feed decimals (6-dec num, 18-dec den) do not truncate to zero', async function () {
      // Both feeds report a 1:1 price, but with very different decimals.
      // num: 6-dec feed, answer 1e6 (price 1.0)
      // den: 18-dec feed, answer 1e18 (price 1.0)
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [6, 10n ** 6n], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [18, 10n ** 18n], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [
          await feedNum.getAddress(),
          await feedDen.getAddress(),
          6, // tokenDecimals
          6, // baseDecimals
          HEARTBEAT,
          ethers.ZeroAddress,
          0,
          false
        ],
        false
      );

      // 100,000 USDC (6 decimals). With the old two-step computation the
      // intermediate ratio mulDiv(1e11, 1e6, 1e18) floored to 0, losing the
      // entire amount. A single fused mulDiv preserves the 1:1 conversion.
      const amount = 100_000n * 10n ** 6n; // 1e11
      expect(await conv.toBaseUnits(amount, 0)).to.equal(amount);
      expect(await conv.fromBaseUnits(amount, 1)).to.equal(amount);
    });

    it('scaleFwdDen > scaleFwdNum (18-dec token/num, 8-dec base/den) stays exact', async function () {
      // num: 18-dec feed, answer 1e18 (price 1.0)
      // den: 8-dec feed, answer 1e8 (price 1.0)
      // fwdExp = (denDec+baseDec) - (numDec+tokenDec) = (8+8) - (18+18) = -20,
      // so the netted scales are scaleFwdNum = 1 and scaleFwdDen = 10^20 (den >> num).
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [18, 10n ** 18n], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 10n ** 8n], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [
          await feedNum.getAddress(),
          await feedDen.getAddress(),
          18, // tokenDecimals
          8, // baseDecimals
          HEARTBEAT,
          ethers.ZeroAddress,
          0,
          false
        ],
        false
      );

      // 1 token (1e18) at a 1:1 price is exactly 1 base unit (1e8), regardless
      // of scaleFwdDen (1e20) being 20 orders of magnitude larger than scaleFwdNum (1).
      const oneToken = 10n ** 18n;
      const oneBase = 10n ** 8n;
      expect(await conv.toBaseUnits(oneToken, 0)).to.equal(oneBase);
      expect(await conv.fromBaseUnits(oneBase, 1)).to.equal(oneToken);

      // Sub-base-unit dust (true value < 1 base unit) legitimately floors to 0
      // with Floor rounding, and ceils to 1 with Ceil rounding — not a bug.
      const dust = 10n ** 9n; // 1e9 token wei = 1e-9 token => well below 1 base unit
      expect(await conv.toBaseUnits(dust, 0)).to.equal(0n); // Floor
      expect(await conv.toBaseUnits(dust, 1)).to.equal(1n); // Ceil
    });

    it('large feed answers do not overflow the fused mulDiv (netted scaling)', async function () {
      // 18-dec feeds, 18-dec token, 18-dec base => fwd/inv net exponents are 0,
      // so the applied scale is 1. With the *un-netted* scaling the converter would
      // multiply the answer by 10^(18+18)=10^36; an answer of 1e42 would then form
      // 1e78 > 2^256 and revert, blocking a legitimate price. Netting avoids this.
      const bigAnswer = 10n ** 42n;
      const feedNum = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [18, bigAnswer], false);
      const feedDen = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [18, bigAnswer], false);

      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [
          await feedNum.getAddress(),
          await feedDen.getAddress(),
          18, // tokenDecimals
          18, // baseDecimals
          HEARTBEAT,
          ethers.ZeroAddress,
          0,
          false
        ],
        false
      );

      // num == den (1:1) at equal decimals => 1 token maps to 1 base unit, no revert.
      const oneToken = 10n ** 18n;
      expect(await conv.toBaseUnits(oneToken, 0)).to.equal(oneToken);
      expect(await conv.fromBaseUnits(oneToken, 1)).to.equal(oneToken);
    });

    it('inverted mode is unchanged by netting (ETH/USD ÷ BTC/USD style)', async function () {
      // Same economic setup as the forward cross test but deployed inverted with the
      // feeds swapped, which must yield identical results.
      const ethUsd = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 2500n * ONE_BTC], false);
      const btcUsd = await deployContract<ChainlinkFeedMock>('ChainlinkFeedMock', [8, 50_000n * ONE_BTC], false);

      // inverted = true with (num=BTC/USD, den=ETH/USD): ratio is den/num = ETH/BTC.
      const conv = await deployContract<ChainlinkCompositeConverter>(
        'ChainlinkCompositeConverter',
        [
          await btcUsd.getAddress(),
          await ethUsd.getAddress(),
          18, // tokenDecimals (ETH)
          8, // baseDecimals (BTC)
          HEARTBEAT,
          ethers.ZeroAddress,
          0,
          true
        ],
        false
      );

      const oneEth = 10n ** 18n;
      const expectedSat = 5n * 10n ** 6n; // 0.05 BTC
      expect(await conv.toBaseUnits(oneEth, 0)).to.equal(expectedSat);
      expect(await conv.fromBaseUnits(expectedSat, 1)).to.equal(oneEth);
    });
  });

  describe('strategy deposit / mint integration', function () {
    it('at-par: deposit 1 depositToken mints 1 share', async function () {
      const tAddr = await depositToken.getAddress();
      const vAddr = await clStrategy.getAddress();

      await depositToken.mint(user.address, ONE_BTC);
      await depositToken.connect(user).approve(vAddr, ONE_BTC);

      const preview = await clStrategy.previewDeposit(tAddr, ONE_BTC);
      // prettier-ignore
      await expect(clStrategy.connect(user)['deposit(address,uint256,address)'](tAddr, ONE_BTC, user.address))
        .to.emit(clStrategy, 'Deposit')
        .withArgs(user.address, user.address, tAddr, ONE_BTC, preview, 0n);

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
      const back = await clStrategy.convertToAssets.staticCall(tAddr, shares);

      expect(back).to.be.lte(assets);
      expect(assets - back).to.be.lte(1n);
    });
  });
});
