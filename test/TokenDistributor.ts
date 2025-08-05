import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { Addressable, deployContract, getSignersWithPrivateKeys, Signer } from './helpers';
import { BARD, ERC4626Mock, TokenDistributor } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

const e18 = 10n ** 18n;
const CLAIM_PERIOD = 100;
const MERKLE_ROOT = '0x440ddafd1f88ad347996f6faed4091b132a9080b751cb9b9541d182023c8f63f';
const RECIPIENT_01 = '0xaF769e24839761eD9422b8FfdE2dB006F0FaE165';
const AMOUNT_01 = 10000000000000000000n;
const PROOF_01 = [
  '0xb98e001c41c4fa1d71510a338aaa5375531024e21783b8da4d199c2a0cca68ec',
  '0x38fbcc2ddf2d9e1483c93e866af90c63420afd2775a1761afe1052675ae6c5cd',
  '0xb44bab0c8e85f271f0ff497028ea8e0a2e7364b5ad4cab645f18dab1b43ce553',
  '0x287226f028e2a81a7c8171b8e02368c64d6005ee88c62196afc69dde2b346f0d',
  '0xf2133e933fb2124f45ed7832f65236bf24cc284e31f7f41583357bc37d4fc7bd',
  '0xf4546a6359a8160b0e1c48cbed77289ffc8d71962f08e3d38b11ffea1de97ce7'
];
const RECIPIENT_02 = '0x54345B8575456eb5883443bd70ca2ABdf989d4e6';
const AMOUNT_02 = 250000000000000000000n;
const PROOF_02 = [
  '0xa2f287cdf152d3932c537b0a9227dbf94225e2df0e5091d54abb6a37ee03fbe8',
  '0x38fbcc2ddf2d9e1483c93e866af90c63420afd2775a1761afe1052675ae6c5cd',
  '0xb44bab0c8e85f271f0ff497028ea8e0a2e7364b5ad4cab645f18dab1b43ce553',
  '0x287226f028e2a81a7c8171b8e02368c64d6005ee88c62196afc69dde2b346f0d',
  '0xf2133e933fb2124f45ed7832f65236bf24cc284e31f7f41583357bc37d4fc7bd',
  '0xf4546a6359a8160b0e1c48cbed77289ffc8d71962f08e3d38b11ffea1de97ce7'
];
const RECIPIENT_03 = '0x17948A015160Cd6D6B730187DFF461753FE811B2';
const AMOUNT_03 = 10450000000000000000n;
const PROOF_03 = [
  '0xedb3cc8eb10dfb9ed9cb96812d603cfbb0f257f63968086725c9e5d8ca646690',
  '0x48bf0066e688030e831fae7e1146ea65423e42ffcf8308ec133f474fc5aa08e5',
  '0xe17779a21477fd4669f61c222035e435309076a7d8281010532f7b2beeae4277',
  '0x893244c303fb31266b33ed41ba16263957dd43c437f4252350c0f9d2363e9449',
  '0x4eec8a585b7f07d735255c7f8c1e7fc824ebf27fc0603e4db4c0c2ec458dbe46'
];
const MERKLE_ROOT_WRONG = '0x7219269e7c773394d7f7c5e45d69be27bac95369d1ac44d383f46fee7c3d5731';
const WRONG_RECIPIENT = '0x973846119C50aB155b2cA776a4361634bc40F720';
const WRONG_AMOUNT = 1024n;
const WRONG_PROOF = [
  '0x8388857dacb095e04032ba88bbb2a2b78172615a5481cc141cacae658898cccb',
  '0xd7e668df550566bd80b402b54e98177c894850a3a03a0f986dd1c71ce274d5d8',
  '0xbe3bd67c39202038e405b0eb816f7f07e5a316c4d52d4bd96c9e1e35234c21cb',
  '0x1be40c2f461ecc2643a87c4fe5a527d47129fb463b7826c5d63432fd70633e73',
  '0xbd391e6f377c32e18c65b8ef697e31deab8201d1bf15b581723e8dc6e3ffa88a',
  '0x4734fb658d5adc8416e301a0c9fb3d912fbbabc0acaf6fc1aed94861b0e208e3'
];

describe('TokenDistributor', function () {
  let deployer: Signer, owner: Signer, treasury: Signer, signer1: Signer, signer2: Signer;
  let bard: BARD & Addressable;
  let tokenDistributor: TokenDistributor & Addressable;
  let snapshot: SnapshotRestorer;
  let deployTimestamp: number;
  let claimEnd: number;
  let vault: ERC4626Mock & Addressable;

  before(async function () {
    [deployer, owner, treasury, signer1, signer2] = await getSignersWithPrivateKeys();

    claimEnd = (await time.latest()) + CLAIM_PERIOD;

    bard = await deployContract<BARD & Addressable>('BARD', [owner, treasury], false);
    bard.address = await bard.getAddress();

    vault = await deployContract<ERC4626Mock & Addressable>('ERC4626Mock', [bard.address], false);
    vault.address = await vault.getAddress();

    tokenDistributor = await deployContract<TokenDistributor & Addressable>(
      'TokenDistributor',
      [MERKLE_ROOT, bard.address, owner, claimEnd, vault],
      false
    );
    tokenDistributor.address = await tokenDistributor.getAddress();

    await bard.connect(treasury).transfer(tokenDistributor.address, 1_000_000n * e18);

    snapshot = await takeSnapshot();
    deployTimestamp = await time.latest();
  });

  describe('Deployment process', function () {
    describe('Successful deployment', function () {
      it('Deploy with vault', async function () {
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [MERKLE_ROOT, bard.address, owner, claimEnd, vault],
            false
          )
        ).to.not.reverted;
      });

      it('Deploy without vault', async function () {
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [MERKLE_ROOT, bard.address, owner, claimEnd, ethers.ZeroAddress],
            false
          )
        ).to.not.reverted;
      });
    });

    describe('Failing deployment', function () {
      it('Reverts when merkle root is 0 address', async function () {
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              bard.address,
              owner,
              claimEnd,
              vault
            ],
            false
          )
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidMerkleRoot');
      });

      it('Reverts when token is 0 address', async function () {
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [MERKLE_ROOT, ethers.ZeroAddress, owner, claimEnd, vault],
            false
          )
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidToken');
      });

      it('Reverts when owner is 0 address', async function () {
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [MERKLE_ROOT, bard.address, ethers.ZeroAddress, claimEnd, vault],
            false
          )
        ).to.revertedWithCustomError(tokenDistributor, 'OwnableInvalidOwner');
      });

      it('Reverts when claim end is now or in the past', async function () {
        const claimEndLocal = await time.latest();
        await expect(
          deployContract<TokenDistributor>(
            'TokenDistributor',
            [MERKLE_ROOT, bard.address, owner, claimEndLocal, vault],
            false
          )
        ).to.revertedWithCustomError(tokenDistributor, 'WrongClaimEnd');
      });
    });
  });

  describe('Setters and getters', function () {
    describe('Deployment values', function () {
      let claimEndAlt = 0;
      let tokenDistributorAlt: TokenDistributor & Addressable;

      before(async function () {
        claimEndAlt = (await time.latest()) + 250;
        tokenDistributorAlt = await deployContract<TokenDistributor & Addressable>(
          'TokenDistributor',
          [MERKLE_ROOT_WRONG, bard.address, signer2, claimEndAlt, signer1.address],
          false
        );
      });

      it('owner', async function () {
        expect(await tokenDistributorAlt.owner()).to.be.eq(signer2.address);
      });

      it('merkle root', async function () {
        expect(await tokenDistributorAlt.MERKLE_ROOT()).to.be.eq(MERKLE_ROOT_WRONG);
      });

      it('token', async function () {
        expect(await tokenDistributorAlt.TOKEN()).to.be.eq(bard.address);
      });

      it('claim end', async function () {
        expect(await tokenDistributorAlt.CLAIM_END()).to.be.eq(claimEndAlt);
      });

      it('vault', async function () {
        expect(await tokenDistributorAlt.VAULT()).to.be.eq(signer1.address);
      });
    });

    describe('Vault', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('changeVault() works if called by the owner', async function () {
        const oldVault = await tokenDistributor.VAULT();

        await expect(await tokenDistributor.connect(owner).changeVault(signer1.address))
          .to.emit(tokenDistributor, 'VaultChanged')
          .withArgs(oldVault, signer1.address);
        const newVault = await tokenDistributor.VAULT();
        expect(newVault).to.be.eq(signer1.address);

        await expect(await tokenDistributor.connect(owner).changeVault(ethers.ZeroAddress))
          .to.emit(tokenDistributor, 'VaultChanged')
          .withArgs(signer1.address, ethers.ZeroAddress);
        expect(await tokenDistributor.VAULT()).to.be.eq(ethers.ZeroAddress);
      });

      it('changeVault() reverts when called by not owner', async function () {
        await expect(tokenDistributor.connect(signer1).changeVault(signer2.address))
          .to.revertedWithCustomError(tokenDistributor, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });
    });
  });

  describe('Claim and stake', function () {
    describe('Positive cases', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('Claim should work', async () => {
        const recepientBalanceBefore = await bard.balanceOf(RECIPIENT_01);
        const tdBalanceBefore = await bard.balanceOf(tokenDistributor.address);

        const tx = await tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, PROOF_01);
        await expect(tx).to.emit(tokenDistributor, 'Claimed').withArgs(RECIPIENT_01, AMOUNT_01);

        const recipientBalanceAfter = await bard.balanceOf(RECIPIENT_01);
        const tdBalanceAfter = await bard.balanceOf(tokenDistributor.address);

        expect(recipientBalanceAfter - recepientBalanceBefore).to.equal(AMOUNT_01);
        expect(tdBalanceAfter - tdBalanceBefore).to.equal(-AMOUNT_01);
      });

      it('ClaimAndStake should work (stake all)', async () => {
        const recepientBalanceBefore = await bard.balanceOf(RECIPIENT_02);
        const recepientSharesBalanceBefore = await vault.balanceOf(RECIPIENT_02);
        const tdBalanceBefore = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceBefore = await bard.balanceOf(vault.address);

        const tx = await tokenDistributor['claimAndStake(address,uint256,bytes32[])'](
          RECIPIENT_02,
          AMOUNT_02,
          PROOF_02
        );
        await expect(tx).to.emit(tokenDistributor, 'Claimed').withArgs(RECIPIENT_02, AMOUNT_02);

        const recipientBalanceAfter = await bard.balanceOf(RECIPIENT_02);
        const recepientSharesBalanceAfter = await vault.balanceOf(RECIPIENT_02);
        const tdBalanceAfter = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceAfter = await bard.balanceOf(vault.address);

        expect(recipientBalanceAfter - recepientBalanceBefore).to.equal(0n);
        expect(recepientSharesBalanceAfter - recepientSharesBalanceBefore).to.equal(AMOUNT_02);
        expect(tdBalanceAfter - tdBalanceBefore).to.equal(-AMOUNT_02);
        expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(AMOUNT_02);
      });

      it('ClaimAndStake should work (partial)', async () => {
        const recepientBalanceBefore = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceBefore = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceBefore = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceBefore = await bard.balanceOf(vault.address);

        const tx = await tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
          RECIPIENT_03,
          AMOUNT_03,
          PROOF_03,
          AMOUNT_03 / 4n
        );
        await expect(tx).to.emit(tokenDistributor, 'Claimed').withArgs(RECIPIENT_03, AMOUNT_03);

        const recipientBalanceAfter = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceAfter = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceAfter = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceAfter = await bard.balanceOf(vault.address);

        expect(recipientBalanceAfter - recepientBalanceBefore).to.equal((AMOUNT_03 * 3n) / 4n);
        expect(recepientSharesBalanceAfter - recepientSharesBalanceBefore).to.equal(AMOUNT_03 / 4n);
        expect(tdBalanceAfter - tdBalanceBefore).to.equal(-AMOUNT_03);
        expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(AMOUNT_03 / 4n);
      });

      it('ClaimAndStake should work (partial but all)', async () => {
        const recepientBalanceBefore = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceBefore = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceBefore = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceBefore = await bard.balanceOf(vault.address);

        const tx = await tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
          RECIPIENT_03,
          AMOUNT_03,
          PROOF_03,
          AMOUNT_03
        );
        await expect(tx).to.emit(tokenDistributor, 'Claimed').withArgs(RECIPIENT_03, AMOUNT_03);

        const recipientBalanceAfter = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceAfter = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceAfter = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceAfter = await bard.balanceOf(vault.address);

        expect(recipientBalanceAfter - recepientBalanceBefore).to.equal(0n);
        expect(recepientSharesBalanceAfter - recepientSharesBalanceBefore).to.equal(AMOUNT_03);
        expect(tdBalanceAfter - tdBalanceBefore).to.equal(-AMOUNT_03);
        expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(AMOUNT_03);
      });

      it('ClaimAndStake should work (partial but zero stake)', async () => {
        const recepientBalanceBefore = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceBefore = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceBefore = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceBefore = await bard.balanceOf(vault.address);

        const tx = await tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
          RECIPIENT_03,
          AMOUNT_03,
          PROOF_03,
          0n
        );
        await expect(tx).to.emit(tokenDistributor, 'Claimed').withArgs(RECIPIENT_03, AMOUNT_03);

        const recipientBalanceAfter = await bard.balanceOf(RECIPIENT_03);
        const recepientSharesBalanceAfter = await vault.balanceOf(RECIPIENT_03);
        const tdBalanceAfter = await bard.balanceOf(tokenDistributor.address);
        const vaultBalanceAfter = await bard.balanceOf(vault.address);

        expect(recipientBalanceAfter - recepientBalanceBefore).to.equal(AMOUNT_03);
        expect(recepientSharesBalanceAfter - recepientSharesBalanceBefore).to.equal(0n);
        expect(tdBalanceAfter - tdBalanceBefore).to.equal(-AMOUNT_03);
        expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(0n);
      });
    });

    describe('Negative cases', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('Claim should not work after claim end', async () => {
        await time.increaseTo(claimEnd);

        await expect(tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, PROOF_01)).to.revertedWithCustomError(
          tokenDistributor,
          'ClaimFinished'
        );
      });

      it('ClaimAndStake should not work after claim end (stake all)', async () => {
        await time.increaseTo(claimEnd);

        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[])'](RECIPIENT_01, AMOUNT_01, PROOF_01)
        ).to.revertedWithCustomError(tokenDistributor, 'ClaimFinished');
      });

      it('ClaimAndStake should not work after claim end (partial stake)', async () => {
        await time.increaseTo(claimEnd);

        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
            RECIPIENT_01,
            AMOUNT_01,
            PROOF_01,
            AMOUNT_01 / 2n
          )
        ).to.revertedWithCustomError(tokenDistributor, 'ClaimFinished');
      });

      it('Claim should not work second time', async () => {
        await tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, PROOF_01);

        await expect(tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, PROOF_01)).to.revertedWithCustomError(
          tokenDistributor,
          'AlreadyClaimed'
        );
      });

      it('ClaimAndStake should not work second time', async () => {
        await tokenDistributor['claimAndStake(address,uint256,bytes32[])'](RECIPIENT_01, AMOUNT_01, PROOF_01);

        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[])'](RECIPIENT_01, AMOUNT_01, PROOF_01)
        ).to.revertedWithCustomError(tokenDistributor, 'AlreadyClaimed');
      });

      it('ClaimAndStake should not work second time', async () => {
        await tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, PROOF_01);

        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
            RECIPIENT_01,
            AMOUNT_01,
            PROOF_01,
            AMOUNT_01
          )
        ).to.revertedWithCustomError(tokenDistributor, 'AlreadyClaimed');
      });

      it('Claim should not work if proof is wrong', async () => {
        await expect(tokenDistributor.claim(RECIPIENT_01, AMOUNT_01, WRONG_PROOF)).to.revertedWithCustomError(
          tokenDistributor,
          'InvalidProof'
        );
      });

      it('ClaimAndStake should not work if proof is wrong (stake all)', async () => {
        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[])'](RECIPIENT_01, AMOUNT_01, WRONG_PROOF)
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidProof');
      });

      it('ClaimAndStake should not work if proof is wrong (partial stake)', async () => {
        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
            RECIPIENT_01,
            AMOUNT_01,
            WRONG_PROOF,
            AMOUNT_01 / 2n
          )
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidProof');
      });

      it('Claim should not work if amount is 0', async () => {
        await expect(tokenDistributor.claim(RECIPIENT_01, 0n, PROOF_01)).to.revertedWithCustomError(
          tokenDistributor,
          'InvalidAmount'
        );
      });

      it('ClaimAndStake should not work if amount is 0 (stake all)', async () => {
        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[])'](RECIPIENT_01, 0n, PROOF_01)
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidAmount');
      });

      it('ClaimAndStake should not work if amount is 0 (partial stake)', async () => {
        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](RECIPIENT_01, 0n, PROOF_01, 0n)
        ).to.revertedWithCustomError(tokenDistributor, 'InvalidAmount');
      });

      it('ClaimAndStake should not work if amount  to stake is more than amount to claim', async () => {
        await expect(
          tokenDistributor['claimAndStake(address,uint256,bytes32[],uint256)'](
            RECIPIENT_01,
            AMOUNT_01,
            PROOF_01,
            AMOUNT_01 + 1n
          )
        ).to.revertedWithCustomError(tokenDistributor, 'WrongStakeAmount');
      });
    });
  });

  describe('Withdraw', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('Positive: withdraw after claim end should work', async () => {
      await time.increaseTo(claimEnd);
      const balanceBefore = await bard.balanceOf(owner.address);
      const tokenDistributorBalanceBefore = await bard.balanceOf(tokenDistributor.address);

      const tx = await tokenDistributor.connect(owner).withdraw();
      await expect(tx).to.emit(tokenDistributor, 'Withdrawn').withArgs(owner.address, tokenDistributorBalanceBefore);

      const balanceAfter = await bard.balanceOf(owner.address);
      const tokenDistributorBalanceAfter = await bard.balanceOf(tokenDistributor.address);
      expect(balanceAfter - balanceBefore).to.equal(tokenDistributorBalanceBefore);
      expect(tokenDistributorBalanceAfter).to.equal(0n);
    });

    it('Negative: withdraw before claim end should not work', async () => {
      await expect(tokenDistributor.connect(owner).withdraw()).to.revertedWithCustomError(
        tokenDistributor,
        'ClaimNotFinished'
      );
    });

    it('Negative: withdraw after claim end should not work if called not by the owner', async () => {
      await time.increaseTo(claimEnd + 1);
      await expect(tokenDistributor.connect(signer1).withdraw())
        .to.revertedWithCustomError(tokenDistributor, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });
  });
});
