import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
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
  signStakingReceiptPayload,
  signStakingOperationRequestPayload,
  buildRedeemRequestPayload,
  STAKING_RECEIPT_SELECTOR,
  STAKING_REQUEST_SELECTOR,
} from './helpers';
import { Bascule, Consortium, NativeLBTC, StakedLBTC, StakingRouter } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';

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

class DefaultData {
  payload: string;
  payloadHash: string;
  proof: string;
  amount: bigint | undefined;
  recipient: Signer | undefined;
  feeApprovalPayload: string | undefined;
  userSignature: string | undefined;
  constructor(payload: string, payloadHash: string, proof: string) {
    this.payload = payload;
    this.payloadHash = payloadHash;
    this.proof = proof;
  }
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
    notary1: Signer,
    notary2: Signer,
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
    [_, owner, treasury, minter, claimer, operator, pauser, reporter, notary1, notary2, signer1, signer2, signer3] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(getPayloadForAction([1, [notary1.publicKey, notary2.publicKey], [1, 1], 2, 1], NEW_VALSET));

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

    bascule = await deployContract<Bascule>('Bascule', [owner.address, pauser.address, reporter.address, stakedLbtc.address, 100], false);

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
        await expect(stakedLbtc.connect(owner).pause()).to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount').withArgs(owner.address);
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
        await expect(stakedLbtc.connect(owner).toggleWithdrawals()).to.emit(stakedLbtc, 'WithdrawalsEnabled').withArgs(true);
      });

      it('toggleWithdrawals() owner can disable', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals()).to.emit(stakedLbtc, 'WithdrawalsEnabled').withArgs(false);
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
          await expect(stakedLbtc.connect(owner)[role.setter](newRole)).to.emit(stakedLbtc, role.event).withArgs(newRole.address, true);
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
          await expect(stakedLbtc.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(stakedLbtc, 'ZeroAddress');
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
          name: 'StakingRouter',
          setter: 'changeStakingRouter',
          getter: 'StakingRouter',
          event: 'StakingRouterChanged',
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
            await expect(stakedLbtc.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(stakedLbtc, 'ZeroAddress');
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

    describe('Name and symbol', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('changeNameAndSymbol() owner can rename token', async function () {
        const newName = 'NewName';
        const newSymbol = 'NewSymbol';
        const tx = await stakedLbtc.connect(owner).changeNameAndSymbol(newName, newSymbol);
        await expect(tx).to.emit(stakedLbtc, 'NameAndSymbolChanged').withArgs(newName, newSymbol);

        expect(await stakedLbtc.name()).to.be.eq(newName);
        expect(await stakedLbtc.symbol()).to.be.eq(newSymbol);
      });

      it('changeNameAndSymbol() reverts when called by not an owner', async function () {
        const newName = 'NewName';
        const newSymbol = 'NewSymbol';
        await expect(stakedLbtc.connect(signer1).changeNameAndSymbol(newName, newSymbol))
          .to.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
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
        signPayload: async (
          signers: Signer[],
          sigs: boolean[],
          toChain: string,
          recipient: string,
          amount: bigint,
          txId: string,
          vout: bigint = 0n,
          tokenAddress: string = stakedLbtc.address
        ) => await signDepositBtcV0Payload(signers, sigs, toChain, recipient, amount, txId, vout),
        defaultData: async function (recipient: Signer = signer1, amount: bigint = randomBigInt(8), feeApprove: bigint = 1n) {
          const defaultData = (await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            recipient.address,
            amount,
            encode(['uint256'], [randomBigInt(8)])
          )) as unknown as DefaultData;
          defaultData.amount = amount;
          defaultData.recipient = signer1;
          defaultData.feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
          defaultData.userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, feeApprove, snapshotTimestamp + DAY);
          return defaultData;
        }
      },
      {
        version: 'V1',
        mint: 'mintV1',
        mintWithFee: 'mintV1WithFee',
        payloadPrefix: DEPOSIT_BTC_ACTION_V1,
        signPayload: async (
          signers: Signer[],
          sigs: boolean[],
          toChain: string,
          recipient: string,
          amount: bigint,
          txId: string,
          vout: bigint = 0n,
          tokenAddress: string = stakedLbtc.address
        ) => await signDepositBtcV1Payload(signers, sigs, toChain, recipient, amount, txId, tokenAddress, vout),
        defaultData: async function (recipient: Signer = signer1, amount: bigint = randomBigInt(8), feeApprove: bigint = 1n) {
          const defaultData = (await signDepositBtcV1Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            recipient.address,
            amount,
            encode(['uint256'], [randomBigInt(8)]),
            stakedLbtc.address
          )) as unknown as DefaultData;
          defaultData.amount = amount;
          defaultData.recipient = signer1;
          defaultData.feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
          defaultData.userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, feeApprove, snapshotTimestamp + DAY);
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
            const { payload, payloadHash, proof } = await mint.defaultData(recipient, amount);

            // @ts-ignore
            const tx = stakedLbtc.connect(sender)[mint.mint](payload, proof);
            await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
            await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
            const totalSupplyAfter = await stakedLbtc.totalSupply();
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });

        const invalidArgs = [
          {
            name: 'not enough signatures',
            signers: () => [notary1, notary2],
            signatures: [true, false],
            chainId: CHAIN_ID,
            recipient: () => signer1.address,
            amount: randomBigInt(8),
            customError: () => [consortium, 'NotEnoughSignatures']
          },
          {
            name: 'invalid signatures',
            signers: () => [signer1, signer2],
            signatures: [true, true],
            chainId: CHAIN_ID,
            recipient: () => signer1.address,
            amount: randomBigInt(8),
            customError: () => [consortium, 'NotEnoughSignatures']
          },
          {
            name: 'invalid destination chain',
            signers: () => [notary1, notary2],
            signatures: [true, true],
            chainId: encode(['uint256'], [1]),
            recipient: () => signer1.address,
            amount: randomBigInt(8),
            customError: () => [stakedLbtc, 'WrongChainId']
          },
          {
            name: 'recipient is 0 address',
            signers: () => [notary1, notary2],
            signatures: [true, true],
            chainId: CHAIN_ID,
            recipient: () => ethers.ZeroAddress,
            amount: randomBigInt(8),
            customError: () => [stakedLbtc, 'Actions_ZeroAddress']
          },
          {
            name: 'amount is 0',
            signers: () => [notary1, notary2],
            signatures: [true, true],
            chainId: CHAIN_ID,
            recipient: () => signer1.address,
            amount: 0n,
            customError: () => [stakedLbtc, 'ZeroAmount']
          }
        ];

        it(`mint${mint.version}() when bascule enabled`, async function () {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());

          const amount = randomBigInt(8);
          const sender = signer1;
          const recipient = signer2;

          const totalSupplyBefore = await stakedLbtc.totalSupply();
          const { payload, payloadHash, proof } = await mint.defaultData(recipient, amount);

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
        });

        invalidArgs.forEach(function (arg) {
          it(`mint${mint.version}() reverts when ${arg.name}`, async function () {
            const { payload, proof } = await mint.signPayload(
              arg.signers(),
              arg.signatures,
              arg.chainId,
              arg.recipient(),
              arg.amount,
              encode(['uint256'], [randomBigInt(8)])
            );

            await expect(stakedLbtc[mint.mint](payload, proof))
              //@ts-ignore
              .to.revertedWithCustomError(...arg.customError());
          });
        });

        it(`mint${mint.version}() reverts when not reported to bascule`, async function () {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof)).to.be.revertedWithCustomError(
            bascule,
            'WithdrawalFailedValidation'
          );
        });

        it(`mint${mint.version}() reverts when payload has been used`, async function () {
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof);
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof)).to.be.revertedWithCustomError(
            stakedLbtc,
            'PayloadAlreadyUsed'
          );
        });

        it(`mint${mint.version}() reverts when paused`, async function () {
          await stakedLbtc.connect(pauser).pause();
          const defaultData = await mint.defaultData();
          // @ts-ignore
          await expect(stakedLbtc.connect(signer1)[mint.mint](defaultData.payload, defaultData.proof)).to.be.revertedWithCustomError(
            stakedLbtc,
            'EnforcedPause'
          );
        });
      });

      it('mintV0 reverts when payload type is invalid', async function () {
        const { payload, proof } = await mintVersions[1].defaultData();
        await expect(stakedLbtc['mint(bytes,bytes)'](payload, proof))
          .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
          .withArgs(mintVersions[0].payloadPrefix, mintVersions[1].payloadPrefix);
      });

      it('mintV1 reverts when payload type is invalid', async function () {
        const { payload, proof } = await mintVersions[0].defaultData();
        await expect(stakedLbtc.mintV1(payload, proof))
          .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
          .withArgs(mintVersions[1].payloadPrefix, mintVersions[0].payloadPrefix);
      });

      it('mintV1 reverts token address is invalid', async function () {
        const invalidTokenAddress = ethers.Wallet.createRandom().address;
        const { payload, proof } = await mintVersions[1].signPayload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          randomBigInt(8),
          encode(['uint256'], [randomBigInt(8)]),
          0n,
          invalidTokenAddress
        );
        await expect(stakedLbtc.mintV1(payload, proof))
          .to.revertedWithCustomError(stakedLbtc, 'InvalidDestinationToken')
          .withArgs(stakedLbtc.address, invalidTokenAddress);
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
            },
            {
              name: 'approved is 1sat but max is 0',
              approved: 1n,
              max: 0n
            }
          ];

          fees.forEach(function (fee) {
            it(`${mint.mintWithFee}() ${fee.name} and ${arg.name}`, async function () {
              const amount = arg.amount;
              const recipient = arg.recipient();
              const totalSupplyBefore = await stakedLbtc.totalSupply();
              const { payload, payloadHash, proof, feeApprovalPayload, userSignature } = await mint.defaultData(
                recipient,
                amount,
                fee.approved
              );

              // Set fee and approve
              await stakedLbtc.connect(operator).setMintFee(fee.max);
              const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;

              // @ts-ignore
              const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, feeApprovalPayload, userSignature);
              await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
              await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
              await expect(tx)
                .to.emit(stakedLbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
              if (appliedFee > 0n) {
                await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
              }
              await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
              await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
              const totalSupplyAfter = await stakedLbtc.totalSupply();
              expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
            });
          });
        });

        it(`${mint.mintWithFee}() can use fee approve many times until it expired`, async function () {
          const recipient = signer1;
          const feeApproved = randomBigInt(2);
          const feeMax = randomBigInt(2);
          const userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, feeApproved, snapshotTimestamp + DAY);
          const feeApprovalPayload = getPayloadForAction([feeApproved, snapshotTimestamp + DAY], 'feeApproval');
          await stakedLbtc.connect(operator).setMintFee(feeMax);
          const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

          for (let i = 0; i < 10; i++) {
            await time.increase(3600);
            const amount = randomBigInt(8);
            const { payload, payloadHash, proof } = await mint.defaultData(recipient, amount);
            // @ts-ignore
            const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, feeApprovalPayload, userSignature);
            await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
          }
        });

        it(`${mint.mintWithFee}() when bascule enabled`, async function () {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          // new
          const feeApproved = randomBigInt(2);
          const feeMax = randomBigInt(2);
          await stakedLbtc.connect(operator).setMintFee(feeMax);
          const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

          const amount = randomBigInt(8);
          const recipient = signer1;
          const { payload, payloadHash, proof, feeApprovalPayload, userSignature } = await mint.defaultData(recipient, amount, feeApproved);

          // report deposit
          const reportId = ethers.zeroPadValue('0x01', 32);
          await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))]))
            .to.emit(bascule, 'DepositsReported')
            .withArgs(reportId, 1);

          // @ts-ignore
          const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, feeApprovalPayload, userSignature);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
          await expect(tx)
            .to.emit(stakedLbtc, 'Transfer')
            .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });

        it(`${mint.mintWithFee}() reverts when approve has expired`, async function () {
          const defaultData = await mint.defaultData();
          const feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
          const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 1, snapshotTimestamp);
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, feeApprovalPayload, userSignature)
          )
            .to.revertedWithCustomError(stakedLbtc, 'UserSignatureExpired')
            .withArgs(snapshotTimestamp);
        });

        it(`${mint.mintWithFee}() reverts when mint payload type is invalid`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc
              .connect(claimer)
              [
                mint.mintWithFee
              ](defaultData.feeApprovalPayload, defaultData.userSignature, defaultData.feeApprovalPayload, defaultData.userSignature)
          )
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(mint.payloadPrefix, FEE_APPROVAL_ACTION);
        });

        it(`${mint.mintWithFee}() reverts when fee payload type is invalid`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc
              .connect(claimer)
              [mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.payload, defaultData.userSignature)
          )
            .to.revertedWithCustomError(stakedLbtc, 'InvalidAction')
            .withArgs(FEE_APPROVAL_ACTION, mint.payloadPrefix);
        });

        it(`${mint.mintWithFee}() reverts when called by not a claimer`, async function () {
          const defaultData = await mint.defaultData();
          await expect(
            // @ts-ignore
            stakedLbtc
              .connect(signer1)
              [mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.feeApprovalPayload, defaultData.userSignature)
          )
            .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1);
        });

        it(`${mint.mintWithFee}() reverts when mint amount equals fee`, async function () {
          const defaultData = await mint.defaultData();
          await stakedLbtc.connect(operator).setMintFee(defaultData.amount);
          const feeApprovalPayload = getPayloadForAction([defaultData.amount, snapshotTimestamp + DAY], 'feeApproval');
          const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, defaultData.amount, snapshotTimestamp + DAY);
          await expect(
            // @ts-ignore
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, feeApprovalPayload, userSignature)
          ).to.revertedWithCustomError(stakedLbtc, 'FeeGreaterThanAmount');
        });

        it(`${mint.mintWithFee}() reverts when fee approve signed by other account`, async function () {
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
            stakedLbtc.connect(claimer)[mint.mintWithFee](defaultData.payload, defaultData.proof, defaultData.feeApprovalPayload, userSignature)
          ).to.revertedWithCustomError(stakedLbtc, 'InvalidFeeApprovalSignature');
        });
      });
    });

    describe('Batch mint', function () {
      describe('batchMint() mints to listed addresses', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        before(async function () {
          await snapshot.restore();
        });

        it('batchMint() minter can mint to many accounts', async function () {
          const tx = await stakedLbtc
            .connect(minter)
            .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(stakedLbtc.connect(minter).batchMint([signer1.address], [amount1, amount2])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(stakedLbtc.connect(minter).batchMint([signer1.address, signer2.address], [amount1])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(stakedLbtc.connect(signer1).batchMint([signer1.address], [amount1]))
            .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1.address);
        });

        it('batchMint() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc.connect(minter).batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3])
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });

      describe('batchMintV1() mints from batch of payloads', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        let data1: DefaultData, data2: DefaultData, data3: DefaultData;
        beforeEach(async function () {
          await snapshot.restore();
          data1 = await mintVersions[1].defaultData(signer1, amount1);
          data2 = await mintVersions[1].defaultData(signer2, amount2);
          data3 = await mintVersions[1].defaultData(signer3, amount3);
        });

        it('batchMintV1() anyone can mint batch of valid payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            .batchMintV1([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMintV1() skips used payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            .batchMintV1([data1.payload, data1.payload, data2.payload, data2.payload], [data1.proof, data1.proof, data2.proof, data2.proof]);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1, amount2]);
        });

        it('batchMintV1() reverts if failed to mint any payload', async function () {
          const invalidData = await mintVersions[0].defaultData(signer3, amount3);
          await expect(
            stakedLbtc
              .connect(signer1)
              .batchMintV1([data1.payload, data2.payload, invalidData.payload], [data1.proof, data2.proof, invalidData.proof])
          ).to.be.reverted;
        });

        it('batchMintV1() reverts when there is less payloads than proofs', async function () {
          await expect(stakedLbtc.connect(signer1).batchMintV1([data1.payload], [data1.proof, data2.proof])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMintV1() reverts when there is more payloads than proofs', async function () {
          await expect(stakedLbtc.connect(signer1).batchMintV1([data1.payload, data2.payload], [data1.proof])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMintV1() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(signer1)
              .batchMintV1([data1.payload, data1.payload, data2.payload, data2.payload], [data1.proof, data1.proof, data2.proof, data2.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });

      describe('batchMintV1WithFee', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        let maxFee: bigint;
        let data1: DefaultData, data2: DefaultData, data3: DefaultData;
        beforeEach(async function () {
          await snapshot.restore();
          maxFee = randomBigInt(2);
          await stakedLbtc.connect(operator).setMintFee(maxFee);
          data1 = await mintVersions[1].defaultData(signer1, amount1, maxFee + 1n);
          data2 = await mintVersions[1].defaultData(signer2, amount2, maxFee + 1n);
          data3 = await mintVersions[1].defaultData(signer3, amount3, maxFee + 1n);
        });

        it('batchMintV1WithFee() claimer can mint many payloads with fee', async function () {
          const tx = await stakedLbtc
            .connect(claimer)
            .batchMintV1WithFee(
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            );
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(maxFee, data3.userSignature);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1 - maxFee, amount2 - maxFee, amount3 - maxFee]);
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 3n);
        });

        it('batchMintV1WithFee() skips used payloads', async function () {
          const tx = await stakedLbtc
            .connect(claimer)
            .batchMintV1WithFee(
              [data1.payload, data1.payload, data2.payload, data2.payload],
              [data1.proof, data1.proof, data2.proof, data2.proof],
              [data1.feeApprovalPayload, data1.feeApprovalPayload, data2.feeApprovalPayload, data2.feeApprovalPayload],
              [data1.userSignature, data1.userSignature, data2.userSignature, data2.userSignature]
            );
          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);

          await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1 - maxFee, amount2 - maxFee]);
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 2n);
        });

        it('batchMintV1WithFee() reverts if failed to mint any payload', async function () {
          const invalidData = await mintVersions[0].defaultData(signer3, amount3);
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, invalidData.payload],
                [data1.proof, data2.proof, invalidData.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, invalidData.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, invalidData.userSignature]
              )
          ).to.be.reverted;
        });

        it('batchMintV1WithFee() reverts when there is less payloads than other entities', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less proofs than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less fee approvals than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less user fee signatures than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when called by not a claimer', async function () {
          await expect(
            stakedLbtc
              .connect(signer1)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          )
            .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1);
        });

        it('batchMintV1WithFee() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintV1WithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });
    });
  });

  describe('Unstake', function () {
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

        const { payload: expectedPayload } = buildRedeemRequestPayload(expectedAmountAfterFee, 1, p2wpkh);

        await expect(stakedLbtc.connect(signer1).redeem(p2wpkh, halfAmount))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1.address, p2wpkh, stakedLbtc, halfAmount, expectedPayload);
      });

      it('Unstake full with P2TR', async () => {
        const amount = 100_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        const burnCommission = await stakedLbtc.getBurnCommission();

        const expectedAmountAfterFee = amount - BigInt(burnCommission);
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        const { payload: expectedPayload } = buildRedeemRequestPayload(expectedAmountAfterFee, 1, p2tr);
        await expect(stakedLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1.address, p2tr, stakedLbtc, amount, expectedPayload);
      });

      it('Unstake with commission', async () => {
        const amount = 100_000_000n;
        const commission = 1_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        await stakedLbtc.connect(owner).changeBurnCommission(commission);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);

        const { payload: expectedPayload } = buildRedeemRequestPayload(amount - commission, 1, p2tr);

        await expect(stakedLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1.address, p2tr, stakedLbtc,amount, expectedPayload);
      });

      it('Unstake full with P2WSH', async () => {
        const amount = 100_000_000n;
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);

        // Get the burn commission
        const burnCommission = await stakedLbtc.getBurnCommission();

        // Calculate expected amount after fee
        const expectedAmountAfterFee = amount - BigInt(burnCommission);

        const { payload: expectedPayload } = buildRedeemRequestPayload(expectedAmountAfterFee, 1, p2wsh);

        await expect(stakedLbtc.connect(signer1).redeem(p2wsh, amount))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1.address, p2wsh, stakedLbtc, amount, expectedPayload);
      });
    });

    describe('Negative cases', function () {
      it('redeem() reverts when withdrawals are off', async function () {
        await stakedLbtc.connect(owner).toggleWithdrawals();
        const amount = 100_000_000n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)).to.revertedWithCustomError(
          stakedLbtc,
          'WithdrawalsDisabled'
        );
      });

      it('redeem() reverts if amount is less than burn commission', async function () {
        const burnCommission = await stakedLbtc.getBurnCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountLessThanCommission);

        await expect(stakedLbtc.connect(signer1).redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amountLessThanCommission))
          .to.be.revertedWithCustomError(stakedLbtc, 'AmountLessThanCommission')
          .withArgs(burnCommission);
      });

      it('redeem() reverts when amount is below dust limit for P2WSH', async () => {
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

      it('redeem() reverts with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2sh, amount)).to.be.revertedWithCustomError(stakedLbtc, 'ScriptPubkeyUnsupported');
      });

      it('redeem() reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2pkh, amount)).to.be.revertedWithCustomError(stakedLbtc, 'ScriptPubkeyUnsupported');
      });

      it('redeem() reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2pk, amount)).to.be.revertedWithCustomError(stakedLbtc, 'ScriptPubkeyUnsupported');
      });

      it('redeem() reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeem(p2ms, amount)).to.be.revertedWithCustomError(stakedLbtc, 'ScriptPubkeyUnsupported');
      });

      it('redeem() reverts when not enough to pay commission', async () => {
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
      const { v, r, s } = await generatePermitSignature(stakedLbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);

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
        const signature = await generatePermitSignature(stakedLbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);
        v = signature.v;
        r = signature.r;
        s = signature.s;
      });

      const params: [() => string, () => string, bigint, () => number, string][] = [
        [() => signer1.address, () => signer3.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong spender'],
        [() => signer3.address, () => signer2.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong signer'],
        [() => signer1.address, () => signer2.address, 10_000n, () => timestamp + 200, 'is sensitive to wrong deadline'],
        [() => signer1.address, () => signer2.address, 1n, () => timestamp + 100, 'is sensitive to wrong value']
      ];

      params.forEach(async function ([signer, spender, value, deadline, label]) {
        it(label, async function () {
          await expect(stakedLbtc.permit(signer(), spender(), value, deadline(), v, r, s)).to.be.revertedWithCustomError(
            stakedLbtc,
            'ERC2612InvalidSigner'
          );
        });
      });
    });

    describe("fail if signature don't match permit params", function () {
      // generate permit signature
      const signaturesData: [() => Signer, () => string, bigint, () => number, () => bigint, number, string][] = [
        [() => signer3, () => signer2.address, 10_000n, () => timestamp + 100, () => chainId, 0, 'is sensitive to wrong signer'],
        [() => signer1, () => signer3.address, 10_000n, () => timestamp + 100, () => chainId, 0, 'is sensitive to wrong spender'],
        [() => signer1, () => signer2.address, 1n, () => timestamp + 100, () => chainId, 0, 'is sensitive to wrong value'],
        [() => signer1, () => signer2.address, 10_000n, () => timestamp + 1, () => chainId, 0, 'is sensitive to wrong deadline'],
        [() => signer1, () => signer2.address, 10_000n, () => timestamp + 100, () => 1234n, 0, 'is sensitive to wrong chainId'],
        [() => signer1, () => signer2.address, 1n, () => timestamp + 100, () => chainId, 1, 'is sensitive to wrong nonce']
      ];
      signaturesData.forEach(async ([signer, spender, value, deadline, chainId, nonce, label]) => {
        it(label, async () => {
          const { v, r, s } = await generatePermitSignature(stakedLbtc, signer(), spender(), value, deadline(), chainId(), nonce);
          await expect(stakedLbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s)).to.be.revertedWithCustomError(
            stakedLbtc,
            'ERC2612InvalidSigner'
          );
        });
      });
    });
  });

  describe('Staking', function () {
    let StakingRouter: StakingRouter;
    let nativeLbtc: NativeLBTC;
    let nativeLbtcBytes32: BytesLike;
    let stakedLbtcBytes32: BytesLike;
    let StakingSnapshot: SnapshotRestorer;
    let nonce: bigint;
    const nativeLBTCName = ethers.keccak256(ethers.toUtf8Bytes('NativeLBTC'));

    const CHAIN1 = encode(['uint256'], [12345]);
    const CHAIN2 = encode(['uint256'], [777]);
    const RND_CHAIN = encode(['uint256'], [randomBigInt(8)]);
    const stakedLbtcBytes1 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const stakedLbtcBytes2 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const stakedLbtcBytes3 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const nativeLbtcBytes1 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const nativeLbtcBytes2 = encode(['address'], [ethers.Wallet.createRandom().address]);
    const nativeLbtcBytes3 = encode(['address'], [ethers.Wallet.createRandom().address]);

    before(async function () {
      StakingRouter = await deployContract('StakingRouter', [owner.address]);
      const { lbtc } = await initNativeLBTC(1, treasury.address, owner.address);
      nativeLbtc = lbtc;
      await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), owner);

      nativeLbtcBytes32 = encode(['address'], [await nativeLbtc.getAddress()]);
      stakedLbtcBytes32 = encode(['address'], [stakedLbtc.address]);
      StakingSnapshot = await takeSnapshot();
    });

    describe('Base flow', function () {
      const AMOUNT = 1_000_000n;

      beforeEach(async function () {
        await StakingSnapshot.restore();
        nonce = 1n;

        // set Staking router
        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);

        // give mint permission
        await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), stakedLbtc);
        // mint tokens
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, AMOUNT);
        await nativeLbtc.connect(owner).mint(signer1, AMOUNT);
      });

      it('should Unstake (to native)', async () => {
        // set StakedLBTC => NativeLBTC
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes32, CHAIN_ID, nativeLbtcBytes32, CHAIN_ID);

        const recipient = encode(['address'], [signer2.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          nonce++,
          recipient,
          AMOUNT,
          stakedLbtcBytes32,
          nativeLbtcBytes32,
          CHAIN_ID,
          CHAIN_ID
        );
        // no need to approve
        await expect(stakedLbtc.connect(signer1).startUnstake(CHAIN_ID, recipient, AMOUNT))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1, recipient, stakedLbtc, AMOUNT, expectedRequestPayload)
          .and.emit(stakedLbtc, 'Transfer') // burn StakedLBTC from sender
          .withArgs(signer1, ethers.ZeroAddress, AMOUNT);

        const { payload: receiptPayload, proof } = await signStakingReceiptPayload(
          [notary1, notary2],
          [true, true],
          requestPayloadHash,
          recipient,
          AMOUNT,
          stakedLbtcBytes32,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.finalizeStakingOperation(receiptPayload, proof))
          .to.emit(stakedLbtc, 'StakingOperationCompleted')
          .withArgs(signer2, nativeLbtc, AMOUNT)
          .and.emit(nativeLbtc, 'Transfer') // mint tokens
          .withArgs(ethers.ZeroAddress, signer2, AMOUNT)
      });

      it('should Stake (from native)', async () => {
        // set NativeLBTC => StakedLBTC
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes32, CHAIN_ID, stakedLbtcBytes32, CHAIN_ID);

        // set named token
        await StakingRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

        const recipient = encode(['address'], [signer3.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          nonce++,
          recipient,
          AMOUNT,
          nativeLbtcBytes32,
          stakedLbtcBytes32,
          CHAIN_ID,
          CHAIN_ID
        );
        await nativeLbtc.connect(signer1).approve(stakedLbtc, AMOUNT);
        await expect(stakedLbtc.connect(signer1).startStake(CHAIN_ID, recipient, AMOUNT))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1, recipient, nativeLbtc, AMOUNT, expectedRequestPayload)
          .and.emit(nativeLbtc, 'Transfer') // Staking tokens from sender
          .withArgs(signer1, stakedLbtc, AMOUNT)
          .and.emit(nativeLbtc, 'Transfer')
          .withArgs(stakedLbtc, ethers.ZeroAddress, AMOUNT); // finally burn

        const { payload: receiptPayload, proof } = await signStakingReceiptPayload(
          [notary1, notary2],
          [true, true],
          requestPayloadHash,
          recipient,
          AMOUNT,
          nativeLbtcBytes32,
          stakedLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.finalizeStakingOperation(receiptPayload, proof))
          .to.emit(stakedLbtc, 'StakingOperationCompleted')
          .withArgs(signer3, stakedLbtc, AMOUNT)
          .and.emit(stakedLbtc, 'Transfer') // mint to recipient
          .withArgs(ethers.ZeroAddress, signer3, AMOUNT)
      });
    });

    describe('Staking', function () {
      before(async function () {
        await StakingSnapshot.restore();
        nonce = 1n;

        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes2, CHAIN2);
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes1, CHAIN1);
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes2, CHAIN2);
        await StakingRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

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
          const { payload: expectedRequestPayload } = await signStakingOperationRequestPayload(
            [notary1, notary2],
            [false, false],
            nonce++,
            recipient,
            amount,
            stakedLbtcBytes32,
            arg.toTokenNative,
            CHAIN_ID,
            arg.tolChainId
          );

          const tx = stakedLbtc.connect(signer1).startUnstake(arg.tolChainId, recipient, amount);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationRequested').withArgs(signer1, recipient, stakedLbtc, amount, expectedRequestPayload);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(signer1, ethers.ZeroAddress, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, -amount);
        });

        it(`to staked ${arg.name}`, async function () {
          const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
          const amount = randomBigInt(8);
          const { payload: expectedRequestPayload } = await signStakingOperationRequestPayload(
            [notary1, notary2],
            [false, false],
            nonce++,
            recipient,
            amount,
            nativeLbtcBytes32,
            arg.toTokenStaked,
            CHAIN_ID,
            arg.tolChainId
          );

          await nativeLbtc.connect(signer1).approve(stakedLbtc, amount);
          const tx = stakedLbtc.connect(signer1).startStake(arg.tolChainId, recipient, amount);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationRequested').withArgs(signer1, recipient, nativeLbtc, amount, expectedRequestPayload);
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
          error: 'Staking_ZeroAmount'
        },
        {
          name: 'destination chain is unknown',
          tolChainId: encode(['uint256'], [54321]),
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          error: 'StakingNotAllowed'
        },
        {
          name: 'recipient is 0',
          tolChainId: CHAIN1,
          recipient: encode(['address'], [ethers.ZeroAddress]),
          amount: randomBigInt(8),
          error: 'Staking_ZeroRecipient'
        }
      ];
      invalidArgs.forEach(function (arg) {
        it(`Unstake reverts when ${arg.name}`, async function () {
          await expect(stakedLbtc.connect(signer1).startUnstake(arg.tolChainId, arg.recipient, arg.amount)).to.revertedWithCustomError(
            stakedLbtc,
            arg.error
          );
        });

        it(`Stake reverts when ${arg.name}`, async function () {
          await nativeLbtc.connect(signer1).approve(stakedLbtc, arg.amount);
          await expect(stakedLbtc.connect(signer1).startStake(arg.tolChainId, arg.recipient, arg.amount)).to.revertedWithCustomError(
            stakedLbtc,
            arg.error
          );
        });
      });

      it('startStake reverts when named token is not set', async function () {
        await StakingSnapshot.restore();
        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes32, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes32, RND_CHAIN, stakedLbtcBytes1, CHAIN1);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await expect(stakedLbtc.connect(signer1).startStake(CHAIN1, recipient, amount)).to.be.revertedWithCustomError(
          StakingRouter,
          'EnumerableMapNonexistentKey'
        );
      });

      //TODO: what is the expected error?
      it('startUnstake reverts when router is not set', async function () {
        await stakedLbtc.connect(owner).changeStakingRouter(ethers.ZeroAddress);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await expect(stakedLbtc.connect(signer1).startUnstake(CHAIN1, recipient, amount)).to.be.revertedWithoutReason();
      });
    });

    describe('Finalize Staking operation', function () {
      before(async function () {
        await StakingSnapshot.restore();
        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes1, CHAIN1, stakedLbtcBytes32, CHAIN_ID);
        await StakingRouter.connect(owner).setRoute(nativeLbtcBytes2, CHAIN2, stakedLbtcBytes32, CHAIN_ID);
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes1, CHAIN1, nativeLbtcBytes32, CHAIN_ID);
        await StakingRouter.connect(owner).setRoute(stakedLbtcBytes2, CHAIN2, nativeLbtcBytes32, CHAIN_ID);
        await StakingRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLbtc);

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
          const { payloadHash } = await signStakingOperationRequestPayload(
            [notary1, notary2],
            [false, false],
            randomBigInt(8),
            recipientBytes,
            amount,
            arg.fromTokenStaked,
            nativeLbtcBytes32,
            arg.fromChainId,
            CHAIN_ID
          );

          const { payload, proof } = await signStakingReceiptPayload(
            [notary1, notary2],
            [true, true],
            payloadHash,
            recipientBytes,
            amount,
            arg.fromTokenStaked,
            nativeLbtcBytes32,
            CHAIN_ID
          );

          const tx = await stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationCompleted').withArgs(recipient, nativeLbtc, amount);
          await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount);
        });

        it(`to staked from ${arg.name}`, async function () {
          const recipient = ethers.Wallet.createRandom().address;
          const recipientBytes = encode(['address'], [recipient]);
          const amount = randomBigInt(8);
          const { payloadHash } = await signStakingOperationRequestPayload(
            [notary1, notary2],
            [false, false],
            randomBigInt(8),
            recipientBytes,
            amount,
            arg.fromTokenNative,
            stakedLbtcBytes32,
            arg.fromChainId,
            CHAIN_ID
          );

          const { payload, proof } = await signStakingReceiptPayload(
            [notary1, notary2],
            [true, true],
            payloadHash,
            recipientBytes,
            amount,
            arg.fromTokenNative,
            stakedLbtcBytes32,
            CHAIN_ID
          );

          const tx = await stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationCompleted').withArgs(recipient, stakedLbtc, amount);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
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
          error: 'Staking_ZeroRequestHash',
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
          error: 'Staking_ZeroRecipient',
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
          error: 'Staking_InvalidRecipient',
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
          error: 'Staking_ZeroAmount',
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
          error: 'Staking_ZeroFromToken',
          args: []
        },
        {
          name: 'from unknown token to staked',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes3,
          toToken: () => stakedLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'StakingNotAllowed',
          args: []
        },
        {
          name: 'from unknown token to native',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => stakedLbtcBytes3,
          toToken: () => nativeLbtcBytes32,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'StakingNotAllowed',
          args: []
        },
        // //TODO: fix
        // {
        //   name: 'from unsupported chain',
        //   recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
        //   amount: randomBigInt(8),
        //   fromToken: () => nativeLbtcBytes1,
        //   toToken: () => stakedLbtcBytes32,
        //   fromChain: RND_CHAIN,
        //   toChain: CHAIN_ID,
        //   hashModifier: (hash: string) => hash,
        //   error: 'Staking_ZeroRecipient',
        //   args: []
        // },
        {
          name: 'to unknown token',
          recipient: encode(['address'], [ethers.Wallet.createRandom().address]),
          amount: randomBigInt(8),
          fromToken: () => nativeLbtcBytes1,
          toToken: () => stakedLbtcBytes1,
          fromChain: CHAIN1,
          toChain: CHAIN_ID,
          hashModifier: (hash: string) => hash,
          error: 'StakingNotAllowed',
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
          error: 'Staking_InvalidToToken',
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
          error: 'Staking_ChainIdMismatch',
          args: [CHAIN_ID, CHAIN2]
        }
      ];

      invalidArgs.forEach(function (arg) {
        it(`finishStaking reverts when ${arg.name}`, async function () {
          const { payloadHash } = await signStakingOperationRequestPayload(
            [notary1, notary2],
            [false, false],
            randomBigInt(8),
            arg.recipient,
            arg.amount,
            arg.fromToken(),
            arg.toToken(),
            arg.fromChain,
            arg.toChain
          );

          const requestPayloadHash = arg.hashModifier(payloadHash);
          const { payload, proof } = await signStakingReceiptPayload(
            [notary1, notary2],
            [true, true],
            requestPayloadHash,
            arg.recipient,
            arg.amount,
            arg.fromToken(),
            arg.toToken(),
            arg.toChain
          );

          // await stakedLbtc.connect(signer1).finishStaking(payload, proof);

          await expect(stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof))
            .to.revertedWithCustomError(stakedLbtc, arg.error)
            .withArgs(...arg.args);
        });
      });

      it('finishStaking reverts when payload has been used', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signStakingReceiptPayload(
          [notary1, notary2],
          [true, true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof);
        await expect(stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof)).to.be.revertedWithCustomError(stakedLbtc, 'PayloadAlreadyUsed');
      });

      it('finishStaking reverts when payload prefix is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signStakingReceiptPayload(
          [notary1, notary2],
          [true, true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );
        const modifiedPayload = payload.replace(STAKING_RECEIPT_SELECTOR, STAKING_REQUEST_SELECTOR);

        await expect(stakedLbtc.connect(signer1).finalizeStakingOperation(modifiedPayload, proof))
          .to.be.revertedWithCustomError(stakedLbtc, 'Staking_InvalidSelector')
          .withArgs(STAKING_RECEIPT_SELECTOR, STAKING_REQUEST_SELECTOR);
      });

      it('finishStaking reverts when payload size is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payload, proof } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        await expect(stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof))
          .to.be.revertedWithCustomError(stakedLbtc, 'Staking_InvalidPayloadSize')
          .withArgs(196, 292);
      });

      it('finishStaking reverts when proof is invalid', async function () {
        const recipient = ethers.Wallet.createRandom().address;
        const recipientBytes = encode(['address'], [recipient]);
        const amount = randomBigInt(8);
        const { payloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          randomBigInt(8),
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN1,
          CHAIN_ID
        );

        const { payload, proof } = await signStakingReceiptPayload(
          [notary1, signer2],
          [true, true],
          payloadHash,
          recipientBytes,
          amount,
          stakedLbtcBytes1,
          nativeLbtcBytes32,
          CHAIN_ID
        );

        await expect(stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof)).to.be.revertedWithCustomError(consortium, 'NotEnoughSignatures');
      });
    });

    describe('Set up Staking router', function () {
      beforeEach(async function () {
        await StakingSnapshot.restore();
      });

      it('Initial Staking router is 0 address', async function () {
        expect(await stakedLbtc.StakingRouter()).to.be.eq(ethers.ZeroAddress);
      });

      it('Owner can change', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeStakingRouter(newRouter))
          .to.emit(stakedLbtc, 'StakingRouterChanged')
          .withArgs(ethers.ZeroAddress, newRouter);

        expect(await stakedLbtc.StakingRouter()).to.be.eq(newRouter);
      });

      it('Owner can change again', async function () {
        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);

        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeStakingRouter(newRouter))
          .to.emit(stakedLbtc, 'StakingRouterChanged')
          .withArgs(await StakingRouter.getAddress(), newRouter);

        expect(await stakedLbtc.StakingRouter()).to.be.eq(newRouter);
      });

      it('Owner can change to 0 address', async function () {
        await stakedLbtc.connect(owner).changeStakingRouter(StakingRouter);

        const newRouter = ethers.ZeroAddress;
        await expect(stakedLbtc.connect(owner).changeStakingRouter(newRouter))
          .to.emit(stakedLbtc, 'StakingRouterChanged')
          .withArgs(await StakingRouter.getAddress(), newRouter);

        expect(await stakedLbtc.StakingRouter()).to.be.eq(newRouter);
      });

      it('Reverts when called by not an owner', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(signer1).changeStakingRouter(newRouter))
          .to.be.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });
    });
  });
});
