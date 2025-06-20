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
  RELEASE_SELECTOR, getGMPPayload, signPayload, REDEEM_REQUEST_SELECTOR, GMP_V1_SELECTOR, UNSTAKE_REQUEST_SELECTOR
} from './helpers';
import { Bascule, Consortium, Mailbox, NativeLBTC, RatioFeedMock, StakedLBTC, AssetRouter } from '../typechain-types';
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

const BITCOIN_CHAIN_ID: string = encode(['uint256'], ["0xff0000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"]);
const BITCOIN_NAITIVE_COIN: string = encode(['uint256'], ["0x00000000000000000000000000000000000001"]);
const LEDGER_CHAIN_ID: string = encode(['uint256'], ["0x112233445566778899000000"]);
const LEDGER_SENDER: string = encode(['uint256'], ["0x0089e3e4e7a699d6f131d893aeef7ee143706ac23a"]);
const LEDGER_CALLER: string = encode(['uint256'], [0n]);
const LEDGER_MAILBOX: string = encode(['uint256'], ["0x222233445566778899000000"]);

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
  let stakedLbtcBytes: string;
  let nativeLBTC: NativeLBTC & Addressable;
  let nativeLbtcBytes: string;
  let bascule: Bascule;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let consortium: Consortium & Addressable;
  const toNativeCommission = 1000;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let stakingRouterBytes: string;

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
      0n,
      treasury.address,
      owner.address
    ]);
    stakedLbtc.address = await stakedLbtc.getAddress();
    stakedLbtcBytes = encode(['address'], [stakedLbtc.address]);

    nativeLBTC = await deployContract<NativeLBTC & Addressable>('NativeLBTC', [
      await consortium.getAddress(),
      0n,
      treasury.address,
      owner.address,
      0n //owner delay
    ]);
    nativeLBTC.address = await nativeLBTC.getAddress();
    nativeLbtcBytes = encode(['address'], [nativeLBTC.address]);

    // Minter
    await stakedLbtc.connect(owner).addMinter(minter.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.MINTER_ROLE(), minter);
    // Claimer
    await stakedLbtc.connect(owner).addClaimer(claimer.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.CLAIMER_ROLE(), claimer);
    // Operator
    await stakedLbtc.connect(owner).changeOperator(operator.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.OPERATOR_ROLE(), operator);
    // Pauser
    await stakedLbtc.connect(owner).changePauser(pauser.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.PAUSER_ROLE(), pauser);
    // Initialize permit module
    await stakedLbtc.connect(owner).reinitialize();
    await stakedLbtc.connect(owner).toggleWithdrawals();

    bascule = await deployContract<Bascule>('Bascule', [owner.address, pauser.address, reporter.address, stakedLbtc.address, 100], false);

    // Mailbox
    mailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    mailbox.address = await mailbox.getAddress();
    await mailbox.connect(owner).grantRole(await mailbox.TREASURER_ROLE(), treasury);
    await mailbox.connect(owner).grantRole(await mailbox.PAUSER_ROLE(), pauser);
    const { chainId } = await ethers.provider.getNetwork();
    await mailbox.connect(owner).enableMessagePath(LEDGER_CHAIN_ID, LEDGER_MAILBOX);

    // Ratio feed
    ratioFeed = (await ethers.deployContract('RatioFeedMock', [])) as RatioFeedMock & Addressable;
    ratioFeed.address = await ratioFeed.getAddress();

    // AssetRouter
    assetRouter = await deployContract<AssetRouter & Addressable>('AssetRouter', [owner.address, 0n, LEDGER_CHAIN_ID, BITCOIN_CHAIN_ID, mailbox.address, ratioFeed.address, ethers.ZeroAddress, toNativeCommission]);
    assetRouter.address = await assetRouter.getAddress();
    stakingRouterBytes = encode(['address'], [assetRouter.address]);
    await assetRouter.connect(owner).setRoute(BITCOIN_NAITIVE_COIN, BITCOIN_CHAIN_ID, stakedLbtcBytes, false, CHAIN_ID);
    await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NAITIVE_COIN, true, BITCOIN_CHAIN_ID);
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);
    // await assetRouter.connect(owner).setNamedToken(namedToken, stakedLbtc.address);
    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 500, true);
    // const check = await stakingRouter.connect(owner).
    await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await stakedLbtc.connect(owner).addMinter(assetRouter.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.MINTER_ROLE(), assetRouter.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  async function defaultData (recipient: Signer = signer1, amount: bigint = randomBigInt(8), feeApprove: bigint = 1n) : Promise<DefaultData> {
    const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [recipient.address]), amount], RELEASE_SELECTOR);
    const payload = getGMPPayload(
      LEDGER_MAILBOX,
      LEDGER_CHAIN_ID,
      CHAIN_ID,
      Number(randomBigInt(8)),
      LEDGER_SENDER,
      stakingRouterBytes,
      stakingRouterBytes,
      body
    );
    const { payloadHash, proof } = await signPayload([notary1, notary2], [true, true], payload)
    const feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
    const userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, feeApprove, snapshotTimestamp + DAY);
    return {
      payload,
      payloadHash,
      proof,
      amount,
      recipient,
      feeApprovalPayload,
      userSignature
    } as DefaultData
  }

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

      it('toggleWithdrawals() owner can disable', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals()).to.emit(stakedLbtc, 'WithdrawalsEnabled').withArgs(false);
      });

      it('toggleWithdrawals() owner can enable', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals()).to.emit(stakedLbtc, 'WithdrawalsEnabled').withArgs(true);
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
          name: 'AssetRouter',
          setter: 'changeAssetRouter',
          getter: 'AssetRouter',
          event: 'AssetRouterChanged',
          defaultAccount: () => assetRouter.address,
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
        //TODO: move to assetRouter
        // {
        //   name: 'MintFee',
        //   setter: 'setMintFee',
        //   getter: 'getMintFee',
        //   event: 'FeeChanged',
        //   account: 'operator',
        //   accessError: 'UnauthorizedAccount',
        //   canBeZero: true
        // },
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

    describe('Anyone can mint with valid payload', function() {
      args.forEach(function (arg) {
        it(`mint() ${arg.name}`, async function () {
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const recipient = arg.recipient().address;
          const amount = arg.amount;
          const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [arg.recipient().address]), amount], RELEASE_SELECTOR);
          const payload = getGMPPayload(
            LEDGER_MAILBOX,
            LEDGER_CHAIN_ID,
            CHAIN_ID,
            Number(randomBigInt(8)),
            LEDGER_SENDER,
            stakingRouterBytes,
            stakingRouterBytes,
            body
          );
          const { payloadHash, proof } = await signPayload([notary1, notary2], [true, true], payload);

          const sender = arg.msgSender();
          // @ts-ignore
          const tx = await stakedLbtc.connect(sender)['mint(bytes,bytes)'](payload, proof);
          const receipt = await tx.wait();
          // for (const log of receipt.logs) {
          //   try {
          //     const parsedLog = mailbox.interface.parseLog(log);
          //     console.log('Event Name:', parsedLog.name);
          //     console.log('Event Args:', parsedLog.args);
          //   } catch (error) {
          //   }
          // }
          // TODO: unique event?
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });
      });

      it(`mint() when bascule is enabled`, async function () {
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        const recipient = signer2;
        const amount = randomBigInt(8);
        const { payload, proof } = await defaultData(recipient, amount);

        // report deposit
        // TODO what payload to report??
        const reportId = ethers.zeroPadValue('0x01', 32);
        await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))]))
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);

        // @ts-ignore
        const tx = stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
        await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
        const totalSupplyAfter = await stakedLbtc.totalSupply();
        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
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
          customError: () => [mailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'recipient is 0 address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => ethers.ZeroAddress,
          amount: randomBigInt(8),
          customError: () => [assetRouter, 'AssetRouter_MintProcessingError']
        },
        {
          name: 'amount is 0',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: 0n,
          customError: () => [assetRouter, 'AssetRouter_MintProcessingError']
        }
      ];

      invalidArgs.forEach(function (arg) {
        it(`mint() reverts when ${arg.name}`, async function () {
          const recipient = arg.recipient();
          const amount = arg.amount;
          const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [recipient]), amount], RELEASE_SELECTOR);
          const payload = getGMPPayload(
            LEDGER_MAILBOX,
            LEDGER_CHAIN_ID,
            arg.chainId,
            Number(randomBigInt(8)),
            LEDGER_SENDER,
            stakingRouterBytes,
            stakingRouterBytes,
            body
          );
          const { payloadHash, proof } = await signPayload(arg.signers(), arg.signatures, payload);

          if (arg.customError != undefined) {
            await expect(stakedLbtc['mint(bytes,bytes)'](payload, proof))
              //@ts-ignore
              .to.revertedWithCustomError(...arg.customError());
          } else {
            //TODO: it is here to debug only. Each case must be reverted
            await stakedLbtc['mint(bytes,bytes)'](payload, proof);
          }
        });
      });

      //TODO: BASCULE DOES NOT CHECK DEPOSITS WHEN ENABLED
      it(`mint() reverts when not reported to bascule`, async function () {
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());

        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        // @ts-ignore
        // await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payloadHash, proof)).to.be.revertedWithCustomError(
        //   bascule,
        //   'WithdrawalFailedValidation'
        // );
      });

      it(`mint() reverts when payload has been used`, async function () {
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        // @ts-ignore
        await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof, { gasLimit: 500_000n }))
          .to.be.revertedWithCustomError(assetRouter, 'AssetRouter_MintProcessingError');
      });

      it(`mint() reverts when paused`, async function () {
        await stakedLbtc.connect(pauser).pause();
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof)).to.be.revertedWithCustomError(
          assetRouter,
          'AssetRouter_MintProcessingError'
        );
      });
    })

    describe('Claimer can mint with fee', function() {
      beforeEach(async function () {
        await snapshot.restore();
      });

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
          it(`mintWithFee() ${fee.name} and ${arg.name}`, async function () {
            const totalSupplyBefore = await stakedLbtc.totalSupply();
            const recipient = arg.recipient();
            const amount = arg.amount;
            const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [recipient.address]), amount], RELEASE_SELECTOR);
            const payload = getGMPPayload(
              LEDGER_MAILBOX,
              LEDGER_CHAIN_ID,
              CHAIN_ID,
              Number(randomBigInt(8)),
              LEDGER_SENDER,
              stakingRouterBytes,
              stakingRouterBytes,
              body
            );
            const { payloadHash, proof } = await signPayload([notary1, notary2], [true, true], payload)

            // Set fee and approve
            await assetRouter.connect(operator).setMintFee(fee.max);
            const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;
            const feeApprovalPayload = getPayloadForAction([fee.approved, snapshotTimestamp + DAY], 'feeApproval');
            const userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, fee.approved, snapshotTimestamp + DAY);

            // @ts-ignore
            const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
            // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
            // TODO: fix after event will be fixed
            await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient.address, amount);
            if (appliedFee > 0n) {
              await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(recipient.address, treasury.address, appliedFee);
            }
            await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
            await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
            const totalSupplyAfter = await stakedLbtc.totalSupply();
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });
      });

      it(`mintWithFee() can use fee approve many times until it expired`, async function () {
        const recipient = signer1;
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        const userSignature = await getFeeTypedMessage(recipient, stakedLbtc.address, feeApproved, snapshotTimestamp + DAY);
        const feeApprovalPayload = getPayloadForAction([feeApproved, snapshotTimestamp + DAY], 'feeApproval');
        await assetRouter.connect(operator).setMintFee(feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        for (let i = 0; i < 10; i++) {
          await time.increase(3600);
          const amount = randomBigInt(8);
          const { payload, payloadHash, proof } = await defaultData(recipient, amount);
          // @ts-ignore
          const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
        }
      });

      it(`mintWithFee() when bascule enabled`, async function () {
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        // new
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        await assetRouter.connect(operator).setMintFee(feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        const amount = randomBigInt(8);
        const recipient = signer1;
        const { payload, payloadHash, proof, feeApprovalPayload, userSignature } = await defaultData(recipient, amount, feeApproved);

        // report deposit
        const reportId = ethers.zeroPadValue('0x01', 32);
        await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))])) //From GMP
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);

        // @ts-ignore
        const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
        // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
        await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
        await expect(tx)
          .to.emit(stakedLbtc, 'Transfer')
          .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
        await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
        await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
        const totalSupplyAfter = await stakedLbtc.totalSupply();
        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
      });

      it(`mintWithFee() reverts when approve has expired`, async function () {
        const { payload, proof } = await defaultData();
        const feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
        const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 1, snapshotTimestamp);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(assetRouter, 'UserSignatureExpired')
          .withArgs(snapshotTimestamp);
      });

      it(`mintWithFee() reverts when mint payload type is invalid`, async function () {
        const { feeApprovalPayload, userSignature } = await defaultData();
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(feeApprovalPayload, userSignature, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(mailbox, 'GMP_InvalidAction')
          .withArgs(GMP_V1_SELECTOR, FEE_APPROVAL_ACTION);
      });

      it(`mintWithFee() reverts when fee payload type is invalid`, async function () {
        const { payload, proof } = await defaultData();
        await expect(
          // @ts-ignore
          stakedLbtc
            .connect(claimer)
            .mintWithFee(payload, proof, payload, proof)
        )
          .to.revertedWithCustomError(assetRouter, 'InvalidAction')
          .withArgs(FEE_APPROVAL_ACTION, GMP_V1_SELECTOR);
      });

      it(`mintWithFee() reverts when called by not a claimer`, async function () {
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData();
        // @ts-ignore
        await expect(stakedLbtc.connect(signer1).mintWithFee(payload, proof, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
          .withArgs(signer1);
      });

      it(`mintWithFee() reverts when mint amount equals fee`, async function () {
        const amount = randomBigInt(3);
        const fee = amount + 1n;
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData(signer1, amount, fee);
        await assetRouter.connect(operator).setMintFee(fee);
        //TODO: custom error?
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'AssetRouter_FeeGreaterThanAmount');
      });

      it(`mintWithFee() reverts when fee approve signed by other account`, async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(claimer, stakedLbtc.address, 1, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
      });

      it(`mintWithFee() reverts when fee signature doesnt match payload`, async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(signer1, stakedLbtc.address, 2, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
      });
    })

    describe.skip('mint with fee old', function () {
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
              await assetRouter.connect(operator).setMintFee(fee.max);
              const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;

              // @ts-ignore
              const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, feeApprovalPayload, userSignature);
              await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
              await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
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
          await assetRouter.connect(operator).setMintFee(feeMax);
          const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

          for (let i = 0; i < 10; i++) {
            await time.increase(3600);
            const amount = randomBigInt(8);
            const { payload, payloadHash, proof } = await mint.defaultData(recipient, amount);
            // @ts-ignore
            const tx = await stakedLbtc.connect(claimer)[mint.mintWithFee](payload, proof, feeApprovalPayload, userSignature);
            await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
          }
        });

        it(`${mint.mintWithFee}() when bascule enabled`, async function () {
          await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          // new
          const feeApproved = randomBigInt(2);
          const feeMax = randomBigInt(2);
          await assetRouter.connect(operator).setMintFee(feeMax);
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
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
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
          await assetRouter.connect(operator).setMintFee(defaultData.amount);
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
      describe('batchMint(address[],uint256[]) mints to listed addresses', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        before(async function () {
          await snapshot.restore();
        });

        it('batchMint() minter can mint to many accounts', async function () {
          const tx = await stakedLbtc
            .connect(minter)
            ['batchMint(address[],uint256[])']([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(stakedLbtc.connect(minter)['batchMint(address[],uint256[])']([signer1.address], [amount1, amount2])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(stakedLbtc.connect(minter)['batchMint(address[],uint256[])']([signer1.address, signer2.address], [amount1])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(stakedLbtc.connect(signer1)['batchMint(address[],uint256[])']([signer1.address], [amount1]))
            .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1.address);
        });

        it('batchMint() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc.connect(minter)['batchMint(address[],uint256[])']([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3])
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });

      describe('batchMint(bytes[],bytes[]) mints from batch of payloads', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        let data1: DefaultData, data2: DefaultData, data3: DefaultData;
        beforeEach(async function () {
          await snapshot.restore();
          data1 = await defaultData(signer1, amount1);
          data2 = await defaultData(signer2, amount2);
          data3 = await defaultData(signer3, amount3);
        });

        it('batchMint() anyone can mint batch of valid payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            ['batchMint(bytes[],bytes[])']([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() skips used payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            ['batchMint(bytes[],bytes[])']([data1.payload, data1.payload, data2.payload, data2.payload], [data1.proof, data1.proof, data2.proof, data2.proof]);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          // TODO: AssetRouter_BatchMintError
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1, amount2]);
        });

        it('batchMint() reverts if failed to mint any payload', async function () {
          const invalidData = await mintVersions[0].defaultData(signer3, amount3);
          await expect(
            stakedLbtc
              .connect(signer1)
              ['batchMint(bytes[],bytes[])']([data1.payload, data2.payload, invalidData.payload], [data1.proof, data2.proof, invalidData.proof])
          ).to.be.reverted;
        });

        it('batchMint() reverts when there is less payloads than proofs', async function () {
          await expect(stakedLbtc.connect(signer1)['batchMint(bytes[],bytes[])']([data1.payload], [data1.proof, data2.proof])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when there is more payloads than proofs', async function () {
          await expect(stakedLbtc.connect(signer1)['batchMint(bytes[],bytes[])']([data1.payload, data2.payload], [data1.proof])).to.be.revertedWithCustomError(
            stakedLbtc,
            'NonEqualLength'
          );
        });

        it('batchMint() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(signer1)
              ['batchMint(bytes[],bytes[])']([data1.payload, data2.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_MintProcessingError');
        });
      });

      describe('batchMintWithFee() mints from batch of payloads with fee being charged', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        let maxFee: bigint;
        let data1: DefaultData, data2: DefaultData, data3: DefaultData;
        beforeEach(async function () {
          await snapshot.restore();
          maxFee = randomBigInt(2);
          await assetRouter.connect(operator).setMintFee(maxFee);
          data1 = await defaultData(signer1, amount1, maxFee + 1n);
          data2 = await defaultData(signer2, amount2, maxFee + 1n);
          data3 = await defaultData(signer3, amount3, maxFee + 1n);
        });

        it('batchMintWithFee() claimer can mint many payloads with fee', async function () {
          const tx = await stakedLbtc
            .connect(claimer)
            .batchMintWithFee(
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            );
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data1.userSignature);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data2.userSignature);
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data3.userSignature);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1 - maxFee, amount2 - maxFee, amount3 - maxFee]);
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 3n);
        });

        it('batchMintWithFee() skips used payloads', async function () {
          const tx = await stakedLbtc
            .connect(claimer)
            .batchMintWithFee(
              [data1.payload, data1.payload, data2.payload, data2.payload],
              [data1.proof, data1.proof, data2.proof, data2.proof],
              [data1.feeApprovalPayload, data1.feeApprovalPayload, data2.feeApprovalPayload, data2.feeApprovalPayload],
              [data1.userSignature, data1.userSignature, data2.userSignature, data2.userSignature]
            );
          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data1.userSignature);
          // await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);

          // await expect(tx).to.emit(stakedLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data2.userSignature);
          // TODO: fix
          // await expect(tx).to.emit(stakedLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1 - maxFee, amount2 - maxFee]);
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 2n);
        });

        it('batchMintWithFee() reverts if failed to mint any payload', async function () {
          const invalidData = await mintVersions[0].defaultData(signer3, amount3);
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                [data1.payload, data2.payload, invalidData.payload],
                [data1.proof, data2.proof, invalidData.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, invalidData.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, invalidData.userSignature]
              )
          ).to.be.reverted;
        });

        it('batchMintWithFee() reverts when there is less payloads than other entities', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                [data1.payload, data2.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less proofs than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less fee approvals than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less user fee signatures than payloads', async function () {
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature]
              )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when called by not a claimer', async function () {
          await expect(
            stakedLbtc
              .connect(signer1)
              .batchMintWithFee(
                //@ts-ignore
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          )
            .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1);
        });

        it('batchMintWithFee() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(claimer)
              .batchMintWithFee(
                //@ts-ignore
                [data1.payload, data2.payload, data3.payload],
                [data1.proof, data2.proof, data3.proof],
                [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
                [data1.userSignature, data2.userSignature, data3.userSignature]
              )
          ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_MintProcessingError');
        });
      });
    });
  });

  describe('Redeem BTC', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    const args = [
      {
        name: 'partial p2wpkh',
        pubkey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
        balance: randomBigInt(8),
        amount: (balance: bigint) : bigint => balance / 2n
      },
      {
        name: 'all p2wpkh',
        pubkey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
        balance: randomBigInt(8),
        amount: (balance: bigint) : bigint => balance
      },
      {
        name: 'all P2TR',
        pubkey: '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947',
        balance: randomBigInt(8),
        amount: (balance: bigint) : bigint => balance
      },
      {
        name: 'all P2WSH',
        pubkey: '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3',
        balance: randomBigInt(8),
        amount: (balance: bigint) : bigint => balance
      }
    ]

    describe('Positive cases', function () {
      args.forEach(function(arg) {
        it(`redeemForBtc() ${arg.name}`, async () => {
          const balance = arg.balance;
          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, balance);
          const amount = arg.amount(balance);
          const pubScript = arg.pubkey;

          const burnCommission = await assetRouter.getToNativeCommission();
          const expectedAmountAfterFee = amount - burnCommission;
          console.log(expectedAmountAfterFee);
          console.log(burnCommission);
          const body = getPayloadForAction([BITCOIN_CHAIN_ID, stakedLbtcBytes, pubScript, expectedAmountAfterFee], UNSTAKE_REQUEST_SELECTOR);

          const payload = getGMPPayload(
            encode(['address'], [mailbox.address]),
            CHAIN_ID,
            LEDGER_CHAIN_ID,
            1,
            encode(['address'], [assetRouter.address]),
            LEDGER_SENDER,
            LEDGER_CALLER,
            body
          );

          await expect(stakedLbtc.connect(signer1).redeemForBtc(pubScript, amount))
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, LEDGER_SENDER, payload);
        });
      })
    });

    describe('Negative cases', function () {
      it('redeemForBtc() reverts when withdrawals are off', async function () {
        await expect(stakedLbtc.connect(owner).toggleWithdrawals())
          .to.emit(stakedLbtc, 'WithdrawalsEnabled')
          .withArgs(false);
        const amount = 100_000_000n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount))
          .to.revertedWithCustomError(stakedLbtc, 'WithdrawalsDisabled');
      });

      it('redeemForBtc() reverts if amount is less than burn commission', async function () {
        const burnCommission = await assetRouter.getToNativeCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountLessThanCommission);

        // await stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amountLessThanCommission);
        await expect(stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amountLessThanCommission))
          .to.be.revertedWithCustomError(assetRouter, 'AmountLessThanCommission')
          .withArgs(burnCommission);
      });

      //TODO: find out how to get dust limit
      it('redeemForBtc() reverts when amount is below dust limit for P2WSH', async () => {
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        const burnCommission = await assetRouter.getToNativeCommission();

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
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2wsh, amountJustBelowDustLimit)).to.be.revertedWithCustomError(
          stakedLbtc,
          'AmountBelowDustLimit'
        );
      });

      it('redeemForBtc() reverts with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2sh, amount))
          .to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2pkh, amount)).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2pk, amount)).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2ms, amount)).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
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
    // let assetRouter: AssetRouter;
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

    describe('Base flow', function () {
      const AMOUNT = 1_000_000n;

      beforeEach(async function () {
        await snapshot.restore();
        nonce = 1n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, AMOUNT);
        await nativeLBTC.connect(minter).mint(signer1, AMOUNT);
      });

      it('should Unstake (to native)', async () => {
        // set StakedLBTC => NativeLBTC
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, true, CHAIN_ID);

        const recipient = encode(['address'], [signer2.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          nonce++,
          recipient,
          AMOUNT,
          stakedLbtcBytes,
          nativeLbtcBytes,
          CHAIN_ID,
          CHAIN_ID
        );
        // no need to approve
        await expect(stakedLbtc.connect(signer1).redeem(AMOUNT))
          // .to.emit(stakedLbtc, 'StakingOperationRequested')
          // .withArgs(signer1, recipient, stakedLbtc, AMOUNT, expectedRequestPayload)
          .and.emit(stakedLbtc, 'Transfer') // burn StakedLBTC from sender
          .withArgs(signer1, ethers.ZeroAddress, AMOUNT);

        // const { payload: receiptPayload, proof } = await signStakingReceiptPayload(
        //   [notary1, notary2],
        //   [true, true],
        //   requestPayloadHash,
        //   recipient,
        //   AMOUNT,
        //   stakedLbtcBytes,
        //   nativeLbtcBytes,
        //   CHAIN_ID
        // );

        // await expect(stakedLbtc.finalizeStakingOperation(receiptPayload, proof))
        //   .to.emit(stakedLbtc, 'StakingOperationCompleted')
        //   .withArgs(signer2, nativeLBTC, AMOUNT)
        //   .and.emit(nativeLBTC, 'Transfer') // mint tokens
        //   .withArgs(ethers.ZeroAddress, signer2, AMOUNT)
      });

      it('should Stake (from native)', async () => {
        // set NativeLBTC => StakedLBTC
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, false, CHAIN_ID);

        const recipient = encode(['address'], [signer3.address]);
        const { payload: expectedRequestPayload, payloadHash: requestPayloadHash } = await signStakingOperationRequestPayload(
          [notary1, notary2],
          [false, false],
          nonce++,
          recipient,
          AMOUNT,
          nativeLbtcBytes,
          stakedLbtcBytes,
          CHAIN_ID,
          CHAIN_ID
        );
        await nativeLBTC.connect(signer1).approve(stakedLbtc, AMOUNT);
        await expect(stakedLbtc.connect(signer1).deposit(AMOUNT))
          .to.emit(stakedLbtc, 'StakingOperationRequested')
          .withArgs(signer1, recipient, nativeLBTC, AMOUNT, expectedRequestPayload)
          .and.emit(nativeLBTC, 'Transfer') // Staking tokens from sender
          .withArgs(signer1, stakedLbtc, AMOUNT)
          .and.emit(nativeLBTC, 'Transfer')
          .withArgs(stakedLbtc, ethers.ZeroAddress, AMOUNT); // finally burn

        const { payload: receiptPayload, proof } = await signStakingReceiptPayload(
          [notary1, notary2],
          [true, true],
          requestPayloadHash,
          recipient,
          AMOUNT,
          nativeLbtcBytes,
          stakedLbtcBytes,
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

        await stakedLbtc.connect(owner).changeAssetRouter(assetRouter);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, RND_CHAIN, nativeLbtcBytes2, CHAIN2);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, RND_CHAIN, stakedLbtcBytes1, CHAIN1);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, RND_CHAIN, stakedLbtcBytes2, CHAIN2);
        await assetRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLBTC);

        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, 100n * e8);
        await nativeLBTC.connect(owner).mint(signer1, 100n * e8);
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
            stakedLbtcBytes,
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
            nativeLbtcBytes,
            arg.toTokenStaked,
            CHAIN_ID,
            arg.tolChainId
          );

          await nativeLBTC.connect(signer1).approve(stakedLbtc, amount);
          const tx = stakedLbtc.connect(signer1).startStake(arg.tolChainId, recipient, amount);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationRequested').withArgs(signer1, recipient, nativeLBTC, amount, expectedRequestPayload);
          await expect(tx).to.emit(nativeLBTC, 'Transfer').withArgs(stakedLbtc, ethers.ZeroAddress, amount);
          await expect(tx).to.changeTokenBalance(nativeLBTC, signer1, -amount);
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
          await nativeLBTC.connect(signer1).approve(stakedLbtc, arg.amount);
          await expect(stakedLbtc.connect(signer1).startStake(arg.tolChainId, arg.recipient, arg.amount)).to.revertedWithCustomError(
            stakedLbtc,
            arg.error
          );
        });
      });

      it('startStake reverts when named token is not set', async function () {
        await StakingSnapshot.restore();
        await stakedLbtc.connect(owner).changeAssetRouter(assetRouter);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, RND_CHAIN, nativeLbtcBytes1, CHAIN1);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, RND_CHAIN, stakedLbtcBytes1, CHAIN1);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await expect(stakedLbtc.connect(signer1).startStake(CHAIN1, recipient, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'EnumerableMapNonexistentKey'
        );
      });

      //TODO: what is the expected error?
      it('startUnstake reverts when router is not set', async function () {
        await stakedLbtc.connect(owner).changeAssetRouter(ethers.ZeroAddress);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const amount = randomBigInt(8);
        await expect(stakedLbtc.connect(signer1).startUnstake(CHAIN1, recipient, amount)).to.be.revertedWithoutReason();
      });
    });

    describe('Finalize Staking operation', function () {
      before(async function () {
        await StakingSnapshot.restore();
        await stakedLbtc.connect(owner).changeAssetRouter(assetRouter);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes1, CHAIN1, stakedLbtcBytes, CHAIN_ID);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes2, CHAIN2, stakedLbtcBytes, CHAIN_ID);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes1, CHAIN1, nativeLbtcBytes, CHAIN_ID);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes2, CHAIN2, nativeLbtcBytes, CHAIN_ID);
        await assetRouter.connect(owner).setNamedToken(nativeLBTCName, nativeLBTC);

        await nativeLBTC.connect(owner).grantRole(await nativeLBTC.MINTER_ROLE(), stakedLbtc);
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
            nativeLbtcBytes,
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
            nativeLbtcBytes,
            CHAIN_ID
          );

          const tx = await stakedLbtc.connect(signer1).finalizeStakingOperation(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'StakingOperationCompleted').withArgs(recipient, nativeLBTC, amount);
          await expect(tx).to.emit(nativeLBTC, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(nativeLBTC, recipient, amount);
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
            stakedLbtcBytes,
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
            stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          toToken: () => nativeLbtcBytes,
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
          toToken: () => stakedLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
          nativeLbtcBytes,
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
        expect(await stakedLbtc.AssetRouter()).to.be.eq(ethers.ZeroAddress);
      });

      it('Owner can change', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeAssetRouter(newRouter))
          .to.emit(stakedLbtc, 'AssetRouterChanged')
          .withArgs(ethers.ZeroAddress, newRouter);

        expect(await stakedLbtc.AssetRouter()).to.be.eq(newRouter);
      });

      it('Owner can change again', async function () {
        await stakedLbtc.connect(owner).changeAssetRouter(assetRouter);

        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(owner).changeAssetRouter(newRouter))
          .to.emit(stakedLbtc, 'AssetRouterChanged')
          .withArgs(await assetRouter.getAddress(), newRouter);

        expect(await stakedLbtc.AssetRouter()).to.be.eq(newRouter);
      });

      it('Owner can change to 0 address', async function () {
        await stakedLbtc.connect(owner).changeAssetRouter(assetRouter);

        const newRouter = ethers.ZeroAddress;
        await expect(stakedLbtc.connect(owner).changeAssetRouter(newRouter))
          .to.emit(stakedLbtc, 'AssetRouterChanged')
          .withArgs(await assetRouter.getAddress(), newRouter);

        expect(await stakedLbtc.AssetRouter()).to.be.eq(newRouter);
      });

      it('Reverts when called by not an owner', async function () {
        const newRouter = ethers.Wallet.createRandom().address;
        await expect(stakedLbtc.connect(signer1).changeAssetRouter(newRouter))
          .to.be.revertedWithCustomError(stakedLbtc, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });
    });
  });
});