import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { deployContract, getSignersWithPrivateKeys, Signer } from './helpers';
import { BARD } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

const e18 = 10n ** 18n;

describe('BARD', function () {
  let deployer: Signer, owner: Signer, treasury: Signer, signer1: Signer, signer2: Signer;
  let bard: BARD;
  let snapshot: SnapshotRestorer;
  let deployTimestamp: number;
  const oneYear = 60 * 60 * 24 * 365;

  before(async function () {
    [deployer, owner, treasury, signer1, signer2] = await getSignersWithPrivateKeys();

    bard = await deployContract<BARD>('BARD', [owner, treasury], false);

    snapshot = await takeSnapshot();
    deployTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  describe('Deployment', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('Treasury receives expected number of tokens. total supply is correct', async function () {
      expect(await bard.balanceOf(treasury)).to.equal(1_000_000_000n * e18);
      expect(await bard.totalSupply()).to.equal(1_000_000_000n * e18);
    });

    it('Name', async function () {
      expect(await bard.name()).to.equal('Lombard');
    });

    it('Symbol', async function () {
      expect(await bard.symbol()).to.equal('BARD');
    });

    it('Reverts when treasury is 0 address', async function () {
      await expect(deployContract<BARD>('BARD', [owner, ethers.ZeroAddress], false)).to.revertedWithCustomError(
        bard,
        'ZeroAddressException'
      );
    });

    it('Reverts when owner is 0 address', async function () {
      await expect(deployContract<BARD>('BARD', [ethers.ZeroAddress, treasury], false)).to.revertedWithCustomError(
        bard,
        'OwnableInvalidOwner'
      );
    });

    it('Reverts when renounces ownership', async function () {
      await expect(bard.connect(owner).renounceOwnership()).to.revertedWithCustomError(bard, 'CantRenounceOwnership');
    });
  });

  describe('Mint', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('Reverts when already minted this epoch', async function () {
      await time.increaseTo(deployTimestamp + oneYear - 10);
      await expect(bard.connect(owner).mint(signer1, e18))
        .to.revertedWithCustomError(bard, 'MintWaitPeriodNotClosed')
        .withArgs(9);
    });

    it('Reverts when called by not an owner', async function () {
      await time.increaseTo(deployTimestamp + oneYear);
      await expect(bard.connect(deployer).mint(signer1, e18))
        .to.revertedWithCustomError(bard, 'OwnableUnauthorizedAccount')
        .withArgs(deployer.address);
    });

    it('Owner can mint since 1y has passed after deployment', async function () {
      await time.increaseTo(deployTimestamp + oneYear);
      const supplyBefore = await bard.totalSupply();

      const amount = 1_00_000_000n * e18;
      const tx = await bard.connect(owner).mint(signer1, amount);
      await expect(tx).to.emit(bard, 'Mint').withArgs(signer1, amount);
      await expect(tx).to.changeTokenBalance(bard, signer1, amount);
      await expect(tx).to.changeTokenBalance(bard, treasury, 0n);

      const supplyAfter = await bard.totalSupply();
      expect(supplyAfter - supplyBefore).to.equal(amount);
    });

    it('Owner can mint in the year after next', async function () {
      await time.increaseTo(deployTimestamp + oneYear);
      const amount1 = 1_00_000_000n * e18;
      await bard.connect(owner).mint(signer1, amount1);

      await time.increaseTo(deployTimestamp + oneYear * 2);
      const supplyBefore = await bard.totalSupply();

      const recipient = ethers.Wallet.createRandom().address;
      const amount2 = 50_000_000n * e18;
      const tx = await bard.connect(owner).mint(recipient, amount2);
      await expect(tx).to.emit(bard, 'Mint').withArgs(recipient, amount2);
      await expect(tx).to.changeTokenBalance(bard, recipient, amount2);
      await expect(tx).to.changeTokenBalance(bard, treasury, 0n);

      const supplyAfter = await bard.totalSupply();
      expect(supplyAfter - supplyBefore).to.equal(amount2);
    });

    it('Owner cannot mint earlier than 365 days after previous mint', async function () {
      await time.increaseTo(deployTimestamp + oneYear);
      const amount1 = 1_00_000_000n * e18;
      await bard.connect(owner).mint(signer1, amount1);

      const amount = 50_000_000n * e18;
      await expect(bard.connect(owner).mint(signer1, amount))
        .to.revertedWithCustomError(bard, 'MintWaitPeriodNotClosed')
        .withArgs(oneYear - 1);
    });

    it('Owner cannot mint more than 10% of the current total supply', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1);
      await expect(bard.connect(owner).mint(signer1, 1_00_000_000n * e18 + 1n))
        .to.revertedWithCustomError(bard, 'MaxInflationExceeded')
        .withArgs(1_00_000_000n * e18);
    });
  });

  describe('Permit', function () {
    before(async function () {
      await snapshot.restore();
    })

    it("Permit with mock token", async () => {
      const factory = await ethers.getContractFactory('PermitMock');
      const bard = await factory.deploy('Name', 'Symbol');
      const value = e18;
      const deadline = deployTimestamp + oneYear;
      const nonce = await bard.nonces(treasury.address);

      const domain = {
        name: await bard.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await bard.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const message = {
        owner: treasury.address,
        spender: signer1.address,
        value,
        nonce,
        deadline,
      };

      const signature = await treasury.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);

      // Expect the permit to revert due to expired deadline
      await bard.permit(treasury.address, signer1.address, value, deadline, v, r, s);
    });

    it("Permit with bard token", async () => {
      const factory = await ethers.getContractFactory('PermitMock');
      const bard = await factory.deploy('Name', 'Symbol');
      const value = e18;
      const deadline = deployTimestamp + oneYear;
      const nonce = await bard.nonces(treasury.address);

      const domain = {
        name: await bard.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await bard.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const message = {
        owner: treasury.address,
        spender: signer1.address,
        value,
        nonce,
        deadline,
      };

      const signature = await treasury.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);

      // Expect the permit to revert due to expired deadline
      await bard.permit(treasury.address, signer1.address, value, deadline, v, r, s);
    });
  })
});
