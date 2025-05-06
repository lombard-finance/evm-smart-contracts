import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { WBTCMock, LBTC, CBBTCPMM } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';

describe('CBBTCPMM', function () {
  let pmm: CBBTCPMM;
  let cbbtc: WBTCMock;
  let lbtc: LBTC;

  let deployer: HardhatEthersSigner;
  let withdrawalAddress: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;

  let snapshot: SnapshotRestorer;

  async function deploy<T>(contractName: string, asType: string, args: any[] = [], isProxy: boolean = true) {
    const factory = await ethers.getContractFactory(contractName);
    const contract = isProxy ? await upgrades.deployProxy(factory, args) : await factory.deploy(...args);
    await contract.waitForDeployment();
    return (await ethers.getContractFactory(asType)).attach(await contract.getAddress()) as T;
  }

  before(async function () {
    [deployer, withdrawalAddress, signer1, signer2, operator, pauser] = await ethers.getSigners();

    cbbtc = await deploy<WBTCMock>('WBTCMock', 'WBTCMock');
    await cbbtc.setDecimals(8);
    lbtc = await deploy<StakedLBTC>('StakedLBTC', 'StakedLBTC', [
      ethers.hexlify(ethers.randomBytes(20)),
      1000, // not relevant for CBBTC tests
      deployer.address, // not relevant for CBBTC tests, but can not be zero
      deployer.address
    ]);
    pmm = await deploy<CBBTCPMM>('CBBTCPMM', 'CBBTCPMM', [
      await lbtc.getAddress(),
      await cbbtc.getAddress(),
      await deployer.getAddress(),
      ethers.parseUnits('30', 8),
      await withdrawalAddress.getAddress(),
      1000 // 10%
    ]);

    await pmm.grantRole(await pmm.OPERATOR_ROLE(), await operator.getAddress());

    snapshot = await takeSnapshot();
  });

  afterEach(async function () {
    // get back to a clean state
    await snapshot.restore();
  });

  describe('Access Control', function () {
    it('should revert if withdrawal address is not set by the admin', async function () {
      await expect(pmm.connect(signer1).setWithdrawalAddress(await signer1.getAddress()))
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it('should revert if stake limit is set by non-operator', async function () {
      await expect(pmm.connect(signer1).setStakeLimit(100))
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.OPERATOR_ROLE());
    });

    it('should revert if pause is triggered by non-pauser', async function () {
      await expect(pmm.pause())
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(deployer.address, await pmm.PAUSER_ROLE());
    });

    it('should revert if unpause is triggered by non-admin', async function () {
      await expect(pmm.connect(signer1).unpause())
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it('should revert if withdrawCBBTC is triggered by non-admin', async function () {
      await expect(pmm.connect(signer1).withdrawCBBTC(100))
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it('should revert if withdrawLBTC is triggered by non-admin', async function () {
      await expect(pmm.connect(signer1).withdrawLBTC(100))
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it('should revert if contract is not paused', async function () {
      await expect(pmm.unpause()).to.be.revertedWithCustomError(pmm, 'ExpectedPause');
    });

    describe('With Pauser', function () {
      beforeEach(async function () {
        await pmm.grantRole(await pmm.PAUSER_ROLE(), await pauser.getAddress());
      });

      it('should pause the contract', async function () {
        await expect(pmm.connect(pauser).pause()).to.emit(pmm, 'Paused').withArgs(pauser.address);
        expect(await pmm.paused()).to.be.true;
      });

      it('should unpause the contract', async function () {
        await pmm.connect(pauser).pause();
        await expect(pmm.unpause()).to.emit(pmm, 'Unpaused').withArgs(deployer.address);
        expect(await pmm.paused()).to.be.false;
      });
    });

    it('should set the withdrawal address', async function () {
      await expect(pmm.setWithdrawalAddress(withdrawalAddress.address))
        .to.emit(pmm, 'WithdrawalAddressSet')
        .withArgs(withdrawalAddress.address);
      expect(await pmm.withdrawalAddress()).to.equal(withdrawalAddress.address);
    });

    it('should set the stake limit', async function () {
      await expect(pmm.connect(operator).setStakeLimit(100)).to.emit(pmm, 'StakeLimitSet').withArgs(100);
      expect(await pmm.stakeLimit()).to.equal(100);
      expect(await pmm.remainingStake()).to.equal(100);
    });

    it('should set the relative fee', async function () {
      await expect(pmm.setRelativeFee(100)).to.emit(pmm, 'RelativeFeeChanged').withArgs(1000, 100);
      expect(await pmm.relativeFee()).to.equal(100);
    });

    it('should fail to set the relative fee if not admin', async function () {
      await expect(pmm.connect(signer1).setRelativeFee(100))
        .to.be.revertedWithCustomError(pmm, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it('should fail to set the relative fee if over max commission', async function () {
      const iface = {
        interface: ethers.Interface.from(['error BadCommission()'])
      };
      await expect(pmm.setRelativeFee(10001)).to.be.revertedWithCustomError(iface, 'BadCommission');
    });
  });

  describe('Operations', function () {
    beforeEach(async function () {
      await pmm.grantRole(await pmm.PAUSER_ROLE(), await pauser.getAddress());

      // some cbbtc for signers
      await cbbtc.mint(await signer1.getAddress(), ethers.parseUnits('100', 8));
      await cbbtc.mint(await signer2.getAddress(), ethers.parseUnits('100', 8));
    });

    it('should fail to swap if PMM is not whitelisted as minter', async function () {
      await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('1', 8));
      await expect(pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('1', 8)))
        .to.be.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
        .withArgs(await pmm.getAddress());
    });

    describe('With whitelisted minter', function () {
      beforeEach(async function () {
        await lbtc.addMinter(await pmm.getAddress());
      });

      it('should allow swaps', async function () {
        await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('11', 8));
        await expect(pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('11', 8)))
          .to.emit(cbbtc, 'Transfer')
          .withArgs(signer1.address, await pmm.getAddress(), ethers.parseUnits('11', 8))
          .to.emit(lbtc, 'Transfer')
          .withArgs(ethers.ZeroAddress, signer1.address, ethers.parseUnits('9.9', 8))
          .to.emit(lbtc, 'Transfer')
          .withArgs(ethers.ZeroAddress, await pmm.getAddress(), ethers.parseUnits('1.1', 8));
        expect(await lbtc.balanceOf(signer1.address)).to.equal(ethers.parseUnits('9.9', 8));
        expect(await lbtc.balanceOf(await pmm.getAddress())).to.equal(ethers.parseUnits('1.1', 8));
        expect(await cbbtc.balanceOf(signer1.address)).to.equal(ethers.parseUnits('89', 8));
        expect(await cbbtc.balanceOf(await pmm.getAddress())).to.equal(ethers.parseUnits('11', 8));
      });

      it('should fail to swap more than limit', async function () {
        await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('130', 8));
        await expect(pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('130', 8))).to.be.revertedWithCustomError(
          pmm,
          'StakeLimitExceeded'
        );
      });

      it('should allow more swaps if limit is increased', async function () {
        await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('30', 8));
        await pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('30', 8));
        expect(await pmm.remainingStake()).to.equal(0);

        await pmm.connect(operator).setStakeLimit(ethers.parseUnits('40', 8));
        expect(await pmm.remainingStake()).to.equal(ethers.parseUnits('10', 8));
        await cbbtc.connect(signer2).approve(await pmm.getAddress(), ethers.parseUnits('10', 8));
        await pmm.connect(signer2).swapCBBTCToLBTC(ethers.parseUnits('10', 8));
        expect(await pmm.remainingStake()).to.equal(0);
      });

      it('should allow withdrawals', async function () {
        await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('30', 8));
        await pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('30', 8));

        await expect(pmm.withdrawCBBTC(1))
          .to.emit(cbbtc, 'Transfer')
          .withArgs(await pmm.getAddress(), await withdrawalAddress.getAddress(), 1);
        expect(await cbbtc.balanceOf(await withdrawalAddress.getAddress())).to.equal(1);

        await expect(pmm.withdrawLBTC(1))
          .to.emit(lbtc, 'Transfer')
          .withArgs(await pmm.getAddress(), await withdrawalAddress.getAddress(), 1);
        expect(await lbtc.balanceOf(await withdrawalAddress.getAddress())).to.equal(1);
      });

      it('should have zero remaining stake if total stake is greater than limit', async function () {
        await cbbtc.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits('30', 8));
        await pmm.connect(signer1).swapCBBTCToLBTC(ethers.parseUnits('30', 8));

        await pmm.connect(operator).setStakeLimit(ethers.parseUnits('20', 8));
        expect(await pmm.remainingStake()).to.equal(0);
      });

      describe('When Paused', function () {
        beforeEach(async function () {
          await pmm.connect(pauser).pause();
        });

        it('should revert swaps', async function () {
          await cbbtc.connect(signer1).approve(await pmm.getAddress(), 30);
          await expect(pmm.connect(signer1).swapCBBTCToLBTC(30)).to.be.revertedWithCustomError(pmm, 'EnforcedPause');
        });

        it('should revert withdrawals', async function () {
          await expect(pmm.withdrawCBBTC(1)).to.be.revertedWithCustomError(pmm, 'EnforcedPause');
        });
      });
    });
  });
});
