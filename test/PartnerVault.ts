import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  getSignersWithPrivateKeys,
  CHAIN_ID,
  NEW_VALSET,
  DEPOSIT_BTC_ACTION,
  encode,
  getPayloadForAction,
  Signer,
  initLBTC
} from './helpers';
import { FBTCPartnerVault, LBTCMock, LockedFBTCMock, WBTCMock } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('FBTCPartnerVault', function () {
  let deployer: Signer, signer1: Signer, signer2: Signer, signer3: Signer, treasury: Signer;
  let partnerVault: FBTCPartnerVault;
  let lockedFbtc: LockedFBTCMock;
  let fbtc: WBTCMock;
  let lbtc: LBTCMock;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  const oneLbtc = 100000000;
  const pauserRoleHash = '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a';
  const operatorRoleHash = '0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929';

  before(async function () {
    [deployer, signer1, signer2, signer3, treasury] = await getSignersWithPrivateKeys();

    const burnCommission = 1000;
    const result = await initLBTC(burnCommission, deployer.address, deployer.address);
    lbtc = result.lbtc;

    fbtc = await deployContract<WBTCMock>('WBTCMock', []);

    partnerVault = await deployContract<FBTCPartnerVault>('FBTCPartnerVault', [
      deployer.address,
      await fbtc.getAddress(),
      await lbtc.getAddress(),
      oneLbtc
    ]);

    lockedFbtc = await deployContract<LockedFBTCMock>('LockedFBTCMock', [await fbtc.getAddress()], false);

    await lbtc.changeTreasuryAddress(treasury.address);

    // set partner vault as minter for lbtc
    await lbtc.addMinter(await partnerVault.getAddress());

    // Initialize the permit module
    await lbtc.reinitialize();

    // Set lockedFbtc contract on partner vault
    partnerVault.setLockedFbtc(await lockedFbtc.getAddress());

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore();
  });

  describe('Setters and getters', function () {
    it('should be able to set the locked fbtc contract as admin', async function () {
      await expect(partnerVault.setLockedFbtc(signer2.address));
    });
    it('should not be able to set the locked fbtc contract as anyone else', async function () {
      await expect(partnerVault.connect(signer1)['setLockedFbtc(address)'](signer2.address)).to.be.reverted;
    });
    it('should be able to set a stake limit as operator', async function () {
      const stakeLimit = 20;
      await partnerVault.grantRole(operatorRoleHash, signer1.address);
      await expect(partnerVault.connect(signer1)['setStakeLimit(uint256)'](stakeLimit))
        .to.emit(partnerVault, 'StakeLimitSet')
        .withArgs(stakeLimit);

      expect(await partnerVault.stakeLimit()).to.be.equal(stakeLimit);
    });
    it('should not be able to set a stake limit as anyone else', async function () {
      await expect(partnerVault.connect(signer2)['setStakeLimit(uint256)'](20)).to.be.reverted;
    });
    it('should be able to pause the contract as pauser', async function () {
      await partnerVault.grantRole(pauserRoleHash, signer1.address);
      await expect(partnerVault.connect(signer1)['pause()']());
    });
    it('should not be able to pause the contract as anyone else', async function () {
      await expect(partnerVault.connect(signer2)['pause()']()).to.be.reverted;
    });
    it('should be able to unpause the contract as admin', async function () {
      await partnerVault.grantRole(pauserRoleHash, signer1.address);
      await expect(partnerVault.connect(signer1)['pause()']());
      await expect(partnerVault.unpause());
    });
    it('should not be able to unpause the contract as anyone else', async function () {
      await partnerVault.grantRole(pauserRoleHash, signer1.address);
      await expect(partnerVault.connect(signer1)['pause()']());
      await expect(partnerVault.connect(signer1)['pause()']()).to.be.reverted;
    });
    it('should be able to retrieve the stake limit', async function () {
      expect(await partnerVault.stakeLimit()).to.be.equal(oneLbtc);
    });
    it('should be able to retrieve the remaining stake', async function () {
      // We will mint some just to check that the computation is correct.
      await snapshot.restore();
      await partnerVault.setLockedFbtc(await lockedFbtc.getAddress());
      const mintAmount = 10;
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      await partnerVault.connect(signer1)['mint(uint256)'](mintAmount);

      expect(await partnerVault.remainingStake()).to.be.equal(oneLbtc - mintAmount);
    });
    it('should be able to set minting as admin', async function () {
      expect(await partnerVault.setAllowMintLbtc(true));
      expect(await partnerVault.allowMintLbtc()).to.be.equal(true);
    });
    it('should not be able to set minting as non-admin', async function () {
      await expect(partnerVault.connect(signer1)['setAllowMintLbtc(bool)'](true)).to.be.reverted;
    });
  });
  describe('FBTC locking', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await partnerVault.setLockedFbtc(await lockedFbtc.getAddress());
      await partnerVault.setAllowMintLbtc(true);
    });
    it('should be able to mint LBTC on depositing FBTC', async function () {
      const mintAmount = 10;
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      expect(await partnerVault.connect(signer1)['mint(uint256)'](mintAmount))
        .to.emit(fbtc, 'Transfer')
        .withArgs(signer1.address, await partnerVault.getAddress(), mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), await lockedFbtc.getAddress(), mintAmount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, mintAmount);
      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(mintAmount);
    });
    it('should not mint LBTC when minting is turned off', async function () {
      const mintAmount = 10;
      await fbtc.mint(signer1.address, mintAmount);
      await partnerVault.setAllowMintLbtc(false);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      expect(await partnerVault.connect(signer1)['mint(uint256)'](mintAmount))
        .to.emit(fbtc, 'Transfer')
        .withArgs(signer1.address, await partnerVault.getAddress(), mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), await lockedFbtc.getAddress(), mintAmount);
      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
    });
    it('should not be able to mint LBTC without depositing', async function () {
      const mintAmount = 10;
      await fbtc.mint(signer1.address, mintAmount);
      await expect(partnerVault.connect(signer1)['mint(uint256)'](mintAmount)).to.be.reverted;
    });
    it('should not be able to mint 0 LBTC', async function () {
      const mintAmount = 10;
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      await expect(partnerVault.connect(signer1)['mint(uint256)'](0)).to.be.revertedWithCustomError(
        partnerVault,
        'ZeroAmount'
      );
    });
    it('should not be able to go over the stake limit', async function () {
      const mintAmount = oneLbtc + oneLbtc;
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      await expect(partnerVault.connect(signer1)['mint(uint256)'](mintAmount)).to.be.revertedWithCustomError(
        partnerVault,
        'StakeLimitExceeded'
      );
    });
    it('should be able to delete a withdrawal request as an operator', async function () {
      const mintAmount = 10;
      await partnerVault.grantRole(operatorRoleHash, deployer.address);
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      expect(await partnerVault.connect(signer1)['mint(uint256)'](mintAmount))
        .to.emit(fbtc, 'Transfer')
        .withArgs(signer1.address, await partnerVault.getAddress(), mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), await lockedFbtc.getAddress(), mintAmount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, mintAmount);

      await partnerVault.initializeBurn(
        signer1.address,
        mintAmount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      await partnerVault.removeWithdrawalRequest(
        signer1.address,
        mintAmount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      await expect(
        partnerVault.finalizeBurn(
          signer1.address,
          mintAmount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      ).to.be.revertedWithCustomError(partnerVault, 'NoWithdrawalInitiated');
    });
    it('should not be able to try and delete a withdrawal request as anyone else', async function () {
      const mintAmount = 10;
      await partnerVault.grantRole(operatorRoleHash, deployer.address);
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      expect(await partnerVault.connect(signer1)['mint(uint256)'](mintAmount))
        .to.emit(fbtc, 'Transfer')
        .withArgs(signer1.address, await partnerVault.getAddress(), mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), await lockedFbtc.getAddress(), mintAmount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, mintAmount);

      await partnerVault.initializeBurn(
        signer1.address,
        mintAmount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      await expect(
        partnerVault
          .connect(signer1)
          [
            'removeWithdrawalRequest(address, uint256, bytes32, uint256)'
          ](signer1.address, mintAmount, '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', 0)
      ).to.be.reverted;
    });
  });
  describe('FBTC unlocking', function () {
    const mintAmount = 10;
    beforeEach(async function () {
      await snapshot.restore();
      await partnerVault.setLockedFbtc(await lockedFbtc.getAddress());
      await partnerVault.setAllowMintLbtc(true);
      await partnerVault.grantRole(operatorRoleHash, deployer.address);
      await fbtc.mint(signer1.address, mintAmount);
      await fbtc.connect(signer1)['approve(address,uint256)'](await partnerVault.getAddress(), mintAmount);
      expect(await partnerVault.connect(signer1)['mint(uint256)'](mintAmount))
        .to.emit(fbtc, 'Transfer')
        .withArgs(signer1.address, await partnerVault.getAddress(), mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), await lockedFbtc.getAddress(), mintAmount)
        .to.emit(lbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, mintAmount);
    });
    it('should not allow just anyone to initiate burn', async function () {
      await expect(
        partnerVault
          .connect(signer2)
          [
            'initializeBurn(address, uint256, bytes32, uint256)'
          ](signer2.address, 10, '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', 0)
      ).to.be.reverted;
    });
    it('should not allow just anyone to finalize burn', async function () {
      await expect(
        partnerVault
          .connect(signer2)
          [
            'finalizeBurn(address, uint256, bytes32, uint256)'
          ](signer2.address, 10, '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', 0)
      ).to.be.reverted;
    });
    it('should be able to burn LBTC and unlock FBTC to the user', async function () {
      await partnerVault.initializeBurn(
        signer1.address,
        mintAmount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      expect(
        await partnerVault.finalizeBurn(
          signer1.address,
          mintAmount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      )
        .to.emit(lbtc, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, mintAmount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), signer1.address, mintAmount);
    });
    it('should be able to burn less LBTC than was minted', async function () {
      const amount = mintAmount - 5;
      await partnerVault.initializeBurn(
        signer1.address,
        amount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      expect(
        await partnerVault.finalizeBurn(
          signer1.address,
          amount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      )
        .to.emit(lbtc, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), signer1.address, amount);
    });
    it('should be able to burn minted LBTC in multiple attempts', async function () {
      const amount = mintAmount - 5;
      await partnerVault.initializeBurn(
        signer1.address,
        amount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      expect(
        await partnerVault.finalizeBurn(
          signer1.address,
          amount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      )
        .to.emit(lbtc, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), signer1.address, amount);
      await partnerVault.initializeBurn(
        signer1.address,
        amount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      expect(
        await partnerVault.finalizeBurn(
          signer1.address,
          amount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      )
        .to.emit(lbtc, 'Transfer')
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(fbtc, 'Transfer')
        .withArgs(await partnerVault.getAddress(), signer1.address, amount);
    });
    it('should not be able to burn more LBTC than was minted', async function () {
      await expect(
        partnerVault.initializeBurn(
          signer1.address,
          mintAmount + 1,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      ).to.be.revertedWithCustomError(partnerVault, 'InsufficientFunds');
    });
    it('should not be able to finalize a burn without initiating one', async function () {
      await expect(
        partnerVault.finalizeBurn(
          signer1.address,
          mintAmount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      ).to.be.revertedWithCustomError(partnerVault, 'NoWithdrawalInitiated');
    });
    it('should not be able to finalize burn for a mismatched recipient', async function () {
      await partnerVault.initializeBurn(
        signer1.address,
        mintAmount,
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
        0
      );
      await expect(
        partnerVault.finalizeBurn(
          signer2.address,
          mintAmount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      ).to.be.revertedWithCustomError(partnerVault, 'NoWithdrawalInitiated');
    });
  });
  describe('FBTC unlocking without prior mint', function () {
    const mintAmount = 10;
    beforeEach(async function () {
      await snapshot.restore();
      await partnerVault.setLockedFbtc(await lockedFbtc.getAddress());
      await partnerVault.setAllowMintLbtc(true);
      await partnerVault.grantRole(operatorRoleHash, deployer.address);
      await fbtc.mint(signer1.address, mintAmount);
    });
    it('should not be able to burn LBTC if none was minted', async function () {
      await expect(
        partnerVault.initializeBurn(
          signer1.address,
          mintAmount,
          '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
          0
        )
      ).to.be.revertedWithCustomError(partnerVault, 'InsufficientFunds');
    });
  });
});
