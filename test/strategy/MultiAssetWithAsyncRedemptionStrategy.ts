import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import { calculateStorageSlot, deployContract, e18, getSignersWithPrivateKeys, randomBigInt, Signer } from '../helpers';
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

async function deployBlocklistOracle(adminAddress: string): Promise<string> {
  const factory = await ethers.getContractFactory('BlocklistOracle');
  const proxy = await upgrades.deployProxy(factory, [0, adminAddress], {
    initializer: 'initialize',
    unsafeAllow: ['constructor']
  });
  await proxy.waitForDeployment();
  return await proxy.getAddress();
}

describe('MultiAssetWithAsyncRedemptionStrategy (happy path)', function () {
  const BPS_DENOMINATOR = 10_000n;
  const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
  const MGMT_FEE_BPS = 1000n;

  let admin: Signer;
  let redeemOperator: Signer;
  let user: Signer;
  let treasury: Signer;
  let operator: Signer;

  let underlying: TokenMock;
  let altDeposit: TokenMock;
  let directConverter: DirectConverter;
  let strategy: MultiAssetWithAsyncRedemptionStrategy;
  let blocklistOracleAddr: string;

  let snapshot: SnapshotRestorer;

  // Mirrors FeeManagerUpgradeable._computeManagementFeeShares: gross-up so the treasury ends up owning
  // f = num/den of the POST-mint supply (mint S*f/(1-f) = S*num/(den-num)), over the full elapsed interval.
  function expectedManagementFeeShares(supply: bigint, elapsedSeconds: bigint): bigint {
    const num = MGMT_FEE_BPS * elapsedSeconds;
    const den = BPS_DENOMINATOR * SECONDS_PER_YEAR;
    return (supply * num) / (den - num);
  }

  before(async function () {
    [admin, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    underlying = await deployContract<TokenMock>('TokenMock', ['Underlying', 'UND', 18], false);
    altDeposit = await deployContract<TokenMock>('TokenMock', ['Alt Deposit', 'ALT', 18], false);
    (underlying as TokenMock & { address: string }).address = await underlying.getAddress();
    (altDeposit as TokenMock & { address: string }).address = await altDeposit.getAddress();

    blocklistOracleAddr = await deployBlocklistOracle(admin.address);

    const convFactory = await ethers.getContractFactory('DirectConverter');
    directConverter = (await convFactory.deploy()) as DirectConverter;
    await directConverter.waitForDeployment();
    (directConverter as DirectConverter & { address: string }).address = await directConverter.getAddress();

    strategy = await deployContract<MultiAssetWithAsyncRedemptionStrategy>('MultiAssetWithAsyncRedemptionStrategy', [
      'Multi Strategy Shares',
      'mSTRAT',
      await underlying.getAddress(),
      18,
      admin.address,
      0,
      treasury.address,
      blocklistOracleAddr
    ]);
    (strategy as MultiAssetWithAsyncRedemptionStrategy & { address: string }).address = await strategy.getAddress();

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
    expect(await strategy.version()).to.equal('MAWARS-0.0.1');
    expect(await strategy.blocklistOracle()).to.equal(blocklistOracleAddr);
  });

  it('changeNameAndSymbol updates name and symbol and emits NameAndSymbolChanged', async function () {
    const newName = 'Renamed Strategy Shares';
    const newSymbol = 'rSTRAT';

    await expect(strategy.connect(admin).changeNameAndSymbol(newName, newSymbol))
      .to.emit(strategy, 'NameAndSymbolChanged')
      .withArgs(newName, newSymbol);

    expect(await strategy.name()).to.equal(newName);
    expect(await strategy.symbol()).to.equal(newSymbol);
  });

  it('changeNameAndSymbol reverts for non-admin', async function () {
    const newName = 'Renamed Strategy Shares';
    const newSymbol = 'rSTRAT';

    await expect(strategy.connect(user).changeNameAndSymbol(newName, newSymbol))
      .to.be.revertedWithCustomError(strategy, 'AccessControlUnauthorizedAccount')
      .withArgs(user.address, await strategy.DEFAULT_ADMIN_ROLE());
  });

  it('admin can setBlocklistOracle to a new address', async function () {
    const newOracle = await deployBlocklistOracle(admin.address);
    await expect(strategy.connect(admin).setBlocklistOracle(newOracle))
      .to.emit(strategy, 'BlocklistOracleSet')
      .withArgs(newOracle);
    expect(await strategy.blocklistOracle()).to.equal(newOracle);
  });

  it('setBlocklistOracle reverts for zero address', async function () {
    await expect(strategy.connect(admin).setBlocklistOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      strategy,
      'Strategy_ZeroAddress'
    );
  });

  describe('share transfer compliance', function () {
    const DenialReason = { Blocklist: 0, Sanction: 1 } as const;

    async function mintSharesTo(holder: Signer, amount = 100n * e18) {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
      await altDeposit.mint(holder.address, amount);
      await altDeposit.connect(holder).approve(strategy.address, amount);
      await strategy.connect(holder)['deposit(address,uint256,address)'](altDeposit.address, amount, holder.address);
    }

    it('reverts transfer when sender is blocklisted', async function () {
      await mintSharesTo(user);
      const oracle = (await ethers.getContractAt('BlocklistOracle', blocklistOracleAddr)) as BlocklistOracle;
      await oracle.connect(admin).blockAccount([user.address]);
      const shares = await strategy.balanceOf(user.address);
      await expect(strategy.connect(user).transfer(operator.address, shares))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Blocklist);
    });

    it('reverts transfer when recipient is blocklisted', async function () {
      await mintSharesTo(user);
      const oracle = (await ethers.getContractAt('BlocklistOracle', blocklistOracleAddr)) as BlocklistOracle;
      await oracle.connect(admin).blockAccount([operator.address]);
      const shares = await strategy.balanceOf(user.address);
      await expect(strategy.connect(user).transfer(operator.address, shares))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Blocklist);
    });

    it('reverts transfer when sender is sanctioned', async function () {
      await mintSharesTo(user);
      const oracle = (await ethers.getContractAt('BlocklistOracle', blocklistOracleAddr)) as BlocklistOracle;
      const sanctionList = (await ethers.deployContract('SanctionListMock')) as SanctionListMock;
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(user.address, true);
      const shares = await strategy.balanceOf(user.address);
      await expect(strategy.connect(user).transfer(operator.address, shares))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Sanction);
    });

    it('reverts transfer when recipient is sanctioned', async function () {
      await mintSharesTo(user);
      const oracle = (await ethers.getContractAt('BlocklistOracle', blocklistOracleAddr)) as BlocklistOracle;
      const sanctionList = (await ethers.deployContract('SanctionListMock')) as SanctionListMock;
      await oracle.connect(admin).addSanctionList(await sanctionList.getAddress());
      await sanctionList.setSanctioned(operator.address, true);
      const shares = await strategy.balanceOf(user.address);
      await expect(strategy.connect(user).transfer(operator.address, shares))
        .to.be.revertedWithCustomError(oracle, 'BlocklistOracle_NotAllowed')
        .withArgs(DenialReason.Sanction);
    });

    it('allows transfer between compliant accounts', async function () {
      await mintSharesTo(user);
      const shares = await strategy.balanceOf(user.address);
      const half = shares / 2n;
      await strategy.connect(user).transfer(operator.address, half);
      expect(await strategy.balanceOf(user.address)).to.equal(shares - half);
      expect(await strategy.balanceOf(operator.address)).to.equal(half);
    });
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
    const [mgmtFeeBps, lastHarvest, mgmtTreasury] = await strategy.managementFee();
    const [perfFeeBps] = await strategy.performanceFee();
    const expected =
      BigInt(mgmtFeeBps) + (BigInt(perfFeeBps) << 16n) + (BigInt(lastHarvest) << 32n) + (BigInt(mgmtTreasury) << 80n);
    expect(storage).to.equal(ethers.toBeHex(expected, 32));
  });

  it('accrues management fee on deposit and mints fee shares to management fee treasury', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 0);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

    const firstDeposit = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, firstDeposit * 2n);
    await altDeposit.connect(user).approve(v, firstDeposit * 2n);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);

    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const treasuryBefore = await strategy.balanceOf(treasury.address);
    const tx = await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);
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
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 0);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

    const firstDeposit = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, firstDeposit * 2n);
    await altDeposit.connect(user).approve(v, firstDeposit * 2n);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);

    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const targetShares = 500n * 10n ** 18n;
    const requiredAssets = await strategy.previewMint(alt, targetShares);
    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const treasuryBefore = await strategy.balanceOf(treasury.address);
    const tx = await strategy
      .connect(user)
      ['mint(address,uint256,address,uint256)'](alt, targetShares, user.address, requiredAssets);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    const elapsedSeconds = BigInt(block!.timestamp) - BigInt(lastHarvest);
    const expectedFeeShares = expectedManagementFeeShares(supplyBefore, elapsedSeconds);
    expect(expectedFeeShares).to.be.gt(0n);
    const treasuryAfter = await strategy.balanceOf(treasury.address);
    expect(treasuryAfter - treasuryBefore).to.equal(expectedFeeShares);
  });

  it('accrues management fee on requestRedeem before burning user shares', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 0);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

    const depositAmt = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, depositAmt);
    await altDeposit.connect(user).approve(v, depositAmt);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);

    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const userShares = await strategy.balanceOf(user.address);
    const redeemShares = userShares / 2n;
    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const treasuryBefore = await strategy.balanceOf(treasury.address);
    const tx = await strategy.connect(user).requestRedeem(redeemShares, user.address);
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
    const managementTreasury = operator.address;
    await strategy.connect(admin).setFeeTreasury(treasury.address);
    await strategy.connect(admin).setManagementFeeTreasury(managementTreasury);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 100); // 1%

    const depositAmt = 10_000n * 10n ** 18n;
    const depositFee = (depositAmt * 100n) / 10_000n;
    await altDeposit.mint(user.address, depositAmt * 2n);
    await altDeposit.connect(user).approve(v, depositAmt * 2n);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);

    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const feeTreasuryAssetBefore = await altDeposit.balanceOf(treasury.address);
    const mgmtTreasurySharesBefore = await strategy.balanceOf(managementTreasury);
    const tx = await strategy.connect(user)['deposit(address,uint256,address)'](alt, depositAmt, user.address);
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
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 0);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

    const firstDeposit = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, firstDeposit * 2n);
    await altDeposit.connect(user).approve(v, firstDeposit * 2n);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);

    await ethers.provider.send('evm_increaseTime', [30 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const treasuryBefore = await strategy.balanceOf(treasury.address);
    const tx = await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);
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
    await strategy.connect(admin).addDepositAsset(alt, await directConverter.getAddress(), 0);
    await strategy.connect(admin).setManagementFeeBps(Number(MGMT_FEE_BPS)); // 10%

    const firstDeposit = 2_000n * 10n ** 18n;
    await altDeposit.mint(user.address, firstDeposit * 2n);
    await altDeposit.connect(user).approve(v, firstDeposit * 2n);
    await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);

    // Three years of dormancy: at 10%/yr the gross-up stays well below 100% (num/den = 0.3), so no revert,
    // and the full ~3y interval is charged rather than being capped to one year.
    await ethers.provider.send('evm_increaseTime', [3 * 365 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const supplyBefore = await strategy.totalSupply();
    const [, lastHarvest] = await strategy.managementFee();
    const treasuryBefore = await strategy.balanceOf(treasury.address);
    const tx = await strategy.connect(user)['deposit(address,uint256,address)'](alt, firstDeposit, user.address);
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

  it('initialize reverts when management fee treasury is zero', async function () {
    const factory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const blocklistOracleAddr = await deployBlocklistOracle(admin.address);
    await expect(
      upgrades.deployProxy(factory, [
        'Tmp',
        'TMP',
        await underlying.getAddress(),
        18,
        admin.address,
        0,
        ethers.ZeroAddress,
        blocklistOracleAddr
      ])
    ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
  });

  it('initialize reverts when blocklist oracle is zero', async function () {
    const factory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    await expect(
      upgrades.deployProxy(factory, [
        'Tmp',
        'TMP',
        await underlying.getAddress(),
        18,
        admin.address,
        0,
        treasury.address,
        ethers.ZeroAddress
      ])
    ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAddress');
  });

  it('initialize reverts when fallback decimals is zero', async function () {
    const factory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const blocklistOracleAddr = await deployBlocklistOracle(admin.address);
    await expect(
      upgrades.deployProxy(factory, [
        'Tmp',
        'TMP',
        await underlying.getAddress(),
        0,
        admin.address,
        0,
        treasury.address,
        blocklistOracleAddr
      ])
    ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroDecimals');
  });

  it('lists a deposit asset and records converter + fee', async function () {
    await expect(strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0))
      .to.emit(strategy, 'DepositAssetAdded')
      .withArgs(admin.address, altDeposit.address);

    expect(await strategy.isDepositAsset(altDeposit.address)).to.be.true;
    expect(await strategy.converterOf(altDeposit.address)).to.equal(directConverter.address);
    expect(await strategy.depositFee(altDeposit.address)).to.equal(0);
    expect(await strategy.maxDeposit(altDeposit.address, user.address)).to.equal(ethers.MaxUint256);
    expect(await strategy.maxMint(altDeposit.address, user.address)).to.equal(ethers.MaxUint256);
  });

  it('deposits alt asset and mints shares (preview matches execution)', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();
    await strategy.connect(admin).addDepositAsset(alt, directConverter.address, 0);

    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    const preview = await strategy.previewDeposit(alt, assets);
    await expect(strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address))
      .to.emit(strategy, 'Deposit')
      .withArgs(user.address, user.address, alt, assets, preview, 0n);

    expect(await strategy.balanceOf(user.address)).to.equal(preview);
    expect(await altDeposit.balanceOf(v)).to.equal(assets);
  });

  it('reverts deposit and mint for an unlisted asset (no spurious Deposit event)', async function () {
    const alt = await altDeposit.getAddress();
    const v = await strategy.getAddress();

    // altDeposit is intentionally NOT listed via addDepositAsset.
    const assets = 10_000n * 10n ** 18n;
    await altDeposit.mint(user.address, assets);
    await altDeposit.connect(user).approve(v, assets);

    // Unlisted asset: previewDeposit returns 0 shares, caught by the zero guard.
    await expect(
      strategy.connect(user)['deposit(address,uint256,address)'](alt, assets, user.address)
    ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAmount');

    // mint of an unlisted asset: previewMint returns 0 assets, caught downstream.
    await expect(
      strategy.connect(user)['mint(address,uint256,address)'](alt, 1n, user.address)
    ).to.be.revertedWithCustomError(strategy, 'Strategy_ZeroAmount');

    // No tokens were pulled and no shares minted.
    expect(await altDeposit.balanceOf(v)).to.equal(0n);
    expect(await strategy.balanceOf(user.address)).to.equal(0n);
  });

  it('optional defaultShard forwards net deposit tokens to a registered address', async function () {
    const sink = ethers.Wallet.createRandom().address;

    await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
    await strategy.connect(admin).registerShard(sink);
    await expect(strategy.connect(admin).setDefaultShard(sink))
      .to.emit(strategy, 'DefaultShardSet')
      .withArgs(sink, admin.address);

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

  it('lists a deposit asset with non-zero deposit fee', async function () {
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
        name: 'amount is 10000 and fee is 1 (ceil fee avoids zero net)',
        assets: 10_000n,
        depositFeeBps: 1n
      }
    ];

    const rows: { assets: number; feeBps: number; fee: number; net: number }[] = [];

    args.forEach(arg => {
      it(`preview and deposit ${arg.name}`, async function () {
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, arg.depositFeeBps);
        await strategy.connect(admin).setFeeTreasury(treasury.address);

        const assets = arg.assets;
        await altDeposit.mint(user.address, assets);
        await altDeposit.connect(user).approve(strategy.address, assets);

        const fee = arg.depositFeeBps === 0n ? 0n : (assets * arg.depositFeeBps + 10_000n - 1n) / 10_000n;
        const net = assets - fee;

        const previewShares = await strategy.previewDeposit(altDeposit.address, assets);
        // prettier-ignore
        await expect(strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, assets, user.address))
          .to.emit(strategy, 'Deposit')
        .withArgs(user.address, user.address, altDeposit.address, net, previewShares, fee);

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
      .to.be.revertedWithCustomError(strategy, 'StrategyDeposit_FeeTreasuryNotSet');
  });

  it('deregisterShard clears defaultShard when it matches', async function () {
    const sink = ethers.Wallet.createRandom().address;
    await strategy.connect(admin).registerShard(sink);
    await strategy.connect(admin).setDefaultShard(sink);
    await expect(strategy.connect(admin).deregisterShard(sink))
      .to.emit(strategy, 'DefaultShardSet')
      .withArgs(ethers.ZeroAddress, admin.address);
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
        await strategy.connect(admin).postPricePerShare(arg.pps, e18, false);

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
        await strategy.connect(admin).postPricePerShare(arg.pps, e18, false);

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
        await strategy.connect(admin).postPricePerShare(arg.pps, e18, false);
        if (await strategy.depositPaused()) {
          await strategy.connect(admin).unpauseDeposit();
        }
        if (await strategy.redeemPaused()) {
          await strategy.connect(admin).unpauseRedeem();
        }

        const depositAmt = arg.amount;
        await altDeposit.mint(user.address, depositAmt);
        await altDeposit.connect(user).approve(strategy.address, depositAmt);
        await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

        const shares = await strategy.balanceOf(user.address);
        const sharesExpected = (depositAmt * e18) / arg.pps;
        expect(shares).to.equal(sharesExpected);

        const expectedAssets = (shares * arg.pps) / e18;
        const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);
        const tx = await strategy.connect(user).requestRedeem(shares, user.address);

        await expect(tx)
          .to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, user.address, user.address, expectedAssets, shares, 0n);
        await expect(tx).to.changeTokenBalance(strategy, user, -shares);
        const pending = await strategy.pendingRedeemRequest(rid);
        expect(pending.pendingShares).to.equal(shares);
        expect(pending.pendingAssets).to.equal(expectedAssets);
        expect(pending.owner).to.equal(user.address);

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
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = e18, no fee',
        redeemShares: e18,
        redeemFee: 0n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = e18, fee = 1',
        redeemShares: e18,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = 10001, fee = 1',
        redeemShares: 10001n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = 10000, fee = 1',
        redeemShares: 10000n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = 9999, fee = 1',
        redeemShares: 9999n,
        redeemFee: 1n,
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      },
      {
        name: 'amount = rnd(10^18), fee = rnd(999)',
        redeemShares: randomBigInt(17),
        redeemFee: randomBigInt(3),
        expectedRedeemAmount: (amount: bigint, fee: bigint) => (amount * (10000n - fee)) / 10000n
      }
    ];

    const rows: { redeemShares: number; feeBps: number; fee: number; net: number }[] = [];

    args.forEach(arg => {
      it(`${arg.name}`, async function () {
        await strategy.connect(admin).setFeeTreasury(treasury.address);
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);
        const redeemFee = arg.redeemFee;
        await strategy.connect(admin).setRedeemFeeBps(redeemFee);
        expect(await strategy.redeemFee()).to.be.equal(redeemFee);

        const depositAmt = e18;
        await altDeposit.mint(user.address, depositAmt);
        await altDeposit.connect(user).approve(strategy.address, depositAmt);
        await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

        const shares = arg.redeemShares;
        const BPS = 10_000n;
        const feeShares = redeemFee === 0n ? 0n : (shares * redeemFee + BPS - 1n) / BPS;
        const netShares = shares - feeShares;
        const assetsOut = netShares;

        await underlying.mint(strategy.address, assetsOut + 1n);
        const beforeU = await underlying.balanceOf(user.address);

        const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);

        const tx = await strategy.connect(user).requestRedeem(shares, user.address);
        await expect(tx).to.changeTokenBalance(strategy, user, -shares);
        if (feeShares > 0) {
          await expect(tx).to.emit(strategy, 'RedeemFeeCharged').withArgs(treasury.address, feeShares);
        }
        await expect(tx)
          .to.emit(strategy, 'RedeemRequested')
          .withArgs(rid, user.address, user.address, assetsOut, netShares, feeShares);

        expect(await strategy.balanceOf(user.address)).to.equal(depositAmt - shares);
        const pending = await strategy.pendingRedeemRequest(rid);
        expect(pending.pendingShares).to.equal(netShares);
        expect(pending.pendingAssets).to.equal(assetsOut);
        expect(pending.owner).to.equal(user.address);

        await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
          .to.emit(strategy, 'Redeem')
          .withArgs(redeemOperator.address, user.address, assetsOut, netShares)
          .and.to.emit(strategy, 'RedeemRequestsFulfilled')
          .withArgs([rid]);

        const afterU = await underlying.balanceOf(user.address);
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

    it('fulfillRedeemRequests: reverts when fulfilled in the same block as the request', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      const depositAmt = e18;
      await altDeposit.mint(user.address, depositAmt);
      await altDeposit.connect(user).approve(strategy.address, depositAmt);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, depositAmt, user.address);

      const shares = await strategy.balanceOf(user.address);
      await underlying.mint(strategy.address, shares);

      const rid = await strategy.connect(user).requestRedeem.staticCall(shares, user.address);

      // Force the request and the fulfillment into the same block.
      await ethers.provider.send('evm_setAutomine', [false]);
      let fulfillStatus: number | undefined;
      try {
        await strategy.connect(user).requestRedeem(shares, user.address, { gasLimit: 1_000_000 });
        const fulfillTx = await strategy.connect(redeemOperator).fulfillRedeemRequests([rid], { gasLimit: 1_000_000 });
        await ethers.provider.send('evm_mine', []);
        const receipt = await ethers.provider.getTransactionReceipt(fulfillTx.hash);
        fulfillStatus = receipt!.status ?? undefined;
      } finally {
        await ethers.provider.send('evm_setAutomine', [true]);
      }
      // Fulfillment in the same block must have reverted.
      expect(fulfillStatus).to.equal(0);

      // The request remains open and is fulfillable from the next block onward.
      const pending = await strategy.pendingRedeemRequest(rid);
      expect(pending.pendingShares).to.equal(shares);

      await expect(strategy.connect(redeemOperator).fulfillRedeemRequests([rid]))
        .to.emit(strategy, 'Redeem')
        .withArgs(redeemOperator.address, user.address, shares, shares)
        .and.to.emit(strategy, 'RedeemRequestsFulfilled')
        .withArgs([rid]);
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

    args.forEach((arg, i) => {
      it(`${arg.name}`, async function () {
        await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

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

        const defaultRate = await strategy.pricePerShare();
        const newRate = arg.newRate(defaultRate);

        if (newRate !== defaultRate) {
          const supplyAtSnapshot = await strategy.totalSupply();
          const navAtSnapshot = (newRate * supplyAtSnapshot) / e18;
          await strategy.connect(admin).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);
          if (await strategy.depositPaused()) {
            await strategy.connect(admin).unpauseDeposit();
          }
          if (await strategy.redeemPaused()) {
            await strategy.connect(admin).unpauseRedeem();
          }
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
        expect(supplyAfter - supplyBefore).to.be.eq(expectedShares);
        expect(await strategy.pricePerShare()).to.equal(newRate);

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

  describe('postPricePerShare reconciliation', function () {
    it('reconciles down for mid-epoch deposit (frontrun protection)', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);

      const supplyAtSnapshot = await strategy.totalSupply();
      expect(supplyAtSnapshot).to.equal(baseDeposit);
      expect(await strategy.pricePerShare()).to.equal(e18);

      // Operator off-chain: NAV = 101, supply = 100 → declared PPS = 1.01.
      const navAtSnapshot = 101n * e18;

      // Frontrun: 50-asset deposit at the still-stored PPS = 1.0 mints 50 shares before the post lands.
      const frontrunAmt = 50n * e18;
      await altDeposit.mint(user.address, frontrunAmt);
      await altDeposit.connect(user).approve(strategy.address, frontrunAmt);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, frontrunAmt, user.address);

      expect(await strategy.totalSupply()).to.equal(150n * e18);
      expect(await strategy.pricePerShare()).to.equal(e18);

      // Post: reconciledNav = 101 + 50 * 1.0 = 151, stored PPS = 151/150 (Floor) — not the declared 1.01.
      await strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      const expectedPPS = (151n * e18) / 150n;
      const declaredPPS = (101n * e18) / 100n;
      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
      expect(await strategy.pricePerShare()).to.be.lessThan(declaredPPS);

      // totalAssets() matches real backing (151), modulo Floor truncation in the round-trip.
      expect(await strategy.totalAssets()).to.equal((150n * e18 * expectedPPS) / e18);
    });

    it('reconciles up for mid-epoch redeem request', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);

      const supplyAtSnapshot = await strategy.totalSupply();

      // Operator snapshot: NAV = 101, supply = 100 → declared PPS = 1.01.
      const navAtSnapshot = 101n * e18;

      // Mid-epoch redeem request burns 30 shares at stale PPS = 1.0; active supply drops to 70.
      const redeemShares = 30n * e18;
      await strategy.connect(user).requestRedeem(redeemShares, user.address);
      expect(await strategy.totalSupply()).to.equal(70n * e18);

      // Post: navRemoved = 30 * 1.0 = 30, reconciledNav = 71, stored PPS = 71/70 (Floor) — above declared 1.01.
      await strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      const expectedPPS = (71n * e18) / 70n;
      const declaredPPS = (101n * e18) / 100n;
      expect(await strategy.pricePerShare()).to.equal(expectedPPS);
      expect(await strategy.pricePerShare()).to.be.greaterThan(declaredPPS);

      expect(await strategy.totalAssets()).to.equal((70n * e18 * expectedPPS) / e18);
    });
  });

  describe('price-per-share rate limit', function () {
    it('setPricePerShareRateLimit requires MANAGER_ROLE', async function () {
      await expect(strategy.connect(user).setPricePerShareRateLimit(500, 1n)).to.be.revertedWithCustomError(
        strategy,
        'AccessControlUnauthorizedAccount'
      );
      await expect(strategy.connect(operator).setPricePerShareRateLimit(500, 1n)).to.be.revertedWithCustomError(
        strategy,
        'AccessControlUnauthorizedAccount'
      );
    });

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
      await expect(strategy.connect(operator).postPricePerShare(p1, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);

      // Any further move is blocked until the bucket refills
      await expect(strategy.connect(operator).postPricePerShare(p1 + 1n, e18, true)).to.be.revertedWithCustomError(
        strategy,
        'PriceRateLimiterRateLimitExceeded'
      );

      // After one week the bucket is full again
      await ethers.provider.send('evm_increaseTime', [604800]);
      await ethers.provider.send('evm_mine', []);

      const p2 = (p1 * 10005n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p2, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
    });

    it('soft overflow: applies price, drains bucket, and pauses deposit and redeem', async function () {
      const maxBps = 500;
      const weekSeconds = 604800n;
      const refillRate = (BigInt(maxBps) * 2n ** 32n + weekSeconds - 1n) / weekSeconds;

      await strategy.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      const p1 = (p0 * 10005n) / 10000n;
      await strategy.connect(operator).postPricePerShare(p1, e18, true);

      const tinyBump = p1 + 1n;
      await expect(strategy.connect(operator).postPricePerShare(tinyBump, e18, false)).to.emit(
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

      await strategy.connect(admin).setPricePerShareRateLimit(maxBps, refillRate);

      const p0 = await strategy.pricePerShare();
      // +0.13% (1300 bps) — within daily budget, leaving 100 bps
      const p1 = (p0 * 10013n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p1, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(100n);

      // 2 bps exceeds the 1 bps remaining in the bucket
      const p2 = (p1 * 10002n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p2, e18, true)).to.be.revertedWithCustomError(
        strategy,
        'PriceRateLimiterRateLimitExceeded'
      );

      // After one day the bucket is full again
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);

      const p3 = (p1 * 10013n) / 10000n;
      await expect(strategy.connect(operator).postPricePerShare(p3, e18, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );
    });

    it('gates on the declared NAV move, not the reconciled move (mid-epoch mint cannot mask a swing)', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);

      const supplyAtSnapshot = await strategy.totalSupply();
      expect(supplyAtSnapshot).to.equal(baseDeposit);

      // Bucket allows a +60% move (600_000 micro-bps); refillRate 0 keeps it full for the test.
      await strategy.connect(admin).setPricePerShareRateLimit(600_000, 0);

      // Frontrun: mint 100 more shares at the stale PPS = 1.0 before the post lands → supply doubles to 200.
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);
      expect(await strategy.totalSupply()).to.equal(200n * e18);

      // Operator declares NAV = 200 for the 100 snapshot shares → declared PPS = 2.0, a +100% move.
      // The reconciled move is only +50% (priceToSet = 300/200 = 1.5), which would slip under the 60% cap.
      // The limiter must measure the declared +100% (1_000_000 micro-bps) and reject it.
      const navAtSnapshot = 200n * e18;
      await expect(strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded')
        .withArgs(1_000_000n, 600_000n);
    });

    it('consumes the declared move from the bucket but stores the reconciled price', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a +150% move (1_500_000 micro-bps), so the declared +100% clears it; refillRate 0.
      await strategy.connect(admin).setPricePerShareRateLimit(1_500_000, 0);

      // Frontrun mint at stale PPS → supply 200.
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);

      // Declared PPS = 2.0 (+100%); reconciled priceToSet = 300/200 = 1.5.
      const navAtSnapshot = 200n * e18;
      await expect(strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true)).to.emit(
        strategy,
        'PricePerShareUpdated'
      );

      // Stored price is the reconciled 1.5, but the bucket was drained by the declared +100% (1_000_000),
      // not the reconciled +50% — leaving 1_500_000 - 1_000_000 = 500_000 of capacity.
      expect(await strategy.pricePerShare()).to.equal((3n * e18) / 2n);
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(500_000n);
    });

    it('pauses on a declared NAV decrease masked by a mid-epoch deposit (soft overflow)', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a -40% move (400_000 micro-bps); refillRate 0.
      await strategy.connect(admin).setPricePerShareRateLimit(400_000, 0);

      // Frontrun: deposit 100 more at the stale PPS = 1.0 → supply 200. Depositing at the (now too-high)
      // stale PPS props the reconciled NAV up and shrinks the apparent loss.
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);

      // Operator declares NAV = 50 for the 100 snapshot shares → declared PPS = 0.5, a -50% move (500_000).
      // Reconciled priceToSet = 150/200 = 0.75, only a -25% move — under the 40% cap. The limiter must
      // measure the declared -50%, exhaust the bucket, store the reconciled 0.75, and pause both paths.
      const navAtSnapshot = 50n * e18;
      await strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, false);

      expect(await strategy.pricePerShare()).to.equal((3n * e18) / 4n);
      expect(await strategy.depositPaused()).to.be.true;
      expect(await strategy.redeemPaused()).to.be.true;
      expect((await strategy.pricePerShareRateLimiterState()).capacityBps).to.equal(0n);
    });

    it('rejects a declared NAV decrease on the declared move even when a redemption amplifies it', async function () {
      await strategy.connect(admin).addDepositAsset(altDeposit.address, directConverter.address, 0);

      // Seed 100 shares at PPS = 1.0.
      const baseDeposit = 100n * e18;
      await altDeposit.mint(user.address, baseDeposit);
      await altDeposit.connect(user).approve(strategy.address, baseDeposit);
      await strategy.connect(user)['deposit(address,uint256,address)'](altDeposit.address, baseDeposit, user.address);
      const supplyAtSnapshot = await strategy.totalSupply();

      // Bucket allows a -55% move (550_000 micro-bps); refillRate 0.
      await strategy.connect(admin).setPricePerShareRateLimit(550_000, 0);

      // Mid-epoch redeem request burns 30 shares at the stale PPS = 1.0 → supply 70. Redemptions at the
      // stale (too-high) PPS *amplify* the reconciled loss rather than mask it.
      await strategy.connect(user).requestRedeem(30n * e18, user.address);
      expect(await strategy.totalSupply()).to.equal(70n * e18);

      // Operator declares NAV = 40 for the 100 snapshot shares → declared PPS = 0.4, a -60% move (600_000).
      // Reconciled priceToSet = (40 - 30)/70 ≈ 0.143, a steeper ~-85.7% move. Either move trips the 55% cap,
      // but the limiter must report the *declared* 600_000 (not the reconciled ~857_143) as the requested move.
      const navAtSnapshot = 40n * e18;
      await expect(strategy.connect(operator).postPricePerShare(navAtSnapshot, supplyAtSnapshot, true))
        .to.be.revertedWithCustomError(strategy, 'PriceRateLimiterRateLimitExceeded')
        .withArgs(600_000n, 550_000n);
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

  let lbtcUnderlying: WBTCMock;
  let stakedToken: StakedLBTCMock;
  let oracle: RatioFeedMock;
  let stakedConverter: ChainlinkConverter;
  let stakedStrategy: MultiAssetWithAsyncRedemptionStrategy;

  let snap: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, , , redeemOperator, user, treasury, operator] = await getSignersWithPrivateKeys();

    const wbtcFactory = await ethers.getContractFactory('WBTCMock');
    const wbtcProxy = await deployContract('WBTCMock', [], true, { initializer: 'initialize' });
    lbtcUnderlying = wbtcFactory.attach(await wbtcProxy.getAddress()) as WBTCMock;
    (lbtcUnderlying as WBTCMock & { address: string }).address = await lbtcUnderlying.getAddress();

    stakedToken = await deployContract<StakedLBTCMock>('StakedLBTCMock', [treasury.address, admin.address, 0], true, {
      initializer: 'initialize',
      unsafeAllow: ['missing-initializer', 'missing-initializer-call']
    });
    (stakedToken as StakedLBTCMock & { address: string }).address = await stakedToken.getAddress();

    const oracleFactory = await ethers.getContractFactory('RatioFeedMock');
    oracle = (await oracleFactory.deploy()) as RatioFeedMock;
    await oracle.waitForDeployment();

    const convFactory = await ethers.getContractFactory('ChainlinkConverter');
    stakedConverter = (await convFactory.deploy(
      await oracle.getAddress(),
      8,
      8,
      HEARTBEAT,
      ethers.ZeroAddress,
      0,
      false
    )) as ChainlinkConverter;
    await stakedConverter.waitForDeployment();
    (stakedConverter as ChainlinkConverter & { address: string }).address = await stakedConverter.getAddress();

    const blocklistOracleAddr = await deployBlocklistOracle(admin.address);

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
    (stakedStrategy as MultiAssetWithAsyncRedemptionStrategy & { address: string }).address =
      await stakedStrategy.getAddress();

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
    (depositToken as WBTCMock & { address: string }).address = await depositToken.getAddress();

    // 8-decimal feed, answer = 1e8 (peg: 1 token = 1 BTC)
    const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
    clFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
    await clFeed.waitForDeployment();
    (clFeed as ChainlinkFeedMock & { address: string }).address = await clFeed.getAddress();

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
    (clConverter as ChainlinkConverter & { address: string }).address = await clConverter.getAddress();

    const blocklistOracleAddr = await deployBlocklistOracle(admin.address);

    const strategyFactory = await ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const proxy = await deployContract(
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
      true
    );
    await proxy.waitForDeployment();
    clStrategy = strategyFactory.attach(await proxy.getAddress()) as MultiAssetWithAsyncRedemptionStrategy;
    (clStrategy as MultiAssetWithAsyncRedemptionStrategy & { address: string }).address = await clStrategy.getAddress();

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

    it('forward: negative exponent (feedDec + tokenDec < baseDec) converts instead of reverting', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // base-per-token feed at peg: answer/1e8 = 1 base natural per 1 token natural
      const feed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await feed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      // token 6 dec, base 18 dec, feed 8 dec → exponent = 8 + 6 - 18 = -4 (would previously underflow-revert)
      const conv = (await convFactory.deploy(
        await feed.getAddress(),
        6,
        18,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkConverter;
      await conv.waitForDeployment();

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
      await expect(clConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverterStaleAnswer'
      );
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverterStaleAnswer'
      );
    });

    it('zero answer reverts with InvalidAnswer', async function () {
      await clFeed.setAnswer(0);
      await expect(clConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverterInvalidAnswer'
      );
      await expect(clConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
        clConverter,
        'ChainlinkConverterInvalidAnswer'
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
          'ChainlinkConverterSequencerDown'
        );
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverterSequencerDown'
        );
      });

      it('sequencer just recovered (within grace period): reverts with GracePeriodNotOver', async function () {
        const block = await ethers.provider.getBlock('latest');
        await seqFeed.setStartedAt(BigInt(block!.timestamp)); // just came back up
        await expect(seqConverter.toBaseUnits(ONE_BTC, 0)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverterGracePeriodNotOver'
        );
        await expect(seqConverter.fromBaseUnits(ONE_BTC, 1)).to.be.revertedWithCustomError(
          seqConverter,
          'ChainlinkConverterGracePeriodNotOver'
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

    it('inverted: negative exponent (feedDec + baseDec < tokenDec) converts instead of reverting', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // token-per-base feed at peg: answer/1e8 = 1 token natural per 1 base natural
      const invFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await invFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      // token 18 dec, base 8 dec, feed 8 dec → exponent = 8 + 8 - 18 = -2 (would previously underflow-revert)
      const conv = (await convFactory.deploy(
        await invFeed.getAddress(),
        18,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkConverter;
      await conv.waitForDeployment();

      // scale = 10^-2 → scaleNumerator = 1, scaleDenominator = 100
      expect(await conv.scaleNumerator()).to.equal(1n);
      expect(await conv.scaleDenominator()).to.equal(100n);

      // 1 token (1e18) at peg → 1 base natural → 1e8 base units; and back.
      const ONE_TOKEN = 10n ** 18n;
      expect(await conv.toBaseUnits(ONE_TOKEN, 0)).to.equal(ONE_BTC);
      expect(await conv.fromBaseUnits(ONE_BTC, 1)).to.equal(ONE_TOKEN);
    });

    it('inverted: negative-exponent round-trip stays within 1 base wei', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      const invFeed = (await feedFactory.deploy(8, ONE_BTC)) as ChainlinkFeedMock;
      await invFeed.waitForDeployment();
      const convFactory = await ethers.getContractFactory('ChainlinkConverter');
      const conv = (await convFactory.deploy(
        await invFeed.getAddress(),
        18,
        8,
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkConverter;
      await conv.waitForDeployment();

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

    it('mismatched feed decimals (6-dec num, 18-dec den) do not truncate to zero', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // Both feeds report a 1:1 price, but with very different decimals.
      // num: 6-dec feed, answer 1e6 (price 1.0)
      // den: 18-dec feed, answer 1e18 (price 1.0)
      const feedNum = (await feedFactory.deploy(6, 10n ** 6n)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(18, 10n ** 18n)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        6, // tokenDecimals
        6, // baseDecimals
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      // 100,000 USDC (6 decimals). With the old two-step computation the
      // intermediate ratio mulDiv(1e11, 1e6, 1e18) floored to 0, losing the
      // entire amount. A single fused mulDiv preserves the 1:1 conversion.
      const amount = 100_000n * 10n ** 6n; // 1e11
      expect(await conv.toBaseUnits(amount, 0)).to.equal(amount);
      expect(await conv.fromBaseUnits(amount, 1)).to.equal(amount);
    });

    it('scaleFwdDen > scaleFwdNum (18-dec token/num, 8-dec base/den) stays exact', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // num: 18-dec feed, answer 1e18 (price 1.0)
      // den: 8-dec feed, answer 1e8 (price 1.0)
      // fwdExp = (denDec+baseDec) - (numDec+tokenDec) = (8+8) - (18+18) = -20,
      // so the netted scales are scaleFwdNum = 1 and scaleFwdDen = 10^20 (den >> num).
      const feedNum = (await feedFactory.deploy(18, 10n ** 18n)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(8, 10n ** 8n)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        18, // tokenDecimals
        8, // baseDecimals
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

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
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // 18-dec feeds, 18-dec token, 18-dec base => fwd/inv net exponents are 0,
      // so the applied scale is 1. With the *un-netted* scaling the converter would
      // multiply the answer by 10^(18+18)=10^36; an answer of 1e42 would then form
      // 1e78 > 2^256 and revert, blocking a legitimate price. Netting avoids this.
      const bigAnswer = 10n ** 42n;
      const feedNum = (await feedFactory.deploy(18, bigAnswer)) as ChainlinkFeedMock;
      const feedDen = (await feedFactory.deploy(18, bigAnswer)) as ChainlinkFeedMock;
      await feedNum.waitForDeployment();
      await feedDen.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      const conv = (await convFactory.deploy(
        await feedNum.getAddress(),
        await feedDen.getAddress(),
        18, // tokenDecimals
        18, // baseDecimals
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        false
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

      // num == den (1:1) at equal decimals => 1 token maps to 1 base unit, no revert.
      const oneToken = 10n ** 18n;
      expect(await conv.toBaseUnits(oneToken, 0)).to.equal(oneToken);
      expect(await conv.fromBaseUnits(oneToken, 1)).to.equal(oneToken);
    });

    it('inverted mode is unchanged by netting (ETH/USD ÷ BTC/USD style)', async function () {
      const feedFactory = await ethers.getContractFactory('ChainlinkFeedMock');
      // Same economic setup as the forward cross test but deployed inverted with the
      // feeds swapped, which must yield identical results.
      const ethUsd = (await feedFactory.deploy(8, 2500n * ONE_BTC)) as ChainlinkFeedMock;
      const btcUsd = (await feedFactory.deploy(8, 50_000n * ONE_BTC)) as ChainlinkFeedMock;
      await ethUsd.waitForDeployment();
      await btcUsd.waitForDeployment();

      const convFactory = await ethers.getContractFactory('ChainlinkCompositeConverter');
      // inverted = true with (num=BTC/USD, den=ETH/USD): ratio is den/num = ETH/BTC.
      const conv = (await convFactory.deploy(
        await btcUsd.getAddress(),
        await ethUsd.getAddress(),
        18, // tokenDecimals (ETH)
        8, // baseDecimals (BTC)
        HEARTBEAT,
        ethers.ZeroAddress,
        0,
        true
      )) as ChainlinkCompositeConverter;
      await conv.waitForDeployment();

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
      const back = await clStrategy.convertToAssets(tAddr, shares);

      expect(back).to.be.lte(assets);
      expect(assets - back).to.be.lte(1n);
    });
  });
});
