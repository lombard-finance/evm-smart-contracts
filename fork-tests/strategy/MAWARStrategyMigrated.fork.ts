import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { deployContract } from '../../test/helpers';
import {
  BlocklistOracle,
  MAWARStrategyMigrated,
  ProxyFactory,
  Shard,
  ERC4626VaultWrapper,
  MultiAssetWithAsyncRedemptionStrategy,
  ProxyAdmin,
  MerkleAllowlistValidator,
  DirectConverter
} from '../../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// yarn hardhat vars set FORKING_BLOCK 25086289
const BTCE_ADDRESS = '0x3a4baaBf4DC9910596821615e848f0e6545762F3';
const ADMIN_ADDRESS = '0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892';
const TIMELOCK_ADDRESS = '0x055E84e7FE8955E2781010B866f10Ef6E1E77e59';
const BTCE_HOLDER_ADDRESS = '0x892BdA0B728bD2f5ad60f349309d32435037CAa8';
const LBTCV_ADDRESS = '0x5401b8620e5fb570064ca9114fd1e135fd77d57c';
const BTCB_ADDRESS = '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072';
const BTCB_HOLDER_ADDRESS = '0x640588C53A60328Ed9834af839132a3918336830';

const describeFork = process.env.HARDHAT_FORK === '1' ? describe : describe.skip;

describeFork('MAWARStrategyMigrated (mainnet fork)', function () {
  this.timeout(180_000);

  let admin: HardhatEthersSigner;
  let timelock: HardhatEthersSigner;
  let blocklistOracle: BlocklistOracle;
  let vaultWrapper: ERC4626VaultWrapper;
  let vaultWrapperProxyAdmin: ProxyAdmin;
  let migratedStrategyImpl: string;
  let strategyImpl: string;
  let shard: Shard;
  let validator: MerkleAllowlistValidator;
  let strategy: MultiAssetWithAsyncRedemptionStrategy;
  let directConverter: DirectConverter;
  let btcbHolder: HardhatEthersSigner;

  before(async function () {
    admin = await ethers.getImpersonatedSigner(ADMIN_ADDRESS);
    timelock = await ethers.getImpersonatedSigner(TIMELOCK_ADDRESS);
    btcbHolder = await ethers.getImpersonatedSigner(BTCB_HOLDER_ADDRESS);
    vaultWrapper = await ethers.getContractAt('ERC4626VaultWrapper', BTCE_ADDRESS);
    vaultWrapperProxyAdmin = await ethers.getContractAt(
      'ProxyAdmin',
      await upgrades.erc1967.getAdminAddress(await vaultWrapper.getAddress())
    );
    blocklistOracle = await deployContract<BlocklistOracle>('BlocklistOracle', [0, admin.address]);
    migratedStrategyImpl = await (
      await deployContract<MAWARStrategyMigrated>('MAWARStrategyMigrated', [], false)
    ).getAddress();
    strategyImpl = await (
      await deployContract<MultiAssetWithAsyncRedemptionStrategy>('MultiAssetWithAsyncRedemptionStrategy', [], false)
    ).getAddress();
    validator = await deployContract<MerkleAllowlistValidator>('MerkleAllowlistValidator', [admin.address], false);
    shard = await deployContract<Shard>('Shard', [
      await vaultWrapper.getAddress(),
      await validator.getAddress(),
      admin.address,
      admin.address
    ]);
    strategy = await ethers.getContractAt('MultiAssetWithAsyncRedemptionStrategy', await vaultWrapper.getAddress());
    directConverter = await deployContract<DirectConverter>('DirectConverter', [], false);

    // top up impersonated accounts
    const [deployer] = await ethers.getSigners();
    await deployer.sendTransaction({ to: timelock, value: ethers.parseEther('1') });
    await deployer.sendTransaction({ to: admin, value: ethers.parseEther('1') });
    await deployer.sendTransaction({ to: BTCB_HOLDER_ADDRESS, value: ethers.parseEther('1') });
  });

  it('migrate VaultWrapper to MAWARStrategyMigrated', async function () {
    await vaultWrapperProxyAdmin
      .connect(timelock)
      .upgradeAndCall(await vaultWrapper.getAddress(), migratedStrategyImpl, '0x');
    const migratedStrategy = await ethers.getContractAt('MAWARStrategyMigrated', await vaultWrapper.getAddress());

    const migrationTx = await migratedStrategy.connect(admin).migrate(blocklistOracle, BTCB_ADDRESS, 8, admin.address);
    await migrationTx.wait();

    expect(migrationTx).to.be.not.reverted;
    expect(migrationTx).to.emit(migratedStrategy, 'PricePerShareUpdated');

    const roleTx = await strategy.connect(admin).grantRole(await strategy.MANAGER_ROLE(), admin.address);
    expect(roleTx).to.emit(strategy, 'RoleGranted');

    await strategy.connect(admin).grantRole(await strategy.PRICE_SETTER_ROLE(), admin.address);
    await strategy.connect(admin).grantRole(await strategy.PAY_REDEMPTIONS_ROLE(), admin.address);
    await strategy.connect(admin).grantRole(await strategy.STRATEGY_PAUSER_ROLE(), admin.address);
    await strategy.connect(admin).grantRole(await strategy.TRANSFERS_PAUSER_ROLE(), admin.address);
  });

  it('getters return expected values', async function () {
    const strategy = await ethers.getContractAt(
      'MultiAssetWithAsyncRedemptionStrategy',
      await vaultWrapper.getAddress()
    );

    expect(await strategy.decimals()).to.equal(8);
    expect(await strategy.asset()).to.equal(BTCB_ADDRESS);
    expect(await strategy.blocklistOracle()).to.equal(blocklistOracle);
    expect(await strategy.pricePerShare()).to.equal(1e8);

    const limiterState = await strategy.pricePerShareRateLimiterState();
    expect(limiterState.lastRefill).to.not.equal(0);
    expect(limiterState.capacityBps).to.equal(0);
    expect(limiterState.maxBps).to.equal(0);
    expect(limiterState.refillRate).to.equal(0);

    expect(await strategy.totalAssets()).to.equal(50427795796);
    expect(await strategy.totalSupply()).to.equal(50427795796);

    expect(await strategy.shards()).to.deep.equal([]);

    expect(await strategy.depositPaused()).to.be.false;
    expect(await strategy.redeemPaused()).to.be.false;

    expect(await strategy.owner()).to.equal(admin.address);
    expect(await strategy.paused()).to.be.false;

    expect(await strategy.balanceOf(BTCE_HOLDER_ADDRESS)).to.equal(13479594112);

    expect(await strategy.name()).to.equal('Bitcoin Earn');
    expect(await strategy.symbol()).to.equal('BTCe');

    expect(await strategy.redeemFee()).to.equal(0);
    const totalPending = await strategy.totalPending();
    expect(totalPending.totalPendingShares).to.equal(0);
    expect(totalPending.totalPendingAssets).to.equal(0);

    expect(await strategy.pendingAssetsOf(admin)).to.equal(0);

    const performanceFee = await strategy.performanceFee();
    expect(performanceFee.feeBps).to.equal(0);
    expect(performanceFee.previewShares).to.equal(0);
    expect(performanceFee.performanceHighWaterMark).to.equal(1e8);
  });

  it('set treasuries', async function () {
    await strategy.connect(admin).setFeeTreasury(admin.address);
    await strategy.connect(admin).setManagementFeeTreasury(admin.address);

    expect(await strategy.feeTreasury()).to.equal(admin.address);

    const managementFee = await strategy.managementFee();
    expect(managementFee.feeBps).to.equal(0);
    expect(managementFee.lastHarvestAt).to.not.equal(0);
    expect(managementFee.managementFeeTreasury_).to.equal(admin.address);
  });

  it('register shard and pull LBTCv', async function () {
    await strategy.connect(admin).registerShard(shard);
    await shard.connect(admin).pullFromStrategy(LBTCV_ADDRESS, 50427795796n);
    const lbtcv = await ethers.getContractAt('TokenMock', LBTCV_ADDRESS);
    expect(await lbtcv.balanceOf(shard)).to.equal(50427795796n);
  });

  it('deposit BTC.b', async function () {
    const btcb = await ethers.getContractAt('TokenMock', BTCB_ADDRESS);
    const BTCB_ONE = 1e8;

    await strategy.connect(admin).addDepositAsset(BTCB_ADDRESS, directConverter, 0);

    await btcb.connect(btcbHolder).approve(strategy, BTCB_ONE);
    await strategy.connect(btcbHolder)['deposit(address,uint256,address)'](BTCB_ADDRESS, BTCB_ONE, BTCB_HOLDER_ADDRESS);
    expect(await strategy.balanceOf(BTCB_HOLDER_ADDRESS)).to.equal(BTCB_ONE);
  });

  it('redeem shares', async function () {
    const ONE_SHARE = 1e8;

    const btceHolder = await ethers.getImpersonatedSigner(BTCE_HOLDER_ADDRESS);
    await strategy.connect(btcbHolder).approve(strategy, ONE_SHARE);
    await strategy.connect(btceHolder).requestRedeem(ONE_SHARE, BTCE_HOLDER_ADDRESS);

    await strategy.connect(admin).fulfillRedeemRequests([1]);
  });
});
