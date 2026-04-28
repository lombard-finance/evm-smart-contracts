import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/takeSnapshot';
import { getSignersWithPrivateKeys, Signer } from '../helpers';
import type {
  MockIdentityAssetConverter,
  MockVaultToken,
  MultiAssetWithAsyncRedemptionVault
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

  let underlying: MockVaultToken;
  let altDeposit: MockVaultToken;
  let converter: MockIdentityAssetConverter;
  let vault: MultiAssetWithAsyncRedemptionVault;

  let snapshot: SnapshotRestorer;

  before(async function () {
    [admin, strategyDeployer, controllerManager, redeemController, redeemOperator, user, treasury] =
      await getSignersWithPrivateKeys();

    const tokenFactory = await ethers.getContractFactory('MockVaultToken');
    underlying = (await tokenFactory.deploy()) as MockVaultToken;
    altDeposit = (await tokenFactory.deploy()) as MockVaultToken;
    await underlying.waitForDeployment();
    await altDeposit.waitForDeployment();

    const convFactory = await ethers.getContractFactory('MockIdentityAssetConverter');
    converter = (await convFactory.deploy()) as MockIdentityAssetConverter;
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
    const u = await underlying.getAddress();

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

    await expect(vault.connect(treasury).setDepositFeeBps(alt, 10))
      .to.emit(vault, 'DepositFeeBpsSet')
      .withArgs(alt, 10);
    expect(await vault.depositFeeBps(alt)).to.equal(10);
  });

  it('admin can swap asset converter for a listed deposit asset', async function () {
    const alt = await altDeposit.getAddress();
    await vault.connect(admin).addDepositAsset(alt, await converter.getAddress(), 0);

    const convFactory = await ethers.getContractFactory('MockIdentityAssetConverter');
    const next = (await convFactory.deploy()) as MockIdentityAssetConverter;
    await next.waitForDeployment();
    const nextAddr = await next.getAddress();

    await expect(vault.connect(admin).setAssetConverter(alt, nextAddr))
      .to.emit(vault, 'DepositAssetConverterSet')
      .withArgs(alt, nextAddr);
    expect(await vault.converterOf(alt)).to.equal(nextAddr);
  });
});
