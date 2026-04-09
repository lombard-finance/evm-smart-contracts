import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Strategy, SatelliteStrategy } from '../../typechain-types/contracts/vault';
import type {
  MockVaultForStrategy,
  MockStrategyValidator,
  ExecTargetMock,
  MockVaultToken
} from '../../typechain-types/contracts/mock/StrategyVaultMocks.sol';

const BEACON_PROXY_FQ =
  '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy';
const UPGRADEABLE_BEACON_FQ =
  '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon';

function encodeCallVerificationInput(ruleEncoded: string, merkleProof: string[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(bytes ruleEncoded, bytes32[] merkleProof)'],
    [{ ruleEncoded, merkleProof }]
  );
}

describe('Strategy / SatelliteStrategy (002)', function () {
  async function deployStrategyViaBeacon() {
    const [deployer, admin, liquidity, user] = await ethers.getSigners();

    const Tok = await ethers.getContractFactory('MockVaultToken');
    const token = (await Tok.deploy()) as MockVaultToken;
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory('MockVaultForStrategy');
    const vault = (await Vault.deploy(await token.getAddress())) as MockVaultForStrategy;
    await vault.waitForDeployment();

    const Val = await ethers.getContractFactory('MockStrategyValidator');
    const validator = (await Val.deploy()) as MockStrategyValidator;
    await validator.waitForDeployment();

    const Impl = await ethers.getContractFactory('Strategy');
    const impl = await Impl.deploy();
    await impl.waitForDeployment();

    const Beacon = await ethers.getContractFactory(UPGRADEABLE_BEACON_FQ);
    const beacon = await Beacon.deploy(await impl.getAddress(), deployer.address);
    await beacon.waitForDeployment();

    const init = Impl.interface.encodeFunctionData('initialize', [
      await vault.getAddress(),
      await validator.getAddress(),
      admin.address,
      liquidity.address
    ]);

    const BP = await ethers.getContractFactory(BEACON_PROXY_FQ);
    const proxy = await BP.deploy(await beacon.getAddress(), init);
    await proxy.waitForDeployment();

    const strategy = Impl.attach(await proxy.getAddress()) as Strategy;

    return {
      deployer,
      admin,
      liquidity,
      user,
      token,
      vault,
      validator,
      beacon,
      strategy
    };
  }

  async function deploySatelliteViaBeacon() {
    const [deployer, admin, user] = await ethers.getSigners();

    const Val = await ethers.getContractFactory('MockStrategyValidator');
    const validator = (await Val.deploy()) as MockStrategyValidator;
    await validator.waitForDeployment();

    const Impl = await ethers.getContractFactory('SatelliteStrategy');
    const impl = await Impl.deploy();
    await impl.waitForDeployment();

    const Beacon = await ethers.getContractFactory(UPGRADEABLE_BEACON_FQ);
    const beacon = await Beacon.deploy(await impl.getAddress(), deployer.address);
    await beacon.waitForDeployment();

    const init = Impl.interface.encodeFunctionData('initialize', [
      await validator.getAddress(),
      admin.address
    ]);

    const BP = await ethers.getContractFactory(BEACON_PROXY_FQ);
    const proxy = await BP.deploy(await beacon.getAddress(), init);
    await proxy.waitForDeployment();

    const satellite = Impl.attach(await proxy.getAddress()) as SatelliteStrategy;

    return { deployer, admin, user, validator, satellite };
  }

  describe('Strategy beacon + pipe', function () {
    it('pullFromVault / pushToVault require VAULT_TOKEN_LIQUIDITY_ROLE', async function () {
      const { strategy, user } = await deployStrategyViaBeacon();
      await expect(strategy.connect(user).pullFromVault(1)).to.be.revertedWithCustomError(
        strategy,
        'AccessControlUnauthorizedAccount'
      );
      await expect(strategy.connect(user).pushToVault(1)).to.be.revertedWithCustomError(
        strategy,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('pullFromVault transfers from vault after registerStrategy; pushToVault returns', async function () {
      const { token, vault, strategy, liquidity } = await deployStrategyViaBeacon();
      const amount = ethers.parseEther('100');

      await token.mint(await vault.getAddress(), amount);
      await vault.registerStrategy(await strategy.getAddress());

      await expect(strategy.connect(liquidity).pullFromVault(amount))
        .to.emit(strategy, 'PulledFromVault')
        .withArgs(amount);

      expect(await token.balanceOf(await strategy.getAddress())).to.equal(amount);

      await expect(strategy.connect(liquidity).pushToVault(amount))
        .to.emit(strategy, 'PushedToVault')
        .withArgs(amount);

      expect(await token.balanceOf(await vault.getAddress())).to.equal(amount);
      expect(await token.balanceOf(await strategy.getAddress())).to.equal(0n);
    });
  });

  describe('exec', function () {
    it('reverts when validator denies', async function () {
      const { strategy, validator, user } = await deployStrategyViaBeacon();
      const target = await (
        await ethers.getContractFactory('ExecTargetMock')
      ).deploy();
      await target.waitForDeployment();

      await validator.setGlobalAllow(false);
      const data = target.interface.encodeFunctionData('ping', []);
      const vargs = encodeCallVerificationInput('0x', []);

      await expect(
        strategy.connect(user).exec(await target.getAddress(), 0, data, vargs, { value: 0 })
      ).to.be.revertedWithCustomError(strategy, 'CallNotAllowed');
    });

    it('succeeds when validator allows; passes msg.sender to isAllowed', async function () {
      const { strategy, validator, user } = await deployStrategyViaBeacon();
      const target = (await (
        await ethers.getContractFactory('ExecTargetMock')
      ).deploy()) as ExecTargetMock;
      await target.waitForDeployment();

      await validator.setGlobalAllow(false);
      await validator.setSenderAllowed(user.address, true);

      const data = target.interface.encodeFunctionData('ping', []);
      const vargs = encodeCallVerificationInput('0x', []);

      await expect(strategy.connect(user).exec(await target.getAddress(), 0, data, vargs))
        .to.emit(strategy, 'Executed')
        .withArgs(user.address, await target.getAddress(), 0, data);

      expect(await target.pingCount()).to.equal(1n);
    });

    it('funds value via msg.value == value', async function () {
      const { strategy, validator, user } = await deployStrategyViaBeacon();
      const target = (await (
        await ethers.getContractFactory('ExecTargetMock')
      ).deploy()) as ExecTargetMock;
      await target.waitForDeployment();

      await validator.setSenderAllowed(user.address, true);
      const data = target.interface.encodeFunctionData('ping', []);
      const vargs = encodeCallVerificationInput('0x', []);
      const oneEth = ethers.parseEther('1');

      await expect(
        strategy.connect(user).exec(await target.getAddress(), oneEth, data, vargs, { value: oneEth })
      ).to.emit(strategy, 'Executed');

      expect(await target.lastValueReceived()).to.equal(oneEth);
    });

    it('funds value from balance left by prior exec msg.value', async function () {
      const { strategy, validator, user } = await deployStrategyViaBeacon();
      const target = (await (
        await ethers.getContractFactory('ExecTargetMock')
      ).deploy()) as ExecTargetMock;
      await target.waitForDeployment();

      await validator.setSenderAllowed(user.address, true);
      const data = target.interface.encodeFunctionData('ping', []);
      const vargs = encodeCallVerificationInput('0x', []);
      const oneEth = ethers.parseEther('1');

      await strategy.connect(user).exec(await target.getAddress(), 0, data, vargs, { value: oneEth });

      await expect(
        strategy.connect(user).exec(await target.getAddress(), oneEth, data, vargs)
      ).to.emit(strategy, 'Executed');

      expect(await target.lastValueReceived()).to.equal(oneEth);
    });

    it('reverts on bare ETH transfer to strategy', async function () {
      const { strategy, deployer } = await deployStrategyViaBeacon();
      await expect(
        deployer.sendTransaction({
          to: await strategy.getAddress(),
          value: 1n
        })
      ).to.be.reverted;
    });
  });

  describe('SatelliteStrategy', function () {
    it('exposes exec but not vault pipe functions', async function () {
      const { satellite, validator, user } = await deploySatelliteViaBeacon();
      expect(await satellite.validator()).to.be.properAddress;
      expect(satellite.interface.hasFunction('pullFromVault')).to.equal(false);
      expect(satellite.interface.hasFunction('vault')).to.equal(false);

      const target = (await (
        await ethers.getContractFactory('ExecTargetMock')
      ).deploy()) as ExecTargetMock;
      await target.waitForDeployment();
      await validator.setSenderAllowed(user.address, true);
      const data = target.interface.encodeFunctionData('ping', []);
      const vargs = encodeCallVerificationInput('0x', []);

      await expect(satellite.connect(user).exec(await target.getAddress(), 0, data, vargs)).to.not.be
        .reverted;
    });
  });
});
