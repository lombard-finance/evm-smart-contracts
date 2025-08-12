import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  CHAIN_ID,
  deployContract,
  DEPOSIT_BTC_ACTION_V0,
  encode,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  randomBigInt,
  rawSign,
  signDepositBtcV0Payload,
  Signer
} from './helpers';
import { BasculeV3 } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { randomBytes } from 'ethers';

describe('BasculeV3', function () {
  let _: Signer,
    owner: Signer,
    pauser: Signer,
    depositReporter: Signer,
    withdrawalValidator: Signer,
    trustedSigner: Signer,
    validationGuardian: Signer,
    notary1: Signer,
    notary2: Signer,
    signer1: Signer;

  let bascule: BasculeV3 & Addressable;
  const defaultMaxDeposits = 3n;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [
      _,
      owner,
      pauser,
      depositReporter,
      withdrawalValidator,
      trustedSigner,
      validationGuardian,
      notary1,
      notary2,
      signer1
    ] = await getSignersWithPrivateKeys();

    bascule = await deployContract<BasculeV3 & Addressable>(
      'BasculeV3',
      [
        owner.address,
        pauser.address,
        depositReporter.address,
        withdrawalValidator.address,
        defaultMaxDeposits,
        trustedSigner.address
      ],
      false
    );
    bascule.address = await bascule.getAddress();

    await bascule
      .connect(owner)
      .grantRole(ethers.keccak256(ethers.toUtf8Bytes('VALIDATION_GUARDIAN_ROLE')), validationGuardian.address);

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

    it('DEPOSIT_REPORTER_ROLE', async function () {
      expect(await bascule.DEPOSIT_REPORTER_ROLE()).to.be.eq(
        ethers.keccak256(ethers.toUtf8Bytes('DEPOSIT_REPORTER_ROLE'))
      );
    });

    it('PAUSER_ROLE', async function () {
      expect(await bascule.PAUSER_ROLE()).to.be.eq(ethers.keccak256(ethers.toUtf8Bytes('PAUSER_ROLE')));
    });

    it('VALIDATION_GUARDIAN_ROLE', async function () {
      expect(await bascule.VALIDATION_GUARDIAN_ROLE()).to.be.eq(
        ethers.keccak256(ethers.toUtf8Bytes('VALIDATION_GUARDIAN_ROLE'))
      );
    });

    it('WITHDRAWAL_VALIDATOR_ROLE', async function () {
      expect(await bascule.WITHDRAWAL_VALIDATOR_ROLE()).to.be.eq(
        ethers.keccak256(ethers.toUtf8Bytes('WITHDRAWAL_VALIDATOR_ROLE'))
      );
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

    it('Deposit reporter has role', async function () {
      expect(await bascule.hasRole(ethers.keccak256(ethers.toUtf8Bytes('DEPOSIT_REPORTER_ROLE')), depositReporter)).to
        .be.true;
    });

    it('Withdrawal validator has role', async function () {
      expect(
        await bascule.hasRole(ethers.keccak256(ethers.toUtf8Bytes('WITHDRAWAL_VALIDATOR_ROLE')), withdrawalValidator)
      ).to.be.true;
    });

    it('Trusted signer', async function () {
      expect(await bascule.trustedSigner()).to.be.eq(trustedSigner.address);
    });

    it('Max deposits', async function () {
      expect(await bascule.maxDeposits()).to.be.eq(defaultMaxDeposits);
    });

    it('Validate threshold', async function () {
      expect(await bascule.validateThreshold()).to.be.eq(0n);
    });

    it('Paused is false', async function () {
      expect(await bascule.paused()).to.be.false;
    });
  });

  describe('Setters', function () {
    describe('Max deposits', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('setMaxDeposits: default admin can', async function () {
        const newValue = randomBigInt(2);
        await expect(bascule.connect(owner).setMaxDeposits(newValue))
          .to.emit(bascule, 'MaxDepositsUpdated')
          .withArgs(newValue);

        expect(await bascule.maxDeposits()).to.be.eq(newValue);
      });

      it('setMaxDeposits: reverts when called by unauthorized account', async function () {
        const newValue = randomBigInt(2);
        await expect(bascule.connect(signer1).setMaxDeposits(newValue)).to.revertedWithCustomError(
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

      it('updateValidateThreshold: guardian lost their authority', async function () {
        const oldValue = await bascule.validateThreshold();
        await expect(
          bascule.connect(validationGuardian).updateValidateThreshold(oldValue + 1n)
        ).to.revertedWithCustomError(bascule, 'AccessControlUnauthorizedAccount');
      });

      it('updateValidateThreshold: default admin can decrease', async function () {
        const oldValue = await bascule.validateThreshold();
        const newValue = oldValue - randomBigInt(5);
        await expect(bascule.connect(owner).updateValidateThreshold(newValue))
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
        await expect(bascule.connect(signer1).updateValidateThreshold(oldValue)).to.revertedWithCustomError(
          bascule,
          'SameValidationThreshold'
        );
      });
    });
  });

  describe('Pause', function () {
    const amount = randomBigInt(8);
    let depositId: string;
    let proof: string;

    before(async function () {
      await snapshot.restore();

      let { payload } = await signDepositBtcV0Payload(
        [notary1, notary2],
        [true, true],
        CHAIN_ID,
        signer1.address,
        amount,
        encode(['uint256'], [randomBigInt(8)]) //txId
      );
      depositId = ethers.keccak256('0x' + payload.slice(10));
      proof = rawSign(trustedSigner, depositId);

      const reportId = randomBytes(32);
      await bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]);
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

    it('reportDeposits: reverts when paused', async function () {
      const reportId = randomBytes(32);
      const amount = randomBigInt(8);
      let res = await signDepositBtcV0Payload(
        [notary1, notary2],
        [true, true],
        CHAIN_ID,
        signer1.address,
        amount,
        ethers.randomBytes(32)
      );
      const payload = res.payload;
      const depositId = ethers.keccak256('0x' + payload.slice(10));
      const proof = rawSign(trustedSigner, depositId);

      await expect(bascule.connect(signer1).reportDeposits(reportId, [depositId], [proof])).to.revertedWithCustomError(
        bascule,
        'EnforcedPause'
      );
    });

    it('validateWithdrawal: reverts when paused', async function () {
      await expect(
        bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount)
      ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');
    });

    it('setMaxDeposits: reverts when paused', async function () {
      await expect(bascule.connect(owner).setMaxDeposits(randomBigInt(2))).to.be.revertedWithCustomError(
        bascule,
        'EnforcedPause'
      );
    });

    it('setTrustedSigner: reverts when paused', async function () {
      await expect(
        bascule.connect(owner).setTrustedSigner(ethers.Wallet.createRandom().address)
      ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');
    });

    it('updateValidateThreshold: reverts when paused', async function () {
      const oldValue = await bascule.validateThreshold();
      await expect(
        bascule.connect(validationGuardian).updateValidateThreshold(oldValue + 1n)
      ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');
    });

    it('unpause: reverts when called by not a pauser', async function () {
      await expect(bascule.connect(signer1).unpause()).to.revertedWithCustomError(
        bascule,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('unpause: pauser can unpause', async function () {
      await expect(bascule.connect(pauser).unpause()).to.emit(bascule, 'Unpaused').withArgs(pauser.address);
    });

    it('unpause: reverts contract is not paused', async function () {
      await expect(bascule.connect(pauser).unpause()).to.revertedWithCustomError(bascule, 'ExpectedPause');
    });
  });

  describe('Report and validate deposits', function () {
    describe('Main flow', function () {
      const amount = randomBigInt(8);
      let payload: string;
      let depositId: string;
      let proof: string;

      before(async function () {
        await snapshot.restore();

        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          encode(['uint256'], [randomBigInt(8)]) //txId
        );
        payload = res.payload;
        depositId = ethers.keccak256('0x' + payload.slice(10));
        proof = rawSign(trustedSigner, depositId);
      });

      it('Report deposit payload', async function () {
        expect(await bascule.depositHistory(depositId)).to.be.eq(0);

        const reportId = randomBytes(32);
        await expect(bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]))
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);

        expect(await bascule.depositHistory(depositId)).to.be.eq(1);
      });

      it('Validate withdrawal', async function () {
        await expect(bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount))
          .to.emit(bascule, 'WithdrawalValidated')
          .withArgs(depositId, amount);

        expect(await bascule.depositHistory(depositId)).to.be.eq(2);
      });

      it('Repeat reporting deposit payload', async function () {
        const reportId = randomBytes(32);
        await expect(bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]))
          // Number of reported deposits does not decrease to preserve the last version behavior
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1)
          .and.to.emit(bascule, 'DepositAlreadyReported')
          .withArgs(depositId);

        expect(await bascule.depositHistory(depositId)).to.be.eq(2);
      });

      it('Repeat withdrawal validation', async function () {
        await expect(bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount))
          .to.be.revertedWithCustomError(bascule, 'AlreadyWithdrawn')
          .withArgs(depositId, amount);

        expect(await bascule.depositHistory(depositId)).to.be.eq(2);
      });
    });

    describe('Report deposits', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('Report payload signed by cubist', async function () {
        await bascule.connect(owner).setTrustedSigner('0x4ef59bdec34968e9429ae662e458a595a0f937df');
        const reportId = randomBytes(32);

        await expect(
          bascule
            .connect(depositReporter)
            .reportDeposits(
              reportId,
              [Buffer.from('dafc280d43b1e4d170ae84dd7a5b8499f879cf167acf038af0d399f6bda304db', 'hex')],
              [
                '0x212f28edebea4b87f484ecfcbf4fffced9a81f8a0b81d99e92befebaeba266cc7f9a439a6e5797276eb58b4406053107c04f354fa01dc8607ccf8d58f099b1701c'
              ]
            )
        )
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);
      });

      it('reportDeposits: max number of payloads', async function () {
        const depositIds = [];
        const proofs = [];

        for (let i = 0n; i < defaultMaxDeposits; i++) {
          const amount = randomBigInt(8);
          let res = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer1.address,
            amount,
            ethers.randomBytes(32)
          );
          const payload = res.payload;
          const depositId = ethers.keccak256('0x' + payload.slice(10));
          const proof = rawSign(trustedSigner, depositId);

          depositIds.push(depositId);
          proofs.push(proof);
        }
        const reportId = randomBytes(32);

        await expect(bascule.connect(depositReporter).reportDeposits(reportId, depositIds, proofs))
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, defaultMaxDeposits);
      });

      it('reportDeposits: reverts when deposit signed by not a trusted account', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32)
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));
        const proof = rawSign(signer1, depositId);

        await expect(bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]))
          .to.revertedWithCustomError(bascule, 'BadProof')
          .withArgs(0, depositId, proof);
      });

      it('reportDeposits: reverts when signature is invalid', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32)
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));
        const proof = '0x';

        await expect(bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]))
          .to.revertedWithCustomError(bascule, 'BadProof')
          .withArgs(0, depositId, proof);
      });

      it('reportDeposits: skips signature check when trusted signer is 0 address', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32)
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));
        const proof = rawSign(signer1, depositId);
        await bascule.connect(owner).setTrustedSigner(ethers.ZeroAddress);

        await expect(bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]))
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);
      });

      it('reportDeposits: reverts when max number of deposits is exceeded', async function () {
        const depositIds = [];
        const proofs = [];

        for (let i = 0n; i < defaultMaxDeposits + 1n; i++) {
          const amount = randomBigInt(8);
          let res = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer1.address,
            amount,
            ethers.randomBytes(32)
          );
          const payload = res.payload;
          const depositId = ethers.keccak256('0x' + payload.slice(10));
          const proof = rawSign(trustedSigner, depositId);

          depositIds.push(depositId);
          proofs.push(proof);
        }
        const reportId = randomBytes(32);

        await expect(
          bascule.connect(depositReporter).reportDeposits(reportId, depositIds, proofs)
        ).to.revertedWithCustomError(bascule, 'BadDepositReport');
      });

      it('reportDeposits: reverts the numbers of deposits and proofs do not match', async function () {
        const depositIds = [];
        const proofs = [];

        for (let i = 0n; i < defaultMaxDeposits; i++) {
          const amount = randomBigInt(8);
          let res = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer1.address,
            amount,
            ethers.randomBytes(32)
          );
          const payload = res.payload;
          const depositId = ethers.keccak256('0x' + payload.slice(10));
          const proof = rawSign(trustedSigner, depositId);

          depositIds.push(depositId);
          proofs.push(proof);
        }
        proofs.pop();
        const reportId = randomBytes(32);

        await expect(
          bascule.connect(depositReporter).reportDeposits(reportId, depositIds, proofs)
        ).to.revertedWithCustomError(bascule, 'BadDepositProofsSize');
      });

      it('reportDeposits: reverts when called by unauthorized account', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32)
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));
        const proof = rawSign(trustedSigner, depositId);

        await expect(
          bascule.connect(signer1).reportDeposits(reportId, [depositId], [proof])
        ).to.revertedWithCustomError(bascule, 'AccessControlUnauthorizedAccount');
      });
    });

    describe('Validate withdrawals', function () {
      it('validateWithdrawal: when deposit has not been reported but amount is above threshold', async function () {
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32) //txId
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));

        await expect(bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount))
          .to.be.revertedWithCustomError(bascule, 'WithdrawalFailedValidation')
          .withArgs(depositId, amount);
      });

      //When amount is below threshold value
      it('validateWithdrawal: when deposit has not been reported and it does not need to be', async function () {
        const amount = randomBigInt(8);
        await bascule.connect(validationGuardian).updateValidateThreshold(amount + 1n);

        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32) //txId
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));

        await expect(bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount))
          .to.emit(bascule, 'WithdrawalNotValidated')
          .withArgs(depositId, amount);

        await expect(bascule.connect(withdrawalValidator).validateWithdrawal(depositId, amount))
          .to.be.revertedWithCustomError(bascule, 'AlreadyWithdrawn')
          .withArgs(depositId, amount);
      });

      it('validateWithdrawal: reverts when called by unauthorized account', async function () {
        const reportId = randomBytes(32);
        const amount = randomBigInt(8);
        let res = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          amount,
          ethers.randomBytes(32)
        );
        const payload = res.payload;
        const depositId = ethers.keccak256('0x' + payload.slice(10));
        const proof = rawSign(trustedSigner, depositId);

        await bascule.connect(depositReporter).reportDeposits(reportId, [depositId], [proof]);

        await expect(bascule.connect(signer1).validateWithdrawal(depositId, amount)).to.revertedWithCustomError(
          bascule,
          'AccessControlUnauthorizedAccount'
        );
      });
    });
  });
});
