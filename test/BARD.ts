import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { deployContract, getSignersWithPrivateKeys, Signer } from './helpers';
import { BARD } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { TypedDataDomain } from 'ethers';

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
    deployTimestamp = await time.latest();
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

    it('Reverts when renounces ownership', async function () {
      await expect(bard.connect(signer1).renounceOwnership()).to.revertedWithCustomError(bard, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });
  });

  describe('Mint', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('Reverts when less than a year has passed', async function () {
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

    it('Owner can mint when more than a year has passed since last mint', async function () {
      await time.increaseTo(deployTimestamp + oneYear * 1.5);
      const amount1 = 1_00_000_000n * e18;
      await bard.connect(owner).mint(signer1, amount1);
      const lastMintTime = await time.latest();

      await time.increaseTo(lastMintTime + oneYear);
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

    it('Owner cannot mint again until 1 year passed', async function () {
      await time.increaseTo(deployTimestamp + oneYear * 1.5);
      const amount1 = 1_00_000_000n * e18;
      await bard.connect(owner).mint(signer1, amount1);
      const lastMintTime = await time.latest();

      await time.increaseTo(lastMintTime + oneYear - 2);

      const amount = 50_000_000n * e18;
      await expect(bard.connect(owner).mint(signer1, amount))
        .to.revertedWithCustomError(bard, 'MintWaitPeriodNotClosed')
        .withArgs(1);
    });

    it('Owner cannot mint more than 10% of the current total supply', async function () {
      await time.increaseTo(deployTimestamp + oneYear + 1);
      await expect(bard.connect(owner).mint(signer1, 1_00_000_000n * e18 + 1n))
        .to.revertedWithCustomError(bard, 'MaxInflationExceeded')
        .withArgs(1_00_000_000n * e18);
    });
  });

  describe('Permit and delegate', function () {
    let domain: TypedDataDomain;
    before(async function () {
      await snapshot.restore();
      domain = {
        name: await bard.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await bard.getAddress(),
      };
    })

    it("Use permit", async () => {
      const value = e18;
      const deadline = deployTimestamp + oneYear;
      const nonce = await bard.nonces(treasury.address);

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
      const tx = await bard.permit(treasury.address, signer1.address, value, deadline, v, r, s);
      await expect(tx).to.emit(bard, 'Approval').withArgs(treasury.address, signer1.address, value);
      expect(await bard.nonces(treasury.address)).to.be.eq(nonce+1n);
    });

    it("Use vote delegate", async () => {
      const nonce = await bard.nonces(treasury);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // +1 hour

      const types = {
        Delegation: [
          { name: "delegatee", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      };

      const message = {
        delegatee: signer1.address,
        nonce,
        expiry: deadline,
      };

      const signature = await treasury.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);

      await bard.delegateBySig(signer1, nonce, deadline, v, r, s);

      expect(await bard.delegates(treasury)).to.equal(signer1);
      expect(await bard.nonces(treasury.address)).to.be.eq(nonce+1n);
    });
  })
});
