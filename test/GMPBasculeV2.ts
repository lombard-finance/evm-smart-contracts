import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  CHAIN_ID,
  deployContract,
  encode,
  getSignersWithPrivateKeys,
  randomAddress,
  randomBigInt,
  rawSign,
  Signer
} from './helpers';
import { GMPBasculeV2, IGMPBascule } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { randomBytes } from 'ethers';

const TOKEN_ADDRESS = randomAddress();

function calcMintID(mint: IGMPBascule.MessageStruct) {
  return ethers.keccak256(
    encode(
      ['uint256', 'bytes32', 'address', 'address', 'uint256'],
      [mint.nonce, CHAIN_ID, mint.recipient, mint.toToken, mint.amount]
    )
  );
}

function generateReport(signer: Signer, count: bigint) {
  const ids = [];
  const mints = [];
  const proofs = [];

  for (let i = 0n; i < count; i++) {
    const mint: IGMPBascule.MessageStruct = {
      amount: randomBigInt(8),
      nonce: randomBigInt(10),
      toToken: TOKEN_ADDRESS,
      recipient: randomAddress()
    };
    const mintID = calcMintID(mint);
    const proof = rawSign(signer, mintID);

    ids.push(mintID);
    mints.push(mint);
    proofs.push(proof);
  }

  return { ids, mints, proofs };
}

describe('GMPBasculeV2', function () {
  let _: Signer,
    owner: Signer,
    pauser: Signer,
    mintReporter: Signer,
    mintValidator: Signer,
    trustedSigner: Signer,
    validationGuardian: Signer,
    signer1: Signer;

  let bascule: GMPBasculeV2 & Addressable;
  const defaultMaxMints = 3n;
  let snapshot: SnapshotRestorer;

  before(async function () {
    await network.provider.request({ method: 'hardhat_reset', params: [] });

    [_, owner, pauser, mintReporter, mintValidator, trustedSigner, signer1, validationGuardian] =
      await getSignersWithPrivateKeys();

    bascule = await deployContract<GMPBasculeV2 & Addressable>(
      'GMPBasculeV2',
      [
        owner.address,
        pauser.address,
        mintReporter.address,
        mintValidator.address,
        defaultMaxMints,
        trustedSigner.address
      ],
      false
    );
    bascule.address = await bascule.getAddress();

    await bascule.connect(owner).grantRole(await bascule.VALIDATION_GUARDIAN_ROLE(), validationGuardian.address);

    snapshot = await takeSnapshot();
  });

  describe('Deployment', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('DEFAULT_ADMIN_ROLE', async function () {
      expect(await bascule.DEFAULT_ADMIN_ROLE()).to.be.eq(
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      );
    });

    it('MINT_REPORTER_ROLE', async function () {
      expect(await bascule.MINT_REPORTER_ROLE()).to.be.eq(ethers.keccak256(ethers.toUtf8Bytes('MINT_REPORTER_ROLE')));
    });

    it('PAUSER_ROLE', async function () {
      expect(await bascule.PAUSER_ROLE()).to.be.eq(ethers.keccak256(ethers.toUtf8Bytes('PAUSER_ROLE')));
    });

    it('VALIDATION_GUARDIAN_ROLE', async function () {
      expect(await bascule.VALIDATION_GUARDIAN_ROLE()).to.be.eq(
        ethers.keccak256(ethers.toUtf8Bytes('VALIDATION_GUARDIAN_ROLE'))
      );
    });

    it('MINT_VALIDATOR_ROLE', async function () {
      expect(await bascule.MINT_VALIDATOR_ROLE()).to.be.eq(ethers.keccak256(ethers.toUtf8Bytes('MINT_VALIDATOR_ROLE')));
    });

    it('Default admin', async function () {
      expect(await bascule.defaultAdmin()).to.be.eq(owner.address);
    });

    it('Owner', async function () {
      expect(await bascule.owner()).to.be.eq(owner.address);
    });

    it('Pauser has role', async function () {
      expect(await bascule.hasRole(ethers.keccak256(ethers.toUtf8Bytes('PAUSER_ROLE')), pauser)).to.be.true;
    });

    it('Mint reporter has role', async function () {
      expect(await bascule.hasRole(ethers.keccak256(ethers.toUtf8Bytes('MINT_REPORTER_ROLE')), mintReporter)).to.be
        .true;
    });

    it('Mint validator has role', async function () {
      expect(await bascule.hasRole(ethers.keccak256(ethers.toUtf8Bytes('MINT_VALIDATOR_ROLE')), mintValidator)).to.be
        .true;
    });

    it('Trusted signer', async function () {
      expect(await bascule.trustedSigner()).to.be.eq(trustedSigner.address);
    });

    it('Max mints', async function () {
      expect(await bascule.maxMints()).to.be.eq(defaultMaxMints);
    });

    it('Validate threshold', async function () {
      expect(await bascule.validateThreshold()).to.be.eq(0n);
    });

    it('Paused is false', async function () {
      expect(await bascule.paused()).to.be.false;
    });
  });

  describe('Setters', function () {
    describe('Max mints', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('setMaxMints: default admin can', async function () {
        const newValue = randomBigInt(2);
        await expect(bascule.connect(owner).setMaxMints(newValue))
          .to.emit(bascule, 'MaxMintsUpdated')
          .withArgs(newValue);

        expect(await bascule.maxMints()).to.be.eq(newValue);
      });

      it('setMaxMints: reverts when called by unauthorized account', async function () {
        const newValue = randomBigInt(2);
        await expect(bascule.connect(signer1).setMaxMints(newValue)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });
    });

    describe('Trusted signer', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('setTrustedSigner: default admin can', async function () {
        const newValue = ethers.Wallet.createRandom().address;
        await expect(bascule.connect(owner).setTrustedSigner(newValue))
          .to.emit(bascule, 'TrustedSignerUpdated')
          .withArgs(newValue);

        expect(await bascule.trustedSigner()).to.be.eq(newValue);
      });

      it('setTrustedSigner: reverts when called by unauthorized account', async function () {
        const newValue = ethers.Wallet.createRandom().address;
        await expect(bascule.connect(signer1).setTrustedSigner(newValue)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });
    });

    describe('Threshold', function () {
      before(async function () {
        await snapshot.restore();
      });

      // Guardian is only allowed to increase the threshold for once. Account looses guardian role after the call.
      it('updateValidateThreshold: guardian can increase threshold only once', async function () {
        const oldValue = await bascule.validateThreshold();
        const newValue = oldValue + randomBigInt(8);
        await expect(bascule.connect(validationGuardian).updateValidateThreshold(newValue))
          .to.emit(bascule, 'UpdateValidateThreshold')
          .withArgs(oldValue, newValue);

        expect(await bascule.validateThreshold()).to.be.eq(newValue);
      });

      it('updateValidateThreshold: guarian can decrease', async function () {
        const oldValue = await bascule.validateThreshold();
        const newValue = oldValue - randomBigInt(5);
        await expect(bascule.connect(validationGuardian).updateValidateThreshold(newValue))
          .to.emit(bascule, 'UpdateValidateThreshold')
          .withArgs(oldValue, newValue);

        expect(await bascule.validateThreshold()).to.be.eq(newValue);
      });

      it('updateValidateThreshold: reverts when default admin increases', async function () {
        const oldValue = await bascule.validateThreshold();
        await expect(bascule.connect(owner).updateValidateThreshold(oldValue + 1n)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });

      it('updateValidateThreshold: reverts when called by unauthorized account', async function () {
        const oldValue = await bascule.validateThreshold();
        await expect(bascule.connect(signer1).updateValidateThreshold(oldValue - 1n)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });

      it('updateValidateThreshold: reverts when threshold is the same', async function () {
        const oldValue = await bascule.validateThreshold();
        await expect(bascule.connect(validationGuardian).updateValidateThreshold(oldValue)).to.revertedWithCustomError(
          bascule,
          'SameValidationThreshold'
        );
      });
    });
  });

  describe('Pause', function () {
    const amount = randomBigInt(8);
    const nonce = randomBigInt(16);

    before(async function () {
      await snapshot.restore();

      // const mint = {
      //   nonce,
      //   recipient: encode(['address'], [signer1.address]),
      //   toToken: TOKEN_ADDRESS,
      //   amount
      // };

      // await bascule.connect(mintReporter).reportMints(randomBytes(32), [mint], [randomBytes(64)]);
    });

    it('pause: reverts when called by not a pauser', async function () {
      await expect(bascule.connect(signer1).pause()).to.revertedWithCustomError(
        bascule,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('pause: pauser can set on pause', async function () {
      await expect(bascule.connect(pauser).pause()).to.emit(bascule, 'Paused').withArgs(pauser.address);
    });

    it('pause: reverts when already paused', async function () {
      await expect(bascule.connect(pauser).pause()).to.revertedWithCustomError(bascule, 'EnforcedPause');
    });

    it('reportMints: reverts when paused', async function () {
      const reportId = randomBytes(32);
      const mint: IGMPBascule.MessageStruct = {
        nonce,
        recipient: randomAddress(),
        toToken: TOKEN_ADDRESS,
        amount
      };

      await expect(
        bascule.connect(signer1).reportMints(reportId, [mint], [randomBytes(64)])
      ).to.revertedWithCustomError(bascule, 'EnforcedPause');
    });

    it('validateMint: reverts when paused', async function () {
      const mint: IGMPBascule.MessageStruct = {
        nonce,
        recipient: randomAddress(),
        toToken: TOKEN_ADDRESS,
        amount
      };

      await expect(bascule.connect(mintValidator).validateMint(mint)).to.be.revertedWithCustomError(
        bascule,
        'EnforcedPause'
      );
    });

    it('unpause: reverts when called by not a owner', async function () {
      await expect(bascule.connect(signer1).unpause()).to.revertedWithCustomError(
        bascule,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('unpause: owner can unpause', async function () {
      await expect(bascule.connect(owner).unpause()).to.emit(bascule, 'Unpaused').withArgs(owner.address);
    });

    it('unpause: reverts contract is not paused', async function () {
      await expect(bascule.connect(owner).unpause()).to.revertedWithCustomError(bascule, 'ExpectedPause');
    });
  });

  describe('Report and validate mints', function () {
    describe('Main flow', function () {
      const amount = randomBigInt(8);
      let mint: IGMPBascule.MessageStruct;
      let mintID: string;
      let proof: string;

      before(async function () {
        await snapshot.restore();

        mint = {
          nonce: randomBigInt(20),
          recipient: randomAddress(),
          toToken: TOKEN_ADDRESS,
          amount
        };
        mintID = calcMintID(mint);
        proof = rawSign(trustedSigner, mintID);
      });

      it('Report mint', async function () {
        expect(await bascule.mintHistory(mintID)).to.be.eq(0);

        const reportId = randomBytes(32);
        await expect(bascule.connect(mintReporter).reportMints(reportId, [mint], [proof]))
          .to.emit(bascule, 'MintsReported')
          .withArgs(reportId, 1);

        expect(await bascule.mintHistory(mintID)).to.be.eq(1);
      });

      it('Validate mint', async function () {
        await expect(bascule.connect(mintValidator).validateMint(mint))
          .to.emit(bascule, 'MintValidated')
          .withArgs(mintID, amount);

        expect(await bascule.mintHistory(mintID)).to.be.eq(2);
      });

      it('Repeat reporting mint', async function () {
        const reportId = randomBytes(32);
        await expect(bascule.connect(mintReporter).reportMints(reportId, [mint], [proof]))
          .to.emit(bascule, 'MintsReported')
          .withArgs(reportId, 1)
          .and.to.emit(bascule, 'MintAlreadyReportedOrProcessed')
          .withArgs(mintID);

        expect(await bascule.mintHistory(mintID)).to.be.eq(2);
      });

      it('Repeat mint validation', async function () {
        await expect(bascule.connect(mintValidator).validateMint(mint))
          .to.be.revertedWithCustomError(bascule, 'AlreadyMinted')
          .withArgs(mintID, amount);

        expect(await bascule.mintHistory(mintID)).to.be.eq(2);
      });
    });

    describe('Report mints', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      // TODO: prepare data for test below
      // it('Report mint signed by policy', async function () {
      //   await bascule.connect(owner).setTrustedSigner('0x4ef59bdec34968e9429ae662e458a595a0f937df');
      //   const reportId = randomBytes(32);
      //
      //   await expect(
      //     bascule
      //       .connect(mintReporter)
      //       .reportMints(
      //         reportId,
      //         [Buffer.from('dafc280d43b1e4d170ae84dd7a5b8499f879cf167acf038af0d399f6bda304db', 'hex')],
      //         [
      //           '0x212f28edebea4b87f484ecfcbf4fffced9a81f8a0b81d99e92befebaeba266cc7f9a439a6e5797276eb58b4406053107c04f354fa01dc8607ccf8d58f099b1701c'
      //         ]
      //       )
      //   )
      //     .to.emit(bascule, 'MintsReported')
      //     .withArgs(reportId, 1);
      // });

      it('reportMints: max number of mints', async function () {
        const mintIDs = [];
        const mints = [];
        const proofs = [];

        for (let i = 0n; i < defaultMaxMints; i++) {
          const mint: IGMPBascule.MessageStruct = {
            nonce: randomBigInt(10),
            toToken: TOKEN_ADDRESS,
            amount: randomBigInt(8),
            recipient: randomAddress()
          };
          const mintID = calcMintID(mint);
          const proof = rawSign(trustedSigner, mintID);

          mintIDs.push(mintID);
          proofs.push(proof);
          mints.push(mint);
        }
        const reportId = randomBytes(32);

        await expect(bascule.connect(mintReporter).reportMints(reportId, mints, proofs))
          .to.emit(bascule, 'MintsReported')
          .withArgs(reportId, defaultMaxMints);
      });

      it('reportMints: reverts when mint signed by not a trusted account', async function () {
        const reportId = randomBytes(32);

        const mint: IGMPBascule.MessageStruct = {
          amount: randomBigInt(8),
          nonce: randomBigInt(10),
          toToken: TOKEN_ADDRESS,
          recipient: randomAddress()
        };
        const mintID = calcMintID(mint);
        const proof = rawSign(signer1, mintID);

        await expect(bascule.connect(mintReporter).reportMints(reportId, [mint], [proof]))
          .to.revertedWithCustomError(bascule, 'BadProof')
          .withArgs(0, mintID, proof);
      });

      it('reportMints: reverts when signature is invalid', async function () {
        const reportId = randomBytes(32);
        const mint: IGMPBascule.MessageStruct = {
          amount: randomBigInt(8),
          nonce: randomBigInt(10),
          toToken: TOKEN_ADDRESS,
          recipient: randomAddress()
        };
        const mintID = calcMintID(mint);
        const proof = randomBytes(65);

        await expect(bascule.connect(mintReporter).reportMints(reportId, [mint], [proof]))
          .to.revertedWithCustomError(bascule, 'BadProof')
          .withArgs(0, mintID, proof);
      });

      it('reportMints: reverts when max number of mints is exceeded', async function () {
        const { mints, proofs } = generateReport(trustedSigner, defaultMaxMints + 1n);

        const reportId = randomBytes(32);

        await expect(bascule.connect(mintReporter).reportMints(reportId, mints, proofs)).to.revertedWithCustomError(
          bascule,
          'BadMintReport'
        );
      });

      it('reportMints: reverts the numbers of mints and proofs do not match', async function () {
        const { mints, proofs } = generateReport(signer1, defaultMaxMints);

        proofs.pop();
        const reportId = randomBytes(32);

        await expect(bascule.connect(mintReporter).reportMints(reportId, mints, proofs)).to.revertedWithCustomError(
          bascule,
          'BadMintProofsSize'
        );
      });

      it('reportMints: reverts when called by unauthorized account', async function () {
        const reportId = randomBytes(32);
        const { mints, proofs } = generateReport(trustedSigner, 1n);

        await expect(bascule.connect(signer1).reportMints(reportId, mints, proofs)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });
    });

    describe('Validate mints', function () {
      it('validateMint: when deposit has not been reported but amount is above threshold', async function () {
        const amount = randomBigInt(8);
        const mint: IGMPBascule.MessageStruct = {
          amount,
          nonce: randomBigInt(10),
          toToken: TOKEN_ADDRESS,
          recipient: randomAddress()
        };
        const mintID = calcMintID(mint);

        await expect(bascule.connect(mintValidator).validateMint(mint))
          .to.be.revertedWithCustomError(bascule, 'MintFailedValidation')
          .withArgs(mintID, amount);
      });

      it('validateMint: when mint has not been reported and it does not need to be', async function () {
        const amount = randomBigInt(8);
        await bascule.connect(validationGuardian).updateValidateThreshold(amount + 1n);

        const mint: IGMPBascule.MessageStruct = {
          amount,
          nonce: randomBigInt(10),
          toToken: TOKEN_ADDRESS,
          recipient: randomAddress()
        };
        const mintID = calcMintID(mint);

        await expect(bascule.connect(mintValidator).validateMint(mint))
          .to.emit(bascule, 'MintNotValidated')
          .withArgs(mintID, amount);

        await expect(bascule.connect(mintValidator).validateMint(mint))
          .to.be.revertedWithCustomError(bascule, 'AlreadyMinted')
          .withArgs(mintID, amount);
      });

      it('validateMint: reverts when called by unauthorized account', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        const mint: IGMPBascule.MessageStruct = {
          amount,
          nonce: randomBigInt(10),
          toToken: TOKEN_ADDRESS,
          recipient: randomAddress()
        };
        const mintID = calcMintID(mint);
        const proof = rawSign(trustedSigner, mintID);

        await bascule.connect(mintReporter).reportMints(reportId, [mint], [proof]);

        await expect(bascule.connect(signer1).validateMint(mint)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });
    });
  });
});
