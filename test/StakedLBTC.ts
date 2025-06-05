import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  CHAIN_ID,
  deployContract,
  DEPOSIT_BTC_ACTION_V0,
  DEPOSIT_BTC_ACTION_V1,
  e8,
  encode,
  FEE_APPROVAL_ACTION,
  generatePermitSignature,
  getFeeTypedMessage,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  initNativeLBTC,
  NEW_VALSET,
  randomBigInt,
  signDepositBtcV0Payload,
  signDepositBtcV1Payload,
  Signer,
  signSwapReceiptPayload,
  signSwapRequestPayload,
  SWAP_RECEIPT_SELECTOR,
  SWAP_REQUEST_SELECTOR
} from './helpers';
import { Bascule, Consortium, NativeLBTC, StakedLBTC, SwapRouter } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';
import { Typed } from 'ethers';

const DAY = 86400;

class Addressable {
  get address(): string {
    return this._address;
  }

  set address(value: string) {
    this._address = value;
  }

  // @ts-ignore
  private _address: string;
}

describe('StakedLBTC', function () {
  let _: Signer,
    owner: Signer,
    treasury: Signer,
    minter: Signer,
    claimer: Signer,
    operator: Signer,
    pauser: Signer,
    reporter: Signer,
    notary: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer;
  let stakedLbtc: StakedLBTC & Addressable;
  let stakedLbtc2: StakedLBTC;
  let bascule: Bascule;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let consortium: Consortium & Addressable;
  const burnCommission = 1000;

  before(async function () {
    [_, owner, treasury, minter, claimer, operator, pauser, reporter, notary, signer1, signer2, signer3] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(getPayloadForAction([1, [notary.publicKey], [1], 1, 1], NEW_VALSET));

    stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
      await consortium.getAddress(),
      burnCommission,
      treasury.address,
      owner.address
    ]);
    stakedLbtc.address = await stakedLbtc.getAddress();

    stakedLbtc2 = await deployContract<StakedLBTC>('StakedLBTC', [
      await consortium.getAddress(),
      burnCommission,
      treasury.address,
      owner.address
    ]);

    bascule = await deployContract<Bascule>(
      'Bascule',
      [owner.address, pauser.address, reporter.address, stakedLbtc.address, 100],
      false
    );

    // Minter
    await stakedLbtc.connect(owner).addMinter(minter.address);
    await stakedLbtc2.connect(owner).addMinter(minter.address);
    // Claimer
    await stakedLbtc.connect(owner).addClaimer(claimer.address);
    await stakedLbtc2.connect(owner).addClaimer(claimer.address);
    // Operator
    await stakedLbtc.connect(owner).changeOperator(operator.address);
    await stakedLbtc2.connect(owner).changeOperator(operator.address);
    // Pauser
    await stakedLbtc.connect(owner).changePauser(pauser.address);
    // Initialize permit module
    await stakedLbtc.connect(owner).reinitialize();
    await stakedLbtc2.connect(owner).reinitialize();

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  describe('Setters and getters', function () {
    describe('View functions', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('owner()', async function () {
        expect(await stakedLbtc.owner()).to.equal(owner.address);
      });

      it('treasury()', async function () {
        expect(await stakedLbtc.getTreasury()).to.equal(treasury.address);
      });

      it('consortium()', async function () {
        expect(await stakedLbtc.consortium()).to.equal(await consortium.getAddress());
      });

      it('decimals()', async function () {
        expect(await stakedLbtc.decimals()).to.equal(8n);
      });

      it('Bascule() is not set by default', async function () {
        expect(await stakedLbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
      });
    });

    describe('Pause', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('LBTC is not paused by default', async function () {
        expect(await stakedLbtc.paused()).to.be.false;
      });

      it('changePauser() owner can change pauser', async function () {
        const newPauser = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changePauser(newPauser))
          .to.emit(stakedLbtc, 'PauserRoleTransferred')
          .withArgs(pauser.address, newPauser);
      });

      it('pause() pauser can set on pause', async function () {
        await expect(stakedLbtc.connect(pauser).pause()).to.emit(stakedLbtc, 'Paused').withArgs(pauser.address);
        expect(await stakedLbtc.paused()).to.be.true;
      });

      it('pause() reverts when called by not an pauser', async function () {
        await expect(stakedLbtc.connect(owner).pause())
          .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
          .withArgs(owner.address);
      });

      it('unpause() turns off enforced pause', async function () {
        await stakedLbtc.connect(pauser).pause();
        expect(await stakedLbtc.paused()).to.be.true;

        await expect(stakedLbtc.connect(owner).unpause()).to.emit(stakedLbtc, 'Unpaused').withArgs(owner.address);
        expect(await stakedLbtc.paused()).to.be.false;
      });

      it('unpause() reverts when called by not an owner', async function () {
        await stakedLbtc.connect(pauser).pause();
        expect(await stakedLbtc.paused()).to.be.true;

        await expect(stakedLbtc.connect(pauser).unpause())
          .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(pauser.address);
      });
    });

    describe('Toggle withdrawals', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('toggleWithdrawals() owner can enable', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals())
          .to.emit(stakedLbtc, 'WithdrawalsEnabled')
          .withArgs(true);
      });

      it('toggleWithdrawals() owner can disable', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals())
          .to.emit(stakedLbtc, 'WithdrawalsEnabled')
          .withArgs(false);
      });

      it('toggleWithdrawals() reverts when called by not an owner', async function () {
        await expect(stakedLbtc.connect(signer1).toggleWithdrawals())
          .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });
    });

    describe('Manage roles and contracts', function () {
      let newRole: Signer;

      before(async function () {
        await snapshot.restore();
        newRole = signer1;
      });

      const multiRoles = [
        {
          name: 'Minter',
          setter: 'addMinter',
          revoke: 'removeMinter',
          getter: 'isMinter',
          event: 'MinterUpdated',
          defaultAccount: () => minter
        },
        {
          name: 'Claimer',
          setter: 'addClaimer',
          revoke: 'removeClaimer',
          getter: 'isClaimer',
          event: 'ClaimerUpdated',
          defaultAccount: () => claimer
        }
      ];

      multiRoles.forEach(function (role) {
        it(`${role.getter}() false by default`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[role.getter](newRole)).to.be.false;
        });

        it(`${role.setter}() owner can assign new ${role.name}`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(owner)[role.setter](newRole))
            .to.emit(stakedLbtc, role.event)
            .withArgs(newRole.address, true);
          // @ts-ignore
          expect(await stakedLbtc[role.getter](newRole)).to.be.true;
        });

        it(`There could be more than one ${role.name}`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[role.getter](role.defaultAccount())).to.be.true;
        });

        it(`${role.revoke}() owner can revoke role`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(owner)[role.revoke](newRole.address))
            .to.emit(stakedLbtc, role.event)
            .withArgs(newRole.address, false);
          // @ts-ignore
          expect(await stakedLbtc[role.getter](newRole)).to.be.false;
        });

        it(`The other ${role.name} stays active after revoke`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[role.getter](role.defaultAccount())).to.be.true;
        });

        it(`${role.setter}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(role.defaultAccount())[role.setter](newRole))
            .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
            .withArgs(role.defaultAccount().address);
        });

        it(`${role.setter}() reverts when assign to 0 address`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(
            stakedLbtc,
            'ZeroAddress'
          );
        });

        it(`${role.revoke}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[role.revoke](role.defaultAccount()))
            .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
            .withArgs(signer1.address);
        });
      });

      const singleRoles = [
        {
          name: 'Pauser',
          setter: 'changePauser',
          getter: 'pauser',
          event: 'PauserRoleTransferred',
          defaultAccount: () => pauser.address
        },
        {
          name: 'Operator',
          setter: 'changeOperator',
          getter: 'operator',
          event: 'OperatorRoleTransferred',
          defaultAccount: () => operator.address
        },
        {
          name: 'Treasury',
          setter: 'changeTreasuryAddress',
          getter: 'getTreasury',
          event: 'TreasuryAddressChanged',
          defaultAccount: () => treasury.address
        },
        {
          name: 'Consortium',
          setter: 'changeConsortium',
          getter: 'consortium',
          event: 'ConsortiumChanged',
          defaultAccount: () => consortium.address
        },
        {
          name: 'Bascule',
          setter: 'changeBascule',
          getter: 'Bascule',
          event: 'BasculeChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        },
        {
          name: 'SwapRouter',
          setter: 'changeSwapRouter',
          getter: 'swapRouter',
          event: 'SwapRouterChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        }
      ];
      singleRoles.forEach(function (role) {
        it(`${role.setter}() owner can set ${role.name}`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(owner)[role.setter](newRole))
            .to.emit(stakedLbtc, role.event)
            .withArgs(role.defaultAccount(), newRole.address);
        });

        it(`${role.getter}() returns new ${role.name}`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[role.getter]()).to.be.equal(newRole);
        });

        it(`${role.setter}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(newRole)[role.setter](ethers.Wallet.createRandom().address))
            .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
            .withArgs(newRole.address);
        });

        if (!role.canBeZero) {
          it(`${role.setter}() reverts when set to 0 address`, async function () {
            // @ts-ignore
            await expect(stakedLbtc.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(
              stakedLbtc,
              'ZeroAddress'
            );
          });
        }
      });
    });

    describe('Manage fee values', function () {
      before(async function () {
        await snapshot.restore();
      });

      const fees = [
        {
          name: 'MintFee',
          setter: 'setMintFee',
          getter: 'getMintFee',
          event: 'FeeChanged',
          account: 'operator',
          accessError: 'UnauthorizedAccount',
          canBeZero: true
        },
        {
          name: 'DustFee',
          setter: 'changeDustFeeRate',
          getter: 'getDustFeeRate',
          event: 'DustFeeRateChanged',
          account: 'owner',
          accessError: 'OwnableUnauthorizedAccount',
          zeroError: 'InvalidDustFeeRate'
        },
        {
          name: 'BurnCommission',
          setter: 'changeBurnCommission',
          getter: 'getBurnCommission',
          event: 'BurnCommissionChanged',
          account: 'owner',
          accessError: 'OwnableUnauthorizedAccount',
          canBeZero: true
        }
      ];

      fees.forEach(function (fee) {
        let newValue: bigint;

        it(`${fee.setter}() ${fee.account} can set ${fee.name}`, async function () {
          // @ts-ignore
          const oldValue = await stakedLbtc[fee.getter]();
          newValue = randomBigInt(4);
          // @ts-ignore
          await expect(stakedLbtc.connect(eval(fee.account))[fee.setter](newValue))
            .to.emit(stakedLbtc, fee.event)
            .withArgs(oldValue, newValue);
        });

        it(`${fee.getter}() returns new ${fee.name}`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[fee.getter]()).to.be.equal(newValue);
        });

        if (fee.canBeZero) {
          it(`${fee.setter}() ${fee.account} can set to 0`, async function () {
            // @ts-ignore
            await expect(stakedLbtc.connect(eval(fee.account))[fee.setter](0n))
              .to.emit(stakedLbtc, fee.event)
              .withArgs(newValue, 0n);
          });
        } else {
          it(`${fee.setter}() reverts when set to 0`, async function () {
            // @ts-ignore
            await expect(stakedLbtc.connect(eval(fee.account))[fee.setter](0n))
              // @ts-ignore
              .to.revertedWithCustomError(stakedLbtc, fee.zeroError);
          });
        }

        it(`${fee.setter}() reverts when called by not ${fee.account}`, async function () {
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[fee.setter](randomBigInt(3)))
            .to.revertedWithCustomError(stakedLbtc, fee.accessError)
            .withArgs(signer1.address);
        });
      });
    });
  });

  describe('Mint V0', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    describe('Negative cases', function () {
      let newConsortium: Consortium;
      const defaultTxId = ethers.hexlify(ethers.randomBytes(32));
      const defaultArgs = {
        signers: () => [signer1, signer2],
        signatures: [true, true],
        threshold: 2,
        mintRecipient: () => signer1,
        signatureRecipient: () => signer1,
        mintAmount: 100_000_000n,
        signatureAmount: 100_000_000n,
        destinationContract: () => stakedLbtc.getAddress(),
        signatureDestinationContract: () => stakedLbtc.getAddress(),
        chainId: CHAIN_ID,
        signatureChainId: CHAIN_ID,
        executionChain: CHAIN_ID,
        caller: () => stakedLbtc.getAddress(),
        verifier: () => newConsortium.getAddress(),
        epoch: 1,
        txId: defaultTxId,
        signatureTxId: defaultTxId,
        interface: () => newConsortium,
        customError: 'NotEnoughSignatures',
        params: () => []
      };
      let defaultProof: string;
      let defaultPayload: string;

      beforeEach(async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<Consortium>('Consortium', [owner.address]);
        const valset = getPayloadForAction([1, [signer1.publicKey, signer2.publicKey], [1, 1], 2, 1], NEW_VALSET);
        await newConsortium.connect(owner).setInitialValidatorSet(valset);
        const data = await signDepositBtcV0Payload(
          defaultArgs.signers(),
          defaultArgs.signatures,
          defaultArgs.signatureChainId,
          defaultArgs.signatureRecipient().address,
          defaultArgs.signatureAmount,
          defaultArgs.signatureTxId
        );
        defaultProof = data.proof;
        defaultPayload = data.payload;

        await stakedLbtc.connect(owner).changeConsortium(await newConsortium.getAddress());
      });

      const args = [
        {
          ...defaultArgs,
          name: 'not enough signatures',
          signatures: [true, false],
          customError: 'NotEnoughSignatures'
        },
        {
          ...defaultArgs,
          name: 'executed in wrong chain',
          customError: 'WrongChainId',
          chainId: 1,
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'destination chain missmatch',
          signatureChainId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'recipient is 0 address',
          mintRecipient: () => {
            return { address: ethers.ZeroAddress };
          },
          signatureRecipient: () => {
            return { address: ethers.ZeroAddress };
          },
          customError: 'Actions_ZeroAddress',
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'extra data signature mismatch',
          signatureTxId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'extra data mismatch',
          txId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'amount is 0',
          mintAmount: 0,
          signatureAmount: 0,
          customError: 'ZeroAmount',
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'Wrong signature recipient',
          signatureRecipient: () => signer2
        },
        {
          ...defaultArgs,
          name: 'Wrong mint recipient',
          mintRecipient: () => signer2
        },
        {
          ...defaultArgs,
          name: 'Wrong amount',
          mintAmount: 1
        },
        {
          ...defaultArgs,
          name: 'unknown validator set',
          signers: () => [signer1, owner],
          customError: 'NotEnoughSignatures'
        },
        {
          ...defaultArgs,
          name: 'wrong amount of signatures',
          signers: () => [signer1],
          signatures: [true],
          customError: 'LengthMismatch'
        }
      ];
      args.forEach(function (args) {
        it(`Reverts when ${args.name}`, async function () {
          const data = await signDepositBtcV0Payload(
            args.signers(),
            args.signatures,
            args.signatureChainId,
            args.signatureRecipient().address,
            args.signatureAmount,
            args.signatureTxId
          );
          const payload = getPayloadForAction(
            [
              encode(['uint256'], [args.chainId]),
              encode(['address'], [args.mintRecipient().address]),
              args.mintAmount,
              args.txId,
              0
            ],
            DEPOSIT_BTC_ACTION_V0
          );

          await expect(stakedLbtc['mint(bytes,bytes)'](payload, data.proof)).to.revertedWithCustomError(
            args.interface(),
            args.customError
          );
        });
      });

    });
  });

  describe('Minting', function () {
    const mintVersions = [
      {
        version: 'V0',
        mint: 'mint(bytes,bytes)',
        mintWithFee: 'mintWithFee',
        payloadPrefix: DEPOSIT_BTC_ACTION_V0,
        signPayload: async (recipient: string, amount: bigint) =>
          signDepositBtcV0Payload(
            [notary],
            [true],
            CHAIN_ID,
            recipient,
            amount,
            encode(['uint256'], [randomBigInt(8)])
          ),
        defaultData: async function() {
          const amount = randomBigInt(8);
          // @ts-ignore
          const defaultData = (await this.signPayload(signer1.address, amount)) as {
            payload: BytesLike | Typed;
            proof: BytesLike | Typed;
            amount: bigint;
            recipient: Signer;
            feeApprovalPayload: string;
            userSignature: string;
          };
          defaultData.amount = amount;
          defaultData.recipient = signer1;
          defaultData.feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval');
          defaultData.userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 1, snapshotTimestamp + DAY);
          return defaultData;
        }
      },
      {
        version: 'V1',
        mint: 'mintV1',
        mintWithFee: 'mintV1WithFee',
        payloadPrefix: DEPOSIT_BTC_ACTION_V1,
        signPayload: async (recipient: string, amount: bigint) =>
          signDepositBtcV1Payload(
            [notary],
            [true],
            CHAIN_ID,
            recipient,
            amount,
            encode(['uint256'], [randomBigInt(8)]),
            stakedLbtc.address
          ),
        defaultData: async function() {
          const amount = randomBigInt(8);
          // @ts-ignore
          const defaultData = (await this.signPayload(signer1.address, amount)) as {
            payload: BytesLike | Typed;
            proof: BytesLike | Typed;
            amount: bigint;
            recipient: Signer;
            feeApprovalPayload: string;
            userSignature: string;
          };
          defaultData.amount = amount;
          defaultData.recipient = signer1;
          defaultData.feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval');
          defaultData.userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 1, snapshotTimestamp + DAY);
          return defaultData;
        }
      }
    ];

    const args = [
      {
        name: 'random amount to themselves',
        amount: randomBigInt(8),
        msgSender: () => signer1,
        recipient: () => signer1
      },
      {
        name: 'random amount to other account',
        amount: randomBigInt(8),
        msgSender: () => signer1,
        recipient: () => signer2
      },
      {
        name: 'amount is dust',
        amount: 3n,
        recipient: () => signer1,
        msgSender: () => signer2
      }
    ];

    describe('Anyone can mint valid payload', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      mintVersions.forEach(function (mint) {
        args.forEach(function (arg) {
          it(`mint${mint.version}() ${arg.name}`, async function () {
            const amount = arg.amount;
            const sender = arg.msgSender();
            const recipient = arg.recipient();

            const totalSupplyBefore = await stakedLbtc.totalSupply();
            const { payload, payloadHash, proof } = await mint.signPayload(recipient.address, amount);

            // @ts-ignore
            const tx = stakedLbtc.connect(sender)[mint.mint](payload, proof);
            await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
            await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
            const totalSupplyAfter = await stakedLbtc.totalSupply();
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });

        it(`mint${mint.version}() when bascule enabled`, async function() {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());

          const amount = randomBigInt(8);
          const sender = signer1;
          const recipient = signer2;

          const totalSupplyBefore = await stakedLbtc.totalSupply();
          const { payload, payloadHash, proof } = await mint.signPayload(recipient.address, amount);

          // report deposit
          const reportId = ethers.zeroPadValue('0x01', 32);
          await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))]))
            .to.emit(bascule, 'DepositsReported')
            .withArgs(reportId, 1);

          // @ts-ignore
          const tx = stakedLbtc.connect(sender)[mint.mint](payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        })

        it(`mint${mint.version}() reverts when not reported to bascule`, async function() {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof))
            .to.be.revertedWithCustomError(bascule, 'WithdrawalFailedValidation');
        })

        it(`mint${mint.version}() reverts when paused`, async function() {
          await stakedLbtc.connect(pauser).pause();
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof))
            .to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        })

        it(`mint${mint.version}() reverts when payload has been used`, async function() {
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof);
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof))
            .to.be.revertedWithCustomError(stakedLbtc, 'PayloadAlreadyUsed');
        })
      });
    });

    describe('Claimer can mint with fee', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      mintVersions.forEach(function (mint) {
        args.forEach(function (arg) {
          const fees = [
            {
              name: 'approved fee is less than max just by 1sat',
              approved: arg.amount - 1n,
              max: arg.amount
            },
            {
              name: 'approved is only 1sat and max is equal to mint amount',
              approved: 1n,
              max: arg.amount
            },
            {
              name: 'approved is greater than max by 1sat',
              approved: arg.amount,
              max: arg.amount - 1n
            },
            {
              name: 'approved is equal to mint amount and max is only 1sat',
              approved: arg.amount,
              max: 1n
            }
          ];

          fees.forEach(function (fee) {
            it(`${mint.mintWithFee}() ${fee.name} and ${arg.name}`, async function () {
              const amount = arg.amount;
              const recipient = arg.recipient();
              const totalSupplyBefore = await stakedLbtc.totalSupply();
              const { payload, payloadHash, proof } = await mint.signPayload(recipient.address, amount);

              // Set fee and approve
              const userSignature = await getFeeTypedMessage(
                recipient,
                stakedLbtc.address,
                fee.approved,
                snapshotTimestamp + DAY
              );
              const approval = getPayloadForAction([fee.approved, snapshotTimestamp + DAY], 'feeApproval');
              await stakedLbtc.connect(operator).setMintFee(fee.max);
              const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;

              // @ts-ignore
              const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, approval, userSignature);
              await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
              await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
              await expect(tx)
                .to.emit(stakedLbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
              await expect(tx)
                .to.emit(stakedLbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
              await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
              await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
              const totalSupplyAfter = await stakedLbtc.totalSupply();
              expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
            });
          });
        });

        it(`${mint.mintWithFee}() when bascule enabled`, async function() {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
          // new
          const amount = randomBigInt(8);
          const recipient = signer1;
          const totalSupplyBefore = await stakedLbtc.totalSupply();
          const { payload, payloadHash, proof } = await mint.signPayload(recipient.address, amount);

          // report deposit
          const reportId = ethers.zeroPadValue('0x01', 32);
          await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))]))
            .to.emit(bascule, 'DepositsReported')
            .withArgs(reportId, 1);

          // Set fee and approve
          const feeApproved = randomBigInt(2);
          const feeMax = randomBigInt(2);
          const userSignature = await getFeeTypedMessage(
            recipient,
            stakedLbtc.address,
            feeApproved,
            snapshotTimestamp + DAY
          );
          const approval = getPayloadForAction([feeApproved, snapshotTimestamp + DAY], 'feeApproval');
          await stakedLbtc.connect(operator).setMintFee(feeMax);
          const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

          // @ts-ignore
          const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, approval, userSignature);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
          await expect(tx)
            .to.emit(stakedLbtc, 'Transfer')
            .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
          await expect(tx)
            .to.emit(stakedLbtc, 'Transfer')
            .withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        })

        it(`${mint.mintWithFee}() reverts when approve has expired`, async function () {
          const defaultData = await mint.defaultData();
          const feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
          const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 1, snapshotTimestamp);
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, feeApprovalPayload, userSignature))
            .to.revertedWithCustomError(stakedLbtc, 'UserSignatureExpired')
            .withArgs(snapshotTimestamp);
        });

        it(`${mint.mintWithFee}() reverts when mint payload type is invalid`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.feeApprovalPayload, defaultData.userSignature, defaultData.feeApprovalPayload, defaultData.userSignature))
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(mint.payloadPrefix, FEE_APPROVAL_ACTION);
        });

        it(`${mint.mintWithFee}() reverts when fee payload type is invalid`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.payload, defaultData.userSignature))
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(FEE_APPROVAL_ACTION, mint.payloadPrefix);
        });

        it(`${mint.mintWithFee}() reverts when called by not a claimer`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc.connect(signer1)[mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.feeApprovalPayload, defaultData.userSignature)
          ).to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount').withArgs(signer1);
        });

        it(`${mint.mintWithFee}() reverts when mint amount equals fee`, async function () {
          const defaultData = await mint.defaultData();
          await stakedLbtc.connect(operator).setMintFee(defaultData.amount);
          const feeApprovalPayload = getPayloadForAction([defaultData.amount, snapshotTimestamp + DAY], 'feeApproval');
          const userSignature = await getFeeTypedMessage(
            signer1,
            stakedLbtc.address,
            defaultData.amount,
            snapshotTimestamp + DAY
          );
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, feeApprovalPayload, userSignature)
          ).to.revertedWithCustomError(stakedLbtc, 'FeeGreaterThanAmount');
        });

        it(`${mint.mintWithFee}() reverts when approve signed by different account`, async function () {
          const defaultData = await mint.defaultData();
          const userSignature = await getFeeTypedMessage(claimer, stakedLbtc.address, 1, snapshotTimestamp + DAY);
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.feeApprovalPayload, userSignature)
          ).to.revertedWithCustomError(stakedLbtc, 'InvalidFeeApprovalSignature');
        });

        it(`${mint.mintWithFee}() reverts when fee signature doesnt match payload`, async function () {
          const defaultData = await mint.defaultData();
          const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 2, snapshotTimestamp + DAY);
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.feeApprovalPayload, userSignature))
            .to.revertedWithCustomError(stakedLbtc, 'InvalidFeeApprovalSignature');
        });
      });
    });

    describe('Batch mint', function () {
      describe('batchMint() by minter', function () {
        before(async function () {
          await snapshot.restore();
        });

        it('batchMint() minter can mint to many accounts', async function () {
          const amount1 = randomBigInt(8);
          const amount2 = randomBigInt(8);
          const amount3 = randomBigInt(8);

          const tx = await stakedLbtc
            .connect(minter)
            .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter)[
              // @ts-ignore
              'batchMint(address[],uint256[])'
            ]([signer1.address], [randomBigInt(8), randomBigInt(8)])
          ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter)[
              // @ts-ignore
              'batchMint(address[],uint256[])'
            ]([signer1.address, signer2.address], [randomBigInt(8)])
          ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(
            // @ts-ignore
            stakedLbtc.connect(signer1)['batchMint(address[],uint256[])']([signer1.address], [randomBigInt(8)])
          )
            .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1.address);
        });
      });

      describe('batchMintV1() by minter', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        let data1: { payload: any; proof: any; payloadHash: any };
        let data2: { payload: any; proof: any; payloadHash: any };
        let data3: { payload: any; proof: any; payloadHash: any };
        before(async function () {
          await snapshot.restore();
          data1 = await mintVersions[1].signPayload(signer1.address, amount1);
          data2 = await mintVersions[1].signPayload(signer2.address, amount2);
          data3 = await mintVersions[1].signPayload(signer3.address, amount3);
        });

        it('batchMintV1() anyone can mint batch of valid payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            .batchMintV1([data1.payload, data2.payload, data3.payload], [data1.proof,  data2.proof, data3.proof]);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('should fail to batch mint for free if something is wrong in a mint', async function () {
          const proofs = [...mintWithoutFee[1]];
          proofs[proofs.length - 1] = '0x';

          await expect(stakedLbtc.batchMintV1(mintWithoutFee[0], proofs)).to.be.reverted;
        });

        it('batchMintV1() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter).batchMintV1([signer1.address], [randomBigInt(8), randomBigInt(8)])
          ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
        });

        it('batchMintV1() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter)[
              // @ts-ignore
              'batchMint(address[],uint256[])'
              ]([signer1.address, signer2.address], [randomBigInt(8)])
          ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
        });

        it('batchMintV1() reverts when called by not a minter', async function () {
          await expect(
            // @ts-ignore
            stakedLbtc.connect(signer1)['batchMint(address[],uint256[])']([signer1.address], [randomBigInt(8)])
          )
            .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1.address);
        });
      });

    });
  });

  describe('Mint V1', function () {
    let mintWithoutFee: [string[], string[], any[][]] = [[], [], []];
    let mintWithFee: [string[], string[], string[], string[], any[][]] = [[], [], [], [], []];

    beforeEach(async function () {
      await snapshot.restore();
    });

    describe('Positive cases', function () {
      const args = [
        {
          name: '1 BTC',
          amount: 100_000_000n,
          recipient: () => signer2,
          msgSender: () => signer1
        },
        {
          name: '3 satoshi',
          amount: 3n,
          recipient: () => signer3,
          msgSender: () => signer2
        }
      ];

      args.forEach(async function (args, i) {
        it(`Mint ${args.name}`, async function () {
          const balanceBefore = await stakedLbtc.balanceOf(args.recipient().address);
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const data = await signDepositBtcV1Payload(
            [notary],
            [true],
            CHAIN_ID,
            args.recipient().address,
            args.amount,
            encode(['uint256'], [i + 1]), // txid
            stakedLbtc.address
          );

          await expect(stakedLbtc.connect(args.msgSender()).mintV1(data.payload, data.proof))
            .to.emit(stakedLbtc, 'Transfer')
            .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount);

          const balanceAfter = await stakedLbtc.balanceOf(args.recipient().address);
          const totalSupplyAfter = await stakedLbtc.totalSupply();

          expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);

          // mintWithoutFee[0].push(data.payload);
          // mintWithoutFee[1].push(data.proof);
          // mintWithoutFee[2].push([ethers.ZeroAddress, args.recipient().address, args.amount]);
        });

        const fees = [
          { max: args.amount, fee: args.amount - 1n },
          { max: args.amount, fee: 1n },
          { max: args.amount - 1n, fee: args.amount },
          { max: 1n, fee: args.amount }
        ];
        fees.forEach(async function ({ fee, max }, j) {
          it(`Mint ${args.name} with ${fee} satoshis fee and max fee of ${max}`, async function () {
            const userBalanceBefore = await stakedLbtc.balanceOf(args.recipient().address);
            const treasuryBalanceBefore = await stakedLbtc.balanceOf(treasury.address);
            const totalSupplyBefore = await stakedLbtc.totalSupply();

            const data = await signDepositBtcV1Payload(
              [notary],
              [true],
              CHAIN_ID,
              args.recipient().address,
              args.amount,
              encode(['uint256'], [(i + 1) * 2 + j]), // txid
              stakedLbtc.address
            );
            const userSignature = await getFeeTypedMessage(
              args.recipient(),
              stakedLbtc.address,
              fee,
              snapshotTimestamp + DAY
            );

            // set max fee
            await stakedLbtc.connect(operator).setMintFee(max);

            const approval = getPayloadForAction([fee, snapshotTimestamp + DAY], 'feeApproval');

            const appliedFee = fee < max ? fee : max;
            await expect(stakedLbtc.connect(claimer).mintV1WithFee(data.payload, data.proof, approval, userSignature))
              .to.emit(stakedLbtc, 'Transfer')
              .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount - appliedFee)
              .to.emit(stakedLbtc, 'Transfer')
              .withArgs(ethers.ZeroAddress, treasury.address, appliedFee)
              .to.emit(stakedLbtc, 'FeeCharged')
              .withArgs(appliedFee, userSignature);

            const userBalanceAfter = await stakedLbtc.balanceOf(args.recipient().address);
            const treasuryBalanceAfter = await stakedLbtc.balanceOf(treasury.address);
            const totalSupplyAfter = await stakedLbtc.totalSupply();

            expect(userBalanceAfter - userBalanceBefore).to.be.eq(args.amount - appliedFee);
            expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.eq(appliedFee);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);

            if (fee < max) {
              // use cases where max fee is not relevant
              // to later on test batMintWithFe
              mintWithFee[0].push(data.payload);
              mintWithFee[1].push(data.proof);
              mintWithFee[2].push(approval);
              mintWithFee[3].push(userSignature);
              mintWithFee[4].push([ethers.ZeroAddress, args.recipient().address, args.amount - appliedFee]);
              mintWithFee[4].push([ethers.ZeroAddress, treasury.address, appliedFee]);
            }
          });
        });
      });



      it('should do batch mint with fee', async function () {
        // set the maximum fee from args
        await stakedLbtc
          .connect(operator)
          .setMintFee(args.reduce((x, y) => (x.amount > y.amount ? x : y)).amount + 100n);

        const mintPromise = stakedLbtc
          .connect(claimer)
          .batchMintV1WithFee(mintWithFee[0], mintWithFee[1], mintWithFee[2], mintWithFee[3]);

        const transferPromises = mintWithFee[4].map(async args =>
          expect(mintPromise)
            .to.emit(stakedLbtc, 'Transfer')
            .withArgs(...args)
        );

        await mintPromise;
        await Promise.all(transferPromises);
      });

      describe('With bascule', function () {
        beforeEach(async function () {
          // set bascule
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        });

        args.forEach(function (args) {
          it(`Mint ${args.name}`, async function () {
            const balanceBefore = await stakedLbtc.balanceOf(args.recipient().address);
            const totalSupplyBefore = await stakedLbtc.totalSupply();

            const data = await signDepositBtcV1Payload(
              [notary],
              [true],
              CHAIN_ID,
              args.recipient().address,
              args.amount,
              ethers.hexlify(ethers.randomBytes(32)), // extra data, irrelevant
              stakedLbtc.address
            );

            // mint without report fails
            await expect(
              stakedLbtc.connect(args.msgSender()).mintV1(data.payload, data.proof)
            ).to.be.revertedWithCustomError(bascule, 'WithdrawalFailedValidation');

            // report deposit
            const reportId = ethers.zeroPadValue('0x01', 32);
            await expect(
              bascule.connect(reporter).reportDeposits(reportId, [
                ethers.keccak256('0x' + data.payload.slice(10)) // use legacy hash
              ])
            )
              .to.emit(bascule, 'DepositsReported')
              .withArgs(reportId, 1);

            // mint works
            await expect(stakedLbtc.connect(args.msgSender()).mintV1(data.payload, data.proof))
              .to.emit(stakedLbtc, 'Transfer')
              .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount);

            const balanceAfter = await stakedLbtc.balanceOf(args.recipient().address);
            const totalSupplyAfter = await stakedLbtc.totalSupply();

            expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);
          });
        });
      });
    });

    describe('Negative cases', function () {
      let newConsortium: Consortium;
      const defaultTxId = ethers.hexlify(ethers.randomBytes(32));
      const defaultArgs = {
        signers: () => [signer1, signer2],
        signatures: [true, true],
        threshold: 2,
        mintRecipient: () => signer1,
        signatureRecipient: () => signer1,
        mintAmount: 100_000_000n,
        signatureAmount: 100_000_000n,
        destinationContract: () => stakedLbtc.getAddress(),
        signatureDestinationContract: () => stakedLbtc.getAddress(),
        chainId: CHAIN_ID,
        signatureChainId: CHAIN_ID,
        executionChain: CHAIN_ID,
        caller: () => stakedLbtc.getAddress(),
        verifier: () => newConsortium.getAddress(),
        epoch: 1,
        txId: defaultTxId,
        signatureTxId: defaultTxId,
        interface: () => newConsortium,
        customError: 'NotEnoughSignatures',
        params: () => []
      };
      let defaultProof: string;
      let defaultPayload: string;

      beforeEach(async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<Consortium>('Consortium', [owner.address]);
        const valset = getPayloadForAction([1, [signer1.publicKey, signer2.publicKey], [1, 1], 2, 1], NEW_VALSET);
        await newConsortium.connect(owner).setInitialValidatorSet(valset);
        const data = await signDepositBtcV1Payload(
          defaultArgs.signers(),
          defaultArgs.signatures,
          defaultArgs.signatureChainId,
          defaultArgs.signatureRecipient().address,
          defaultArgs.signatureAmount,
          defaultArgs.signatureTxId,
          stakedLbtc.address
        );
        defaultProof = data.proof;
        defaultPayload = data.payload;

        await stakedLbtc.connect(owner).changeConsortium(await newConsortium.getAddress());
      });

      const args = [
        {
          ...defaultArgs,
          name: 'not enough signatures',
          signatures: [true, false],
          customError: 'NotEnoughSignatures'
        },
        {
          ...defaultArgs,
          name: 'executed in wrong chain',
          customError: 'WrongChainId',
          chainId: 1,
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'destination chain missmatch',
          signatureChainId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'recipient is 0 address',
          mintRecipient: () => {
            return { address: ethers.ZeroAddress };
          },
          signatureRecipient: () => {
            return { address: ethers.ZeroAddress };
          },
          customError: 'Actions_ZeroAddress',
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'extra data signature mismatch',
          signatureTxId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'extra data mismatch',
          txId: ethers.randomBytes(32)
        },
        {
          ...defaultArgs,
          name: 'amount is 0',
          mintAmount: 0,
          signatureAmount: 0,
          customError: 'ZeroAmount',
          interface: () => stakedLbtc
        },
        {
          ...defaultArgs,
          name: 'Wrong signature recipient',
          signatureRecipient: () => signer2
        },
        {
          ...defaultArgs,
          name: 'Wrong mint recipient',
          mintRecipient: () => signer2
        },
        {
          ...defaultArgs,
          name: 'Wrong amount',
          mintAmount: 1
        },
        {
          ...defaultArgs,
          name: 'unknown validator set',
          signers: () => [signer1, owner],
          customError: 'NotEnoughSignatures'
        },
        {
          ...defaultArgs,
          name: 'wrong amount of signatures',
          signers: () => [signer1],
          signatures: [true],
          customError: 'LengthMismatch'
        }
      ];
      args.forEach(function (args) {
        it(`Reverts when ${args.name}`, async function () {
          const data = await signDepositBtcV1Payload(
            args.signers(),
            args.signatures,
            args.signatureChainId,
            args.signatureRecipient().address,
            args.signatureAmount,
            args.signatureTxId,
            stakedLbtc.address
          );
          const payload = getPayloadForAction(
            [
              encode(['uint256'], [args.chainId]),
              encode(['address'], [args.mintRecipient().address]),
              args.mintAmount,
              args.txId,
              0,
              encode(['address'], [stakedLbtc.address])
            ],
            DEPOSIT_BTC_ACTION_V1
          );

          await expect(stakedLbtc.mintV1(payload, data.proof)).to.revertedWithCustomError(
            args.interface(),
            args.customError
          );
        });
      });

      it('Reverts when paused', async function () {
        await stakedLbtc.connect(owner).changePauser(owner.address);
        await stakedLbtc.connect(owner).pause();

        // try to use the same proof again
        await expect(stakedLbtc.mintV1(defaultPayload, defaultProof)).to.revertedWithCustomError(
          stakedLbtc,
          'EnforcedPause'
        );
      });

      it('Reverts when payload is already used', async function () {
        // use the payload
        await stakedLbtc.mintV1(defaultPayload, defaultProof);
        // try to use the same payload again
        await expect(stakedLbtc.mintV1(defaultPayload, defaultProof)).to.revertedWithCustomError(
          stakedLbtc,
          'PayloadAlreadyUsed'
        );

        await expect(
          stakedLbtc
            .connect(claimer)
            .mintV1WithFee(
              defaultPayload,
              defaultProof,
              getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval'),
              await getFeeTypedMessage(defaultArgs.mintRecipient(), stakedLbtc.address, 1, snapshotTimestamp + DAY)
            )
        ).to.revertedWithCustomError(stakedLbtc, 'PayloadAlreadyUsed');
      });

      describe('With fee', function () {
        it('should revert if expired', async function () {
          await expect(
            stakedLbtc.connect(claimer).mintV1WithFee(
              defaultPayload,
              defaultProof,
              getPayloadForAction([1, snapshotTimestamp], 'feeApproval'),
              await getFeeTypedMessage(
                defaultArgs.mintRecipient(),
                stakedLbtc.address,
                1,
                snapshotTimestamp // it is already passed as some txns had happen
              )
            )
          )
            .to.revertedWithCustomError(stakedLbtc, 'UserSignatureExpired')
            .withArgs(snapshotTimestamp);
        });

        it('should revert if wrong deposit btc payload type', async function () {
          let feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
          await expect(
            stakedLbtc.connect(claimer).mintV1WithFee(
              feeApprovalPayload,
              defaultProof,
              feeApprovalPayload,
              await getFeeTypedMessage(
                defaultArgs.mintRecipient(),
                stakedLbtc.address,
                1,
                snapshotTimestamp // it is already passed as some txns had happen
              )
            )
          )
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(DEPOSIT_BTC_ACTION_V1, feeApprovalPayload.slice(0, 10));
        });

        it('should revert if wrong fee approval btc payload type', async function () {
          await expect(
            stakedLbtc.connect(claimer).mintV1WithFee(
              defaultPayload,
              defaultProof,
              defaultPayload,
              await getFeeTypedMessage(
                defaultArgs.mintRecipient(),
                stakedLbtc.address,
                1,
                snapshotTimestamp // it is already passed as some txns had happen
              )
            )
          )
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(FEE_APPROVAL_ACTION, defaultPayload.slice(0, 10));
        });

        it('should revert if not claimer', async function () {
          await expect(
            stakedLbtc
              .connect(signer1)
              .mintV1WithFee(
                defaultPayload,
                defaultProof,
                getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval'),
                await getFeeTypedMessage(defaultArgs.mintRecipient(), stakedLbtc.address, 1, snapshotTimestamp + DAY)
              )
          )
            .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1);
        });

        it('should revert if fee is too much', async function () {
          // make sure current fee is not going to reduce the amount charged
          await stakedLbtc.connect(operator).setMintFee(defaultArgs.mintAmount + 10n);

          await expect(
            stakedLbtc
              .connect(claimer)
              .mintV1WithFee(
                defaultPayload,
                defaultProof,
                getPayloadForAction([defaultArgs.mintAmount, snapshotTimestamp + DAY], 'feeApproval'),
                await getFeeTypedMessage(
                  defaultArgs.mintRecipient(),
                  stakedLbtc.address,
                  defaultArgs.mintAmount,
                  snapshotTimestamp + DAY
                )
              )
          ).to.revertedWithCustomError(stakedLbtc, 'FeeGreaterThanAmount');
        });

        it('should revert if signature is not from receiver', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .mintV1WithFee(
                defaultPayload,
                defaultProof,
                getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval'),
                await getFeeTypedMessage(owner, stakedLbtc.address, 1, snapshotTimestamp + DAY)
              )
          ).to.revertedWithCustomError(stakedLbtc, 'InvalidFeeApprovalSignature');
        });

        it("should revert if fee signature doesn't match fee payload", async function () {
          await expect(
            stakedLbtc.connect(claimer).mintV1WithFee(
              defaultPayload,
              defaultProof,
              getPayloadForAction([1, snapshotTimestamp + DAY], 'feeApproval'),
              await getFeeTypedMessage(
                defaultArgs.mintRecipient(),
                stakedLbtc.address,
                2, // wrong fee
                snapshotTimestamp + DAY
              )
            )
          ).to.revertedWithCustomError(stakedLbtc, 'InvalidFeeApprovalSignature');
        });

        describe('With batch', function () {
          it('should fail to batch if something is wrong with the data', async function () {
            const proofs = [...mintWithFee[1]];
            proofs[proofs.length - 1] = '0x';
            await expect(
              stakedLbtc.connect(claimer).batchMintV1WithFee(mintWithFee[0], proofs, mintWithFee[2], mintWithFee[3])
            ).to.be.reverted;
          });

          it('should fail to batch if not claimer', async function () {
            const proofs = [...mintWithFee[1]];
            proofs[proofs.length - 1] = '0x';
            await expect(
              stakedLbtc.connect(signer1).batchMintV1WithFee(mintWithFee[0], proofs, mintWithFee[2], mintWithFee[3])
            )
              .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
              .withArgs(signer1.address);
          });

          it('should fail to batch if parameters length missmatch', async function () {
            let pop = (arg: string[]) => {
              const data = [...arg];
              data.pop();
              return data;
            };
            await expect(
              stakedLbtc
                .connect(claimer)
                .batchMintV1WithFee(pop(mintWithFee[0]), mintWithFee[0], mintWithFee[2], mintWithFee[3])
            ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
            await expect(
              stakedLbtc
                .connect(claimer)
                .batchMintV1WithFee(mintWithFee[0], pop(mintWithFee[0]), mintWithFee[2], mintWithFee[3])
            ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
            await expect(
              stakedLbtc
                .connect(claimer)
                .batchMintV1WithFee(mintWithFee[0], mintWithFee[0], pop(mintWithFee[2]), mintWithFee[3])
            ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
            await expect(
              stakedLbtc
                .connect(claimer)
                .batchMintV1WithFee(mintWithFee[0], mintWithFee[0], mintWithFee[2], pop(mintWithFee[3]))
            ).to.be.revertedWithCustomError(stakedLbtc, 'InvalidInputLength');
          });
        });
      });
    });
  });

  describe('Burn', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await stakedLbtc.connect(owner).toggleWithdrawals();
    });

    describe('Positive cases', function () {
      it('Unstake half with P2WPKH', async () => {
        const amount = 100_000_000n;
        const halfAmount = amount / 2n;
        const p2wpkh = '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03';

        const burnCommission = await stakedLbtc.getBurnCommission();

        const expectedAmountAfterFee = halfAmount - BigInt(burnCommission);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2wpkh, halfAmount))
          .to.emit(stakedLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2wpkh, expectedAmountAfterFee);
      });

      it('Unstake full with P2TR', async () => {
        const amount = 100_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        const burnCommission = await stakedLbtc.getBurnCommission();

        const expectedAmountAfterFee = amount - BigInt(burnCommission);
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(stakedLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2tr, expectedAmountAfterFee);
      });

      it('Unstake with commission', async () => {
        const amount = 100_000_000n;
        const commission = 1_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        await stakedLbtc.connect(owner).changeBurnCommission(commission);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);

        await expect(stakedLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(stakedLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2tr, amount - commission);
      });

      it('Unstake full with P2WSH', async () => {
        const amount = 100_000_000n;
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);

        // Get the burn commission
        const burnCommission = await stakedLbtc.getBurnCommission();

        // Calculate expected amount after fee
        const expectedAmountAfterFee = amount - BigInt(burnCommission);

        await expect(stakedLbtc.connect(signer1).redeem(p2wsh, amount))
          .to.emit(stakedLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2wsh, expectedAmountAfterFee);
      });
    });

    describe('Negative cases', function () {
      it('Reverts when withdrawals off', async function () {
        await stakedLbtc.connect(owner).toggleWithdrawals();
        const amount = 100_000_000n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          stakedLbtc.redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.revertedWithCustomError(stakedLbtc, 'WithdrawalsDisabled');
      });

      it('Reverts if amount is less than burn commission', async function () {
        const burnCommission = await stakedLbtc.getBurnCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountLessThanCommission);

        await expect(
          stakedLbtc.connect(signer1).redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amountLessThanCommission)
        )
          .to.be.revertedWithCustomError(stakedLbtc, 'AmountLessThanCommission')
          .withArgs(burnCommission);
      });

      it('Reverts when amount is below dust limit for P2WSH', async () => {
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        const burnCommission = await stakedLbtc.getBurnCommission();

        // Start with a very small amount
        let amount = burnCommission + 1n;
        let isAboveDust = false;

        // Incrementally increase the amount until we find the dust limit
        while (!isAboveDust) {
          amount += 1n;
          [, isAboveDust] = await stakedLbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }

        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountJustBelowDustLimit);

        await expect(stakedLbtc.connect(signer1).redeem(p2wsh, amountJustBelowDustLimit)).to.be.revertedWithCustomError(
          stakedLbtc,
          'AmountBelowDustLimit'
        );
      });

      it('Revert with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2sh, amount)).to.be.revertedWithCustomError(
          stakedLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2pkh, amount)).to.be.revertedWithCustomError(
          stakedLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2pk, amount)).to.be.revertedWithCustomError(
          stakedLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2ms, amount)).to.be.revertedWithCustomError(
          stakedLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts not enough to pay commission', async () => {
        const amount = 999_999n;
        const commission = 1_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        await stakedLbtc.connect(owner).changeBurnCommission(commission);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);

        await expect(stakedLbtc.connect(signer1).redeem(p2tr, amount))
          .to.revertedWithCustomError(stakedLbtc, 'AmountLessThanCommission')
          .withArgs(commission);
      });
    });
  });

  describe('Permit', function () {
    let timestamp: number;
    let chainId: bigint;

    before(async function () {
      const block = await ethers.provider.getBlock('latest');
      timestamp = block!.timestamp;
      chainId = (await ethers.provider.getNetwork()).chainId;
    });

    beforeEach(async function () {
      await snapshot.restore();
      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, 100_000_000n);
    });

    it('should transfer funds with permit', async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(
        stakedLbtc,
        signer1,
        signer2.address,
        10_000n,
        timestamp + 100,
        chainId,
        0
      );

      await stakedLbtc.permit(signer1.address, signer2.address, 10_000n, timestamp + 100, v, r, s);

      // check allowance
      expect(await stakedLbtc.allowance(signer1.address, signer2.address)).to.equal(10_000n);

      // check transferFrom
      await stakedLbtc.connect(signer2).transferFrom(signer1.address, signer3.address, 10_000n);
      expect(await stakedLbtc.balanceOf(signer3.address)).to.equal(10_000n);

      // check nonce is incremented
      expect(await stakedLbtc.nonces(signer1.address)).to.equal(1);
    });

    describe("fail if permit params don't match the signature", function () {
      let v: number;
      let r: string;
      let s: string;

      before(async function () {
        // generate permit signature
        const signature = await generatePermitSignature(
          stakedLbtc,
          signer1,
          signer2.address,
          10_000n,
          timestamp + 100,
          chainId,
          0
        );
        v = signature.v;
        r = signature.r;
        s = signature.s;
      });

      const params: [() => string, () => string, bigint, () => number, string][] = [
        [() => signer1.address, () => signer3.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong spender'],
        [() => signer3.address, () => signer2.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong signer'],
        [
          () => signer1.address,
          () => signer2.address,
          10_000n,
          () => timestamp + 200,
          'is sensitive to wrong deadline'
        ],
        [() => signer1.address, () => signer2.address, 1n, () => timestamp + 100, 'is sensitive to wrong value']
      ];

      params.forEach(async function ([signer, spender, value, deadline, label]) {
        it(label, async function () {
          await expect(
            stakedLbtc.permit(signer(), spender(), value, deadline(), v, r, s)
          ).to.be.revertedWithCustomError(stakedLbtc, 'ERC2612InvalidSigner');
        });
      });
    });

    describe("fail if signature don't match permit params", function () {
      // generate permit signature
      const signaturesData: [() => Signer, () => string, bigint, () => number, () => bigint, number, string][] = [
        [
          () => signer3,
          () => signer2.address,
          10_000n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong signer'
        ],
        [
          () => signer1,
          () => signer3.address,
          10_000n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong spender'
        ],
        [
          () => signer1,
          () => signer2.address,
          1n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong value'
        ],
        [
          () => signer1,
          () => signer2.address,
          10_000n,
          () => timestamp + 1,
          () => chainId,
          0,
          'is sensitive to wrong deadline'
        ],
        [
          () => signer1,
          () => signer2.address,
          10_000n,
          () => timestamp + 100,
          () => 1234n,
          0,
          'is sensitive to wrong chainId'
        ],
        [
          () => signer1,
          () => signer2.address,
          1n,
          () => timestamp + 100,
          () => chainId,
          1,
          'is sensitive to wrong nonce'
        ]
      ];
      signaturesData.forEach(async ([signer, spender, value, deadline, chainId, nonce, label]) => {
        it(label, async () => {
          const { v, r, s } = await generatePermitSignature(
            stakedLbtc,
            signer(),
            spender(),
            value,
            deadline(),
            chainId(),
            nonce
          );
          await expect(
            stakedLbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s)
          ).to.be.revertedWithCustomError(stakedLbtc, 'ERC2612InvalidSigner');
        });
      });
    });
  });

  describe('Swap', function () {
    let swapRouter: SwapRouter;
    let nativeLbtc: NativeLBTC;
    let nativeLbtcBytes32: BytesLike;
    let stakedLbtcBytes32: BytesLike;
    let swapSnapshot: SnapshotRestorer;
    let nonce: bigint;
    const nativeLBTCName = ethers.keccak256(ethers.toUtf8Bytes('NativeLBTC'));

    const CHAIN1 = encode(['uint256'], [12345]);
    const CHAIN2 = encode(['uint256'], [777]);
    const RND_CHAIN = encode(['uint256'], [randomBigInt(8)]);
    const stakedLbtcBytes1 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const stakedLbtcBytes2 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const nativeLbtcBytes1 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const nativeLbtcBytes2 = encode(['address'], [ethers.Wallet.createRandom().address]);

    before(async function () {
      swapRouter = await deployContract('SwapRouter', [owner.address]);
      const { lbtc } = await initNativeLBTC(1, treasury.address, owner.address);
      nativeLbtc = lbtc;
      await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), owner);

      nativeLbtcBytes32 = encode(['address'], [await nativeLbtc.getAddress()]);
      stakedLbtcBytes32 = encode(['address'], [stakedLbtc.address]);
      swapSnapshot = await takeSnapshot();
    });

    describe('Base flow', function () {
      const AMOUNT = 1_000_000n;

      beforeEach(async function () {
        await swapSnapshot.restore();
        nonce = 1n;

        // set swap router
        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);

        // give mint permission
        await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), stakedLbtc);
        // mint tokens
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, AMOUNT);
        await nativeLbtc.connect(owner).mint(signer1, AMOUNT);
      });

      it('should swap to native', async () => {
        // set StakedLBTC => NativeLBTC
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes32, CHAIN_ID, nativeLbtcBytes32, CHAIN_ID);

        const recipient = encode(['address'], [signer2.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signSwapRequestPayload(
          [notary],
          [false],
          nonce++,
          recipient,
          AMOUNT,
          stakedLbtcBytes32,
          nativeLbtcBytes32,
          CHAIN_ID,
          CHAIN_ID
        );
        // no need to approve
        await expect(stakedLbtc.connect(signer1).swapToNative(CHAIN_ID, recipient, AMOUNT))
          .to.emit(stakedLbtc, 'SwapRequest')
          .withArgs(signer1, recipient, stakedLbtc, AMOUNT, expectedRequestPayload)
          .and.emit(stakedLbtc, 'Transfer') // burn StakedLBTC from sender
          .withArgs(signer1, ethers.ZeroAddress, AMOUNT);

        const { payload: receiptPayload, proof } = await signSwapReceiptPayload(
          [notary],
          [true],
          requestPayloadHash,
          recipient,
          AMOUNT,
          stakedLbtcBytes32,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.finishSwap(receiptPayload, proof))
          .to.emit(stakedLbtc, 'SwapFinished')
          .withArgs(signer2, nativeLbtc, AMOUNT)
          .and.emit(nativeLbtc, 'Transfer') // mint tokens
          .withArgs(ethers.ZeroAddress, stakedLbtc, AMOUNT)
          .and.emit(nativeLbtc, 'Transfer') // transfer to recipient
          .withArgs(stakedLbtc, signer2, AMOUNT);
      });

      it('should swap from native', async () => {
        // set NativeLBTC => StakedLBTC
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes32, CHAIN_ID, stakedLbtcBytes32, CHAIN_ID);

        // set named token
        await swapRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

        const recipient = encode(['address'], [signer3.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signSwapRequestPayload(
          [notary],
          [false],
          nonce++,
          recipient,
          AMOUNT,
          nativeLbtcBytes32,
          stakedLbtcBytes32,
          CHAIN_ID,
          CHAIN_ID
        );
        await nativeLbtc.connect(signer1).approve(stakedLbtc, AMOUNT);
        await expect(stakedLbtc.connect(signer1).swapFromNative(CHAIN_ID, recipient, AMOUNT))
          .to.emit(stakedLbtc, 'SwapRequest')
          .withArgs(signer1, recipient, nativeLbtc, AMOUNT, expectedRequestPayload)
          .and.emit(nativeLbtc, 'Transfer') // swap tokens from sender
          .withArgs(signer1, stakedLbtc, AMOUNT)
          .and.emit(nativeLbtc, 'Transfer')
          .withArgs(stakedLbtc, ethers.ZeroAddress, AMOUNT); // finally burn

        const { payload: receiptPayload, proof } = await signSwapReceiptPayload(
          [notary],
          [true],
          requestPayloadHash,
          recipient,
          AMOUNT,
          nativeLbtcBytes32,
          stakedLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.finishSwap(receiptPayload, proof))
          .to.emit(stakedLbtc, 'SwapFinished')
          .withArgs(signer3, stakedLbtc, AMOUNT)
          .and.emit(stakedLbtc, 'Transfer') // mint to stakedLbtc
          .withArgs(ethers.ZeroAddress, stakedLbtc, AMOUNT)
          .and.emit(stakedLbtc, 'Transfer') // transfer to recipient
          .withArgs(stakedLbtc, signer3, AMOUNT);
      });
    });

    describe('Swap', function () {
      before(async function () {
        await swapSnapshot.restore();
        nonce = 1n;

        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes2, CHAIN2);
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes1, CHAIN1);
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes2, CHAIN2);
        await swapRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, 100n * e8);
        await nativeLbtc.connect(owner).mint(signer1, 100n * e8);
      });

      const args = [
        {
          name: 'chain1',
          tolChainId: CHAIN1,
          toTokenNative: nativeLbtcBytes1,
          toTokenStaked: stakedLbtcBytes1
        },
        {
          name: 'chain2',
          tolChainId: CHAIN2,
          toTokenNative: nativeLbtcBytes2,
          toTokenStaked: stakedLbtcBytes2
        }
      ];
      args.forEach(function (arg) {
        it(`to native ${arg.name}`, async function () {
          const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
          const amount = randomBigInt(8);
          const { payload: expectedRequestPayload } = await signSwapRequestPayload(
            [notary],
            [false],
            nonce++,
            recipient,
            amount,
            stakedLbtcBytes32,
            arg.toTokenNative,
            CHAIN_ID,
            arg.tolChainId
          );

          const tx = stakedLbtc.connect(signer1).swapToNative(arg.tolChainId, recipient, amount);
          await expect(tx)
            .to.emit(stakedLbtc, 'SwapRequest')
            .withArgs(signer1, recipient, stakedLbtc, amount, expectedRequestPayload);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(signer1, ethers.ZeroAddress, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, -amount);
        });

        it(`to staked ${arg.name}`, async function () {
          const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
          const amount = randomBigInt(8);
          const { payload: expectedRequestPayload } = await signSwapRequestPayload(
            [notary],
            [false],
            nonce++,
            recipient,
            amount,
            nativeLbtcBytes32,
            arg.toTokenStaked,
            CHAIN_ID,
            arg.tolChainId
          );

          await nativeLbtc.connect(signer1).approve(stakedLbtc, amount);
          const tx = stakedLbtc.connect(signer1).swapFromNative(arg.tolChainId, recipient, amount);
          await expect(tx)
            .to.emit(stakedLbtc, 'SwapRequest')
            .withArgs(signer1, recipient, nativeLbtc, amount, expectedRequestPayload);
          await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(stakedLbtc, ethers.ZeroAddress, amount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, signer1, -amount);
        });
      });

      const invalidArgs = [
        {
          name: 'amount is 0',
          tolChainId: CHAIN1,
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: 0n,
          error: 'Swap_ZeroAmount'
        },
        {
          name: 'destination chain is unknown',
          tolChainId: encode(['uint256'], [54321]),
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          error: 'SwapNotAllowed'
        },
        {
          name: 'recipient is 0',
          tolChainId: CHAIN1,
          recipient: encode(['address'], [ethers.ZeroAddress]),
          amount: randomBigInt(8),
          error: 'Swap_ZeroRecipient'
        }
      ];
      invalidArgs.forEach(function (arg) {
        it(`swapToNative reverts when ${arg.name}`, async function () {
          await expect(
            stakedLbtc.connect(signer1).swapToNative(arg.tolChainId, arg.recipient, arg.amount)
          ).to.revertedWithCustomError(stakedLbtc, arg.error);
        });

        it(`swapFromNative reverts when ${arg.name}`, async function () {
          await nativeLbtc.connect(signer1).approve(stakedLbtc, arg.amount);
          await expect(
            stakedLbtc.connect(signer1).swapFromNative(arg.tolChainId, arg.recipient, arg.amount)
          ).to.revertedWithCustomError(stakedLbtc, arg.error);
        });
      });

      it('swapToNative reverts when named token is not set', async function () {
        await swapSnapshot.restore();
        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes1, CHAIN1);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await expect(
          stakedLbtc.connect(signer1).swapFromNative(CHAIN1, recipient, amount)
        ).to.be.revertedWithCustomError(swapRouter, 'EnumerableMapNonexistentKey');
      });

      //TODO: what is the expected error?
      it('swapToNative reverts when router is not set', async function () {
        await stakedLbtc.connect(owner).changeSwapRouter(ethers.ZeroAddress);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await stakedLbtc.connect(signer1).swapToNative(CHAIN1, recipient, amount);
      });
    });

    describe('Finish swap', function () {
      before(async function () {
        await swapSnapshot.restore();
        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes1, CHAIN1, stakedLbtcBytes32, CHAIN_ID);
        await swapRouter.connect(owner).setRoute(nativeLbtcBytes2, CHAIN2, stakedLbtcBytes32, CHAIN_ID);
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes1, CHAIN1, nativeLbtcBytes32, CHAIN_ID);
        await swapRouter.connect(owner).setRoute(stakedLbtcBytes2, CHAIN2, nativeLbtcBytes32, CHAIN_ID);
        await swapRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

        await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), stakedLbtc);
      });

      const args = [
        {
          name: 'chain1',
          fromChainId: CHAIN1,
          fromTokenStaked: stakedLbtcBytes1,
          fromTokenNative: nativeLbtcBytes1
        },
        {
          name: 'chain2',
          fromChainId: CHAIN2,
          fromTokenStaked: stakedLbtcBytes2,
          fromTokenNative: nativeLbtcBytes2
        }
      ];
      args.forEach(function (arg) {
        it(`to native from ${arg.name}`, async function () {
          const recipient = ethers.Wallet.createRandom().address;
          const recipientBytes = encode(['address'], [recipient]);
          const amount = randomBigInt(8);
          const { payloadHash } = await signSwapRequestPayload(
            [notary],
            [false],
            randomBigInt(8),
            recipientBytes,
            amount,
            arg.fromTokenStaked,
            nativeLbtcBytes32,
            arg.fromChainId,
            CHAIN_ID
          );

          const { payload, proof } = await signSwapReceiptPayload(
            [notary],
            [true],
            payloadHash,
            recipientBytes,
            amount,
            arg.fromTokenStaked,
            nativeLbtcBytes32,
            CHAIN_ID
          );

          const tx = await stakedLbtc.connect(signer1).finishSwap(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'SwapFinished').withArgs(recipient, nativeLbtc, amount);
          await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, stakedLbtc, amount);
          await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(stakedLbtc, recipient, amount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount);
        });

        it(`to staked from ${arg.name}`, async function () {
          const recipient = ethers.Wallet.createRandom().address;
          const recipientBytes = encode(['address'], [recipient]);
          const amount = randomBigInt(8);
          const { payloadHash } = await signSwapRequestPayload(
            [notary],
            [false],
            randomBigInt(8),
            recipientBytes,
            amount,
            arg.fromTokenNative,
            stakedLbtcBytes32,
            arg.fromChainId,
            CHAIN_ID
          );

          const { payload, proof } = await signSwapReceiptPayload(
            [notary],
            [true],
            payloadHash,
            recipientBytes,
            amount,
            arg.fromTokenNative,
            stakedLbtcBytes32,
            CHAIN_ID
          );

          const tx = await stakedLbtc.connect(signer1).finishSwap(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'SwapFinished').withArgs(recipient, stakedLbtc, amount);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, stakedLbtc, amount);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(stakedLbtc, recipient, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
        });
      });

      const invalidArgs = [
        {
          name: 'hash is 0',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          // @ts-ignore
          hashModifier: hash => '0x' + Buffer.from(new Uint8Array(32)).toString('hex'),
          error: 'Swap_ZeroRequestHash',
          args: []
        },
        {
          name: 'recipient is 0 address',
          recipient: encode(['address'], [ethers.ZeroAddress]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroRecipient',
          args: []
        },
        {
          name: 'recipient is invalid address',
          recipient: '0x' + Buffer.from(ethers.randomBytes(32)).toString('hex'),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_InvalidRecipient',
          args: []
        },
        {
          name: 'amount is 0',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: 0n,
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroAmount',
          args: []
        },
        {
          name: 'from token is 0 address',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => encode(['address'], [ethers.ZeroAddress]),
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroFromToken',
          args: []
        },
        //TODO: fix
        {
          name: 'from unknown token to staked',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes2,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroRecipient',
          args: []
        },
        //TODO: fix
        {
          name: 'from unknown token to native',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => stakedLbtcBytes2,
          toToken: () => nativeLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroRecipient',
          args: []
        },
        //TODO: fix
        {
          name: 'from unsupported chain',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: RND_CHAIN,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ZeroRecipient',
          args: []
        },
        {
          name: 'to unknown token',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes1,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'SwapNotAllowed',
          args: []
        },
        {
          name: 'to token is invalid address',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => '0x' + Buffer.from(ethers.randomBytes(32)).toString('hex'),
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'Swap_InvalidToToken',
          args: []
        },
        {
          name: 'destination chain is different',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN2,
          hashModifier: (hash: string) => hash,
          error: 'Swap_ChainIdMismatch',
          args: [CHAIN_ID, CHAIN2]
        }
      ];

      invalidArgs.forEach(function (arg) {
        it(`finishSwap reverts when ${arg.name}`, async function () {
          const { payloadHash } = await signSwapRequestPayload(
            [notary],
            [false],
            randomBigInt(8),
            arg.recipient,
            arg.amount,
            arg.fromToken(),
            arg.toToken(),
            arg.fromChain,
            arg.toChain
          );

          const requestPayloadHash = arg.hashModifier(payloadHash);
          const { payload, proof } = await signSwapReceiptPayload(
            [notary],
            [true],
            requestPayloadHash,
            arg.recipient,
            arg.amount,
            arg.fromToken(),
            arg.toToken(),
            arg.toChain
          );

          // await stakedLbtc.connect(signer1).finishSwap(payload, proof);

          await expect(stakedLbtc.connect(signer1).finishSwap(payload, proof))
            .to.revertedWithCustomError(stakedLbtc, arg.error)
            .withArgs(...arg.args);
        });
      });

      it('finishSwap reverts when payload has been used', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signSwapRequestPayload(
          [notary],
          [false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signSwapReceiptPayload(
          [notary],
          [true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await stakedLbtc.connect(signer1).finishSwap(payload, proof);
        await expect(stakedLbtc.connect(signer1).finishSwap(payload, proof)).to.be.revertedWithCustomError(
          stakedLbtc,
          'PayloadAlreadyUsed'
        );
      });

      it('finishSwap reverts when payload prefix is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signSwapRequestPayload(
          [notary],
          [false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signSwapReceiptPayload(
          [notary],
          [true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );
        const modifiedPayload = payload.replace(SWAP_RECEIPT_SELECTOR, SWAP_REQUEST_SELECTOR);

        await expect(stakedLbtc.connect(signer1).finishSwap(modifiedPayload, proof))
          .to.be.revertedWithCustomError(stakedLbtc, 'Swap_InvalidSelector')
          .withArgs(SWAP_RECEIPT_SELECTOR, SWAP_REQUEST_SELECTOR);
      });

      it('finishSwap reverts when payload size is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payload, proof } = await signSwapRequestPayload(
          [notary],
          [false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        await expect(stakedLbtc.connect(signer1).finishSwap(payload, proof))
          .to.be.revertedWithCustomError(stakedLbtc, 'Swap_InvalidPayloadSize')
          .withArgs(192, 228);
      });

      it('finishSwap reverts when proof is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signSwapRequestPayload(
          [notary],
          [false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signSwapReceiptPayload(
          [signer1],
          [true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.connect(signer1).finishSwap(payload, proof)).to.be.revertedWithCustomError(
          consortium,
          'NotEnoughSignatures'
        );
      });
    });

    describe('Set up swap router', function () {
      beforeEach(async function () {
        await swapSnapshot.restore();
      });

      it('Initial swap router is 0 address', async function () {
        expect(await stakedLbtc.swapRouter()).to.be.eq(ethers.ZeroAddress);
      });

      it('Owner can change', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeSwapRouter(newRouter))
          .to.emit(stakedLbtc, 'SwapRouterChanged')
          .withArgs(ethers.ZeroAddress, newRouter);

        expect(await stakedLbtc.swapRouter()).to.be.eq(newRouter);
      });

      it('Owner can change again', async function () {
        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);

        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeSwapRouter(newRouter))
          .to.emit(stakedLbtc, 'SwapRouterChanged')
          .withArgs(await swapRouter.getAddress(), newRouter);

        expect(await stakedLbtc.swapRouter()).to.be.eq(newRouter);
      });

      it('Owner can change to 0 address', async function () {
        await stakedLbtc.connect(owner).changeSwapRouter(swapRouter);

        const newRouter = ethers.ZeroAddress;
        await expect(stakedLbtc.connect(owner).changeSwapRouter(newRouter))
          .to.emit(stakedLbtc, 'SwapRouterChanged')
          .withArgs(await swapRouter.getAddress(), newRouter);

        expect(await stakedLbtc.swapRouter()).to.be.eq(newRouter);
      });

      it('Reverts when called by not an owner', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(signer1).changeSwapRouter(newRouter))
          .to.be.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });
    });
  });
});
