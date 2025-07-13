import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  BITCOIN_CHAIN_ID,
  BITCOIN_NATIVE_COIN,
  BTC_STAKING_MODULE_ADDRESS,
  CHAIN_ID,
  DEFAULT_DUST_FEE_RATE,
  DefaultData,
  deployContract,
  DEPOSIT_REQUEST_SELECTOR,
  e18,
  encode,
  FEE_APPROVAL_ACTION,
  generatePermitSignature,
  getFeeTypedMessage,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  GMP_V1_SELECTOR,
  LEDGER_CALLER,
  LEDGER_CHAIN_ID,
  LEDGER_MAILBOX,
  MINT_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  REDEEM_REQUEST_SELECTOR,
  signDepositBtcV0Payload,
  Signer,
  signPayload
} from './helpers';
import { AssetRouter, Bascule, Consortium, Mailbox, NativeLBTC, RatioFeedMock, StakedLBTC } from '../typechain-types';
import { applyProviderWrappers } from 'hardhat/internal/core/providers/construction';

const DAY = 86400;
const REDEEM_FOR_BTC_MIN_AMOUNT = randomBigInt(4);

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
  const toNativeCommission = 1000n;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let assetRouterBytes: string;

  before(async function () {
    [_, owner, treasury, minter, claimer, operator, pauser, reporter, notary1, notary2, signer1, signer2, signer3] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(
        getPayloadForAction([1, [notary1.publicKey, notary2.publicKey], [1, 1], 2, 1], NEW_VALSET)
      );

    stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
      await consortium.getAddress(),
      treasury.address,
      owner.address
    ]);
    stakedLbtc.address = await stakedLbtc.getAddress();
    stakedLbtcBytes = encode(['address'], [stakedLbtc.address]);

    nativeLBTC = await deployContract<NativeLBTC & Addressable>('NativeLBTC', [
      await consortium.getAddress(),
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

    bascule = await deployContract<Bascule>(
      'Bascule',
      [owner.address, pauser.address, reporter.address, stakedLbtc.address, 100],
      false
    );

    // Mailbox
    mailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    mailbox.address = await mailbox.getAddress();
    await mailbox.connect(owner).grantRole(await mailbox.TREASURER_ROLE(), treasury);
    await mailbox.connect(owner).grantRole(await mailbox.PAUSER_ROLE(), pauser);
    await mailbox.connect(owner).enableMessagePath(LEDGER_CHAIN_ID, LEDGER_MAILBOX);

    // Ratio feed
    ratioFeed = (await ethers.deployContract('RatioFeedMock', [])) as RatioFeedMock & Addressable;
    ratioFeed.address = await ratioFeed.getAddress();

    // AssetRouter
    assetRouter = await deployContract<AssetRouter & Addressable>('AssetRouter', [
      owner.address,
      0n,
      LEDGER_CHAIN_ID,
      BITCOIN_CHAIN_ID,
      mailbox.address,
      ratioFeed.address,
      ethers.ZeroAddress,
      toNativeCommission
    ]);
    assetRouter.address = await assetRouter.getAddress();
    assetRouterBytes = encode(['address'], [assetRouter.address]);
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);
    await assetRouter.connect(owner).grantRole(await assetRouter.CLAIMER_ROLE(), stakedLbtc.address);
    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 548, true);
    await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await nativeLBTC.connect(owner).changeAssetRouter(assetRouter.address);
    await stakedLbtc.connect(owner).addMinter(assetRouter.address);
    await nativeLBTC.connect(owner).grantRole(await nativeLBTC.MINTER_ROLE(), assetRouter.address);

    await assetRouter
      .connect(owner)
      ['changeRedeemForBtcMinAmount(address,uint256)'](stakedLbtc.address, REDEEM_FOR_BTC_MIN_AMOUNT);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  async function defaultData(
    recipient: Signer = signer1,
    amount: bigint = randomBigInt(8),
    feeApprove: bigint = 1n
  ): Promise<DefaultData> {
    const body = getPayloadForAction(
      [stakedLbtcBytes, encode(['address'], [recipient.address]), amount],
      MINT_SELECTOR
    );
    const payload = getGMPPayload(
      LEDGER_MAILBOX,
      LEDGER_CHAIN_ID,
      CHAIN_ID,
      Number(randomBigInt(8)),
      BTC_STAKING_MODULE_ADDRESS,
      assetRouterBytes,
      assetRouterBytes,
      body
    );
    const { payloadHash, proof } = await signPayload([notary1, notary2], [true, true], payload);
    const feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
    const userSignature = await getFeeTypedMessage(recipient, stakedLbtc, feeApprove, snapshotTimestamp + DAY);
    return {
      payload,
      payloadHash,
      proof,
      amount,
      tokenRecipient: recipient,
      feeApprovalPayload,
      userSignature
    } as unknown as DefaultData;
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

      it('isNative() false', async function () {
        expect(await stakedLbtc.isNative()).to.be.false;
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

    describe('Toggle btc redeem', function () {
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
        await stakedLbtc.connect(owner).toggleRedeemsForBtc();
      });

      it('toggleRedeemsForBtc() owner can enable', async function () {
        await expect(stakedLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(stakedLbtc.address, true);
        expect(await stakedLbtc.isRedeemsEnabled()).to.be.true;
      });

      it('toggleRedeemsForBtc() owner can disable', async function () {
        await expect(stakedLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(stakedLbtc.address, false);
        expect(await stakedLbtc.isRedeemsEnabled()).to.be.false;
      });

      it('toggleRedeemsForBtc() reverts when called by not an owner', async function () {
        await expect(stakedLbtc.connect(signer1).toggleRedeemsForBtc())
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
          name: 'AssetRouter',
          setter: 'changeAssetRouter',
          getter: 'getAssetRouter',
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
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
      });

      const fees = [
        {
          name: 'RedeemFee',
          setter: 'changeRedeemFee',
          getter: 'getRedeemFee',
          event: () => [assetRouter, 'AssetRouter_RedeemFeeChanged'],
          eventArgs: (oldValue, newValue) => [stakedLbtc.address, oldValue, newValue],
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
            // @ts-ignore
            .to.emit(...fee.event())
            // @ts-ignore
            .withArgs(...fee.eventArgs(oldValue, newValue));
        });

        it(`${fee.getter}() returns new ${fee.name}`, async function () {
          // @ts-ignore
          expect(await stakedLbtc[fee.getter]()).to.be.equal(newValue);
        });

        if (fee.canBeZero) {
          it(`${fee.setter}() ${fee.account} can set to 0`, async function () {
            // @ts-ignore
            await expect(stakedLbtc.connect(eval(fee.account))[fee.setter](0n))
              // @ts-ignore
              .to.emit(...fee.event())
              // @ts-ignore
              .withArgs(...fee.eventArgs(newValue, 0n));
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

      it('toNativeCommission() returns fee for redeem to NativeLBTC', async function () {
        expect(await stakedLbtc.toNativeCommission()).to.be.eq(toNativeCommission);
      });
      it('getRedeemForBtcMinAmount()', async function () {
        expect(await stakedLbtc.getRedeemForBtcMinAmount()).to.be.eq(REDEEM_FOR_BTC_MIN_AMOUNT);
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

      it('changeNameAndSymbol', async function () {
        const name = await stakedLbtc.name();
        const symbol = await stakedLbtc.symbol();
        const newName = name + ' V1';
        const newSymbol = symbol + 'v1';
        await expect(stakedLbtc.connect(owner).changeNameAndSymbol(newName, newSymbol))
          .to.emit(stakedLbtc, 'NameAndSymbolChanged')
          .withArgs(newName, newSymbol);
        expect(await stakedLbtc.name()).to.equal(newName);
        expect(await stakedLbtc.symbol()).to.equal(newSymbol);
        const domain = await stakedLbtc.eip712Domain();
        expect(domain.name).to.equal(newName);
        const typeHash = ethers.keccak256(
          ethers.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
        );
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const expectedDomainSeparator = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
            [
              typeHash,
              ethers.keccak256(ethers.toUtf8Bytes(newName)),
              ethers.keccak256(ethers.toUtf8Bytes('1')),
              chainId,
              await stakedLbtc.getAddress()
            ]
          )
        );
        expect(await stakedLbtc.DOMAIN_SEPARATOR()).to.equal(expectedDomainSeparator);
      });
    });
  });

  describe('Minting', function () {
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

    describe('Anyone can mint with valid payload', function () {
      args.forEach(function (arg) {
        it(`mint() ${arg.name}`, async function () {
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const recipient = arg.recipient().address;
          const amount = arg.amount;
          const body = getPayloadForAction(
            [stakedLbtcBytes, encode(['address'], [arg.recipient().address]), amount],
            MINT_SELECTOR
          );
          const payload = getGMPPayload(
            LEDGER_MAILBOX,
            LEDGER_CHAIN_ID,
            CHAIN_ID,
            Number(randomBigInt(8)),
            BTC_STAKING_MODULE_ADDRESS,
            assetRouterBytes,
            assetRouterBytes,
            body
          );
          const { proof } = await signPayload([notary1, notary2], [true, true], payload);

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

      //TODO: BASCULE
      it('mint() when bascule is enabled', async function () {
        this.skip();
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        const recipient = signer2;
        const amount = randomBigInt(8);
        const { payload, proof } = await defaultData(recipient, amount);

        // report deposit
        // TODO which payload to report?
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
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'unauthorized signers',
          signers: () => [signer1, signer2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'invalid destination chain',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: encode(['uint256'], [1]),
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [mailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'ledger mailbox address is invalid',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: encode(['uint256'], [randomBigInt(16)]),
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [mailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'unsupported source chainId',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: encode(['uint256'], [randomBigInt(16)]),
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [mailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'unknown sender on the ledger',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: encode(['uint256'], [randomBigInt(16)]),
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [assetRouter, 'AssetRouter_MintProcessingError']
        },
        {
          name: 'message recipient is not assetRouter',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => stakedLbtcBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          customError: () => [mailbox, 'Mailbox_HandlerNotImplemented']
        },
        {
          name: 'token recipient is 0 address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => ethers.ZeroAddress,
          amount: randomBigInt(8),
          customError: () => [assetRouter, 'AssetRouter_MintProcessingError']
        },
        {
          name: 'token amount is 0',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          msgFromContract: LEDGER_MAILBOX,
          msgFromChainId: LEDGER_CHAIN_ID,
          msgToChainId: CHAIN_ID,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: () => assetRouterBytes,
          dCaller: () => assetRouterBytes,
          tokenRecipient: () => signer1.address,
          amount: 0n,
          customError: () => [assetRouter, 'AssetRouter_MintProcessingError']
        }
        // {
        //   name: 'valid for debugging',
        //   signers: () => [notary1, notary2],
        //   signatures: [true, true],
        //   msgFromContract: LEDGER_MAILBOX,
        //   msgFromChainId: LEDGER_CHAIN_ID,
        //   msgToChainId: CHAIN_ID,
        //   msgSender: BTC_STAKING_MODULE_ADDRESS,
        //   msgRecipient: () => assetRouterBytes,
        //   dCaller: () => assetRouterBytes,
        //   tokenRecipient: () => signer1.address,
        //   amount: randomBigInt(8),
        //   customError: () => [mailbox, 'Mailbox_MessagePathDisabled']
        // },
      ];

      invalidArgs.forEach(function (arg) {
        it(`mint() reverts when ${arg.name}`, async function () {
          const recipient = arg.tokenRecipient();
          const amount = arg.amount;
          const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [recipient]), amount], MINT_SELECTOR);
          const payload = getGMPPayload(
            arg.msgFromContract,
            arg.msgFromChainId,
            arg.msgToChainId,
            Number(randomBigInt(8)),
            arg.msgSender,
            arg.msgRecipient(),
            arg.dCaller(),
            body
          );
          const { proof } = await signPayload(arg.signers(), arg.signatures, payload);
          await expect(stakedLbtc['mint(bytes,bytes)'](payload, proof))
            //@ts-ignore
            .to.revertedWithCustomError(...arg.customError());
        });
      });

      //TODO: BASCULE
      it('mint() reverts when not reported to bascule', async function () {
        this.skip();
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());

        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        // @ts-ignore
        // await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payloadHash, proof)).to.be.revertedWithCustomError(
        //   bascule,
        //   'WithdrawalFailedValidation'
        // );
      });

      it('mint() reverts when payload has been used', async function () {
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        // @ts-ignore
        await expect(
          stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof, { gasLimit: 500_000n })
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_MintProcessingError');
      });

      it('mint() reverts when paused', async function () {
        await stakedLbtc.connect(pauser).pause();
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof)).to.be.revertedWithCustomError(
          assetRouter,
          'AssetRouter_MintProcessingError'
        );
      });
    });

    describe('Claimer can mint with fee', function () {
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
            const body = getPayloadForAction(
              [stakedLbtcBytes, encode(['address'], [recipient.address]), amount],
              MINT_SELECTOR
            );
            const payload = getGMPPayload(
              LEDGER_MAILBOX,
              LEDGER_CHAIN_ID,
              CHAIN_ID,
              Number(randomBigInt(8)),
              BTC_STAKING_MODULE_ADDRESS,
              assetRouterBytes,
              assetRouterBytes,
              body
            );
            const { proof } = await signPayload([notary1, notary2], [true, true], payload);

            // Set fee and approve
            await assetRouter.connect(operator).setMaxMintCommission(fee.max);
            const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;
            const feeApprovalPayload = getPayloadForAction([fee.approved, snapshotTimestamp + DAY], 'feeApproval');
            const userSignature = await getFeeTypedMessage(
              recipient,
              stakedLbtc,
              fee.approved,
              snapshotTimestamp + DAY
            );

            // @ts-ignore
            const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
            await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
            await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient.address, amount);
            if (appliedFee > 0n) {
              await expect(tx)
                .to.emit(stakedLbtc, 'Transfer')
                .withArgs(recipient.address, ethers.ZeroAddress, appliedFee);
              await expect(tx)
                .to.emit(stakedLbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
            }
            await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount - appliedFee);
            await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, appliedFee);
            const totalSupplyAfter = await stakedLbtc.totalSupply();
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });
      });

      it('mintWithFee() can use fee approve many times until it expired', async function () {
        const recipient = signer1;
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        const userSignature = await getFeeTypedMessage(recipient, stakedLbtc, feeApproved, snapshotTimestamp + DAY);
        const feeApprovalPayload = getPayloadForAction([feeApproved, snapshotTimestamp + DAY], 'feeApproval');
        await assetRouter.connect(operator).setMaxMintCommission(feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        for (let i = 0; i < 10; i++) {
          await time.increase(3600);
          const amount = randomBigInt(8);
          const { payload, proof } = await defaultData(recipient, amount);
          // @ts-ignore
          const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
        }
      });

      //TODO: Bascule
      it('mintWithFee() when bascule enabled', async function () {
        this.skip();
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        // new
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        await assetRouter.connect(operator).setMaxMintCommission(feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        const amount = randomBigInt(8);
        const recipient = signer1;
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData(recipient, amount, feeApproved);

        // report deposit
        const reportId = ethers.zeroPadValue('0x01', 32);
        await expect(bascule.connect(reporter).reportDeposits(reportId, [ethers.keccak256('0x' + payload.slice(10))])) //From GMP
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);

        // @ts-ignore
        const tx = await stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
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

      it('mintWithFee() reverts when approve has expired', async function () {
        const { payload, proof } = await defaultData();
        const feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
        const userSignature = await getFeeTypedMessage(signer1, stakedLbtc, 1, snapshotTimestamp);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(assetRouter, 'UserSignatureExpired')
          .withArgs(snapshotTimestamp);
      });

      it('mintWithFee() reverts when mint payload type is invalid', async function () {
        const { feeApprovalPayload, userSignature } = await defaultData();
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(feeApprovalPayload, userSignature, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(mailbox, 'GMP_InvalidAction')
          .withArgs(GMP_V1_SELECTOR, FEE_APPROVAL_ACTION);
      });

      it('mintWithFee() reverts when fee payload type is invalid', async function () {
        const { payload, proof } = await defaultData();
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, payload, proof)
        )
          .to.revertedWithCustomError(assetRouter, 'InvalidAction')
          .withArgs(FEE_APPROVAL_ACTION, GMP_V1_SELECTOR);
      });

      it('mintWithFee() reverts when called by not a claimer', async function () {
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData();
        // @ts-ignore
        await expect(stakedLbtc.connect(signer1).mintWithFee(payload, proof, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
          .withArgs(signer1);
      });

      it('mintWithFee() reverts when mint amount equals fee', async function () {
        const amount = randomBigInt(3);
        const fee = amount + 1n;
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData(signer1, amount, fee);
        await assetRouter.connect(operator).setMaxMintCommission(fee);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'AssetRouter_FeeGreaterThanAmount');
      });

      it('mintWithFee() reverts when fee approve signed by other account', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(claimer, stakedLbtc, 1, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
      });

      it('mintWithFee() reverts when fee signature doesnt match payload', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(signer1, stakedLbtc, 2, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          stakedLbtc.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
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
            [
              'batchMint(address[],uint256[])'
            ]([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter)['batchMint(address[],uint256[])']([signer1.address], [amount1, amount2])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            stakedLbtc.connect(minter)['batchMint(address[],uint256[])']([signer1.address, signer2.address], [amount1])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(stakedLbtc.connect(signer1)['batchMint(address[],uint256[])']([signer1.address], [amount1]))
            .to.be.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
            .withArgs(signer1.address);
        });

        it('batchMint() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(minter)
              [
                'batchMint(address[],uint256[])'
              ]([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3])
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
            [
              'batchMint(bytes[],bytes[])'
            ]([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() skips used payloads', async function () {
          const tx = await stakedLbtc
            .connect(signer1)
            [
              'batchMint(bytes[],bytes[])'
            ]([data1.payload, data1.payload, data2.payload, data2.payload], [data1.proof, data1.proof, data2.proof, data2.proof]);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data1.payloadHash, '', '0x');
          await expect(tx)
            .to.emit(mailbox, 'MessageHandleError')
            .withArgs(data1.payloadHash, assetRouter.address, '', '0x9eae5090');
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data2.payloadHash, '', '0x');
          await expect(tx)
            .to.emit(mailbox, 'MessageHandleError')
            .withArgs(data2.payloadHash, assetRouter.address, '', '0x9eae5090');
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1, amount2]);
        });

        it('batchMint() reverts if failed to mint any payload', async function () {
          const { payload, proof } = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer3.address,
            randomBigInt(8),
            encode(['uint256'], [randomBigInt(8)]) //txId
          );
          await expect(
            stakedLbtc
              .connect(signer1)
              ['batchMint(bytes[],bytes[])']([data1.payload, data2.payload, payload], [data1.proof, data2.proof, proof])
          ).to.be.reverted;
        });

        it('batchMint() reverts when there is less payloads than proofs', async function () {
          await expect(
            stakedLbtc.connect(signer1)['batchMint(bytes[],bytes[])']([data1.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when there is more payloads than proofs', async function () {
          await expect(
            stakedLbtc.connect(signer1)['batchMint(bytes[],bytes[])']([data1.payload, data2.payload], [data1.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when paused', async function () {
          await stakedLbtc.connect(pauser).pause();
          await expect(
            stakedLbtc
              .connect(signer1)
              ['batchMint(bytes[],bytes[])']([data1.payload, data2.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
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
          await assetRouter.connect(operator).setMaxMintCommission(maxFee);
          data1 = await defaultData(signer1, amount1, maxFee + 1n);
          data2 = await defaultData(signer2, amount2, maxFee + 1n);
          data3 = await defaultData(signer3, amount3, maxFee + 1n);
        });

        it('batchMintWithFee() claimer can mint many payloads with fee', async function () {
          const tx = await stakedLbtc.connect(claimer).batchMintWithFee(
            //@ts-ignore
            [data1.payload, data2.payload, data3.payload],
            [data1.proof, data2.proof, data3.proof],
            [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
            [data1.userSignature, data2.userSignature, data3.userSignature]
          );
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data3.userSignature);
          await expect(tx).changeTokenBalances(
            stakedLbtc,
            [signer1, signer2, signer3],
            [amount1 - maxFee, amount2 - maxFee, amount3 - maxFee]
          );
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 3n);
        });

        it('batchMintWithFee() skips used payloads', async function () {
          const tx = await stakedLbtc.connect(claimer).batchMintWithFee(
            //@ts-ignore
            [data1.payload, data1.payload, data2.payload, data2.payload],
            [data1.proof, data1.proof, data2.proof, data2.proof],
            [data1.feeApprovalPayload, data1.feeApprovalPayload, data2.feeApprovalPayload, data2.feeApprovalPayload],
            [data1.userSignature, data1.userSignature, data2.userSignature, data2.userSignature]
          );

          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data1.payloadHash, '', '0x');
          await expect(tx)
            .to.emit(mailbox, 'MessageHandleError')
            .withArgs(data1.payloadHash, assetRouter.address, '', '0x9eae5090');
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data2.payloadHash, '', '0x');
          await expect(tx)
            .to.emit(mailbox, 'MessageHandleError')
            .withArgs(data2.payloadHash, assetRouter.address, '', '0x9eae5090');
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1 - maxFee, amount2 - maxFee]);
          await expect(tx).changeTokenBalance(stakedLbtc, treasury, maxFee * 2n);
        });

        it('batchMintWithFee() reverts if failed to mint any payload', async function () {
          const { payload, proof } = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer3.address,
            randomBigInt(8),
            encode(['uint256'], [randomBigInt(8)]) //txId
          );
          const feeApprovalPayload = getPayloadForAction([1n, snapshotTimestamp + DAY], 'feeApproval');
          const userSignature = await getFeeTypedMessage(signer3, stakedLbtc, 1n, snapshotTimestamp + DAY);
          await expect(
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, payload],
              [data1.proof, data2.proof, proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, feeApprovalPayload],
              [data1.userSignature, data2.userSignature, userSignature]
            )
          ).to.be.reverted;
        });

        it('batchMintWithFee() reverts when there is less payloads than other entities', async function () {
          await expect(
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less proofs than payloads', async function () {
          await expect(
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less fee approvals than payloads', async function () {
          await expect(
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when there is less user fee signatures than payloads', async function () {
          await expect(
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature]
            )
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMintWithFee() reverts when called by not a claimer', async function () {
          await expect(
            stakedLbtc.connect(signer1).batchMintWithFee(
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
            stakedLbtc.connect(claimer).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });
    });

    describe('Transfer by minter', function () {
      before(async function () {
        await snapshot.restore();
      });

      //TODO: write test
      it('minter can transfer from one account to other');
    });
  });

  describe('Redeem for BTC', function () {
    describe('Positive cases', function () {
      let nonce = 1;
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
      });

      const args = [
        {
          name: 'all P2TR',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8),
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947',
          isAboveDust: true
        },
        {
          name: 'all P2WSH',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8),
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3',
          isAboveDust: true
        },
        {
          name: 'all p2wpkh',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8),
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'partial p2wpkh',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8),
          balance: (a: bigint) => a * 2n,
          ratio: e18,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees = 0, ratio = 0.5 and expectedAmount > minAmount',
          toNativeFee: 0n,
          redeemFee: 0n,
          expectedAmount: 1000_000n + REDEEM_FOR_BTC_MIN_AMOUNT,
          balance: (a: bigint) => a,
          ratio: e18 / 2n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 0.5 and expectedAmount > minAmount',
          toNativeFee: 1000n,
          redeemFee: 1000n,
          expectedAmount: 1000_000n,
          balance: (a: bigint) => a,
          ratio: e18 / 2n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 0.(9) and expectedAmount > minAmount',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8) + REDEEM_FOR_BTC_MIN_AMOUNT,
          balance: (a: bigint) => a,
          ratio: e18 - 1n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 1 and expectedAmount = minAmount',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: REDEEM_FOR_BTC_MIN_AMOUNT,
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio is random and expectedAmount = minAmount',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: REDEEM_FOR_BTC_MIN_AMOUNT,
          balance: (a: bigint) => a,
          ratio: randomBigInt(18),
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        }
      ];

      args.forEach(function (arg) {
        let redeemAmount: bigint;
        let requestAmount: bigint;
        let isAboveDust: boolean;

        it(`calcUnstakeRequestAmount ${arg.name}`, async function () {
          await stakedLbtc.connect(owner).changeRedeemFee(arg.redeemFee);
          await assetRouter.connect(owner).changeToNativeCommission(arg.toNativeFee);
          await ratioFeed.setRatio(arg.ratio);

          // redeemAmount = arg.expectedAmount + arg.redeemFee + (arg.toNativeFee * arg.ratio) / e18;
          redeemAmount = arg.expectedAmount + arg.redeemFee + arg.toNativeFee;
          [requestAmount, isAboveDust] = await assetRouter.calcUnstakeRequestAmount(
            stakedLbtc.address,
            arg.scriptPubKey,
            redeemAmount
          );
          expect(requestAmount).to.be.closeTo(arg.expectedAmount, 1n);
          expect(isAboveDust).to.be.eq(arg.isAboveDust);
        });

        it(`redeemForBtc() ${arg.name}`, async () => {
          //Burn previous balance
          const balance = await stakedLbtc.balanceOf(signer1);
          await stakedLbtc.connect(signer1)['burn(uint256)'](balance);
          expect(await stakedLbtc.balanceOf(signer1)).to.be.eq(0n);

          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, arg.balance(redeemAmount));
          const totalSupplyBefore = await stakedLbtc.totalSupply();
          const totalFee = redeemAmount - requestAmount;

          const body = getPayloadForAction(
            [
              BITCOIN_CHAIN_ID,
              stakedLbtcBytes,
              encode(['address'], [signer1.address]),
              arg.scriptPubKey,
              requestAmount
            ],
            REDEEM_REQUEST_SELECTOR
          );
          const payload = getGMPPayload(
            encode(['address'], [mailbox.address]),
            CHAIN_ID,
            LEDGER_CHAIN_ID,
            nonce++,
            encode(['address'], [assetRouter.address]),
            BTC_STAKING_MODULE_ADDRESS,
            LEDGER_CALLER,
            body
          );

          const tx = stakedLbtc.connect(signer1).redeemForBtc(arg.scriptPubKey, redeemAmount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, -redeemAmount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, totalFee);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(redeemAmount - totalFee);
        });
      });
    });

    describe('Negative cases', function () {
      beforeEach(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
      });
      it('redeemForBtc() reverts when it is off', async function () {
        await expect(stakedLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(stakedLbtc.address, false);
        const amount = 100_000_000n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.revertedWithCustomError(assetRouter, 'AssetOperation_RedeemNotAllowed');
      });

      it('redeemForBtc() reverts when amount < toNativeCommission', async function () {
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, randomBigInt(10));

        const redeemFee = 100n;
        const toNativeCommission = 1000n;
        await assetRouter.connect(owner).changeToNativeCommission(toNativeCommission);
        await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        const amount = toNativeCommission - 1n;

        await expect(stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount))
          .to.be.revertedWithCustomError(assetRouter, 'AmountLessThanCommission')
          .withArgs(toNativeCommission);
      });

      it('redeemForBtc() reverts when amount < redeemFee', async function () {
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, randomBigInt(10));

        const redeemFee = 1000n;
        const toNativeCommission = 100n;
        await assetRouter.connect(owner).changeToNativeCommission(toNativeCommission);
        await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        const amount = redeemFee - 1n;

        await expect(
          stakedLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_FeeGreaterThanAmount');
      });

      it('redeemForBtc() reverts when amount is below dust limit', async () => {
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        const toNativeCommission = await assetRouter.toNativeCommission();

        // Start with a very small amount
        let amount = toNativeCommission + 1n;
        let isAboveDust = false;

        // Incrementally increase the amount until we find the dust limit
        while (!isAboveDust) {
          amount += 1n;
          [, isAboveDust] = await stakedLbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }

        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountJustBelowDustLimit);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2wsh, amountJustBelowDustLimit))
          .to.be.revertedWithCustomError(assetRouter, 'AmountBelowMinLimit')
          .withArgs(amountJustBelowDustLimit - toNativeCommission + 1n);
      });

      it('redeemForBtc() reverts with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2sh, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2pkh, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2pk, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(stakedLbtc.connect(signer1).redeemForBtc(p2ms, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
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
        stakedLbtc.address,
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
          stakedLbtc.address,
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
            stakedLbtc.address,
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

  describe('Redeem for NativeLBTC', function () {
    const redeemFee = randomBigInt(3);
    let nonce = 1;
    before(async function () {
      await snapshot.restore();
      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, randomBigInt(8));
      await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 2);
      await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
    });

    const args = [
      {
        name: 'partially',
        balance: randomBigInt(8),
        amount: (balance: bigint) => balance / 2n
      },
      {
        name: 'all',
        balance: randomBigInt(8),
        amount: (balance: bigint) => balance
      }
    ];

    args.forEach(function (arg) {
      it(`redeem() ${arg.name}`, async () => {
        const sender = signer1;
        const balance = await stakedLbtc.balanceOf(sender);
        const amount = arg.amount(balance);
        const expectedAmount = amount - redeemFee;

        const body = getPayloadForAction(
          [
            CHAIN_ID,
            stakedLbtcBytes,
            encode(['address'], [sender.address]),
            encode(['address'], [sender.address]),
            expectedAmount
          ],
          REDEEM_REQUEST_SELECTOR
        );
        const payload = getGMPPayload(
          encode(['address'], [mailbox.address]),
          CHAIN_ID,
          LEDGER_CHAIN_ID,
          nonce++,
          encode(['address'], [assetRouter.address]),
          BTC_STAKING_MODULE_ADDRESS,
          LEDGER_CALLER,
          body
        );

        const tx = await stakedLbtc.connect(sender).redeem(amount);
        await expect(tx)
          .to.emit(mailbox, 'MessageSent')
          .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
        await expect(tx).to.changeTokenBalance(stakedLbtc, sender, -amount);
        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, redeemFee);
      });
    });

    it('redeem() reverts when amount less than redeemFee', async function () {
      const sender = signer1;
      const amount = redeemFee - 1n;
      await expect(stakedLbtc.connect(sender).redeem(amount)).to.be.revertedWithCustomError(
        assetRouter,
        'AssetRouter_FeeGreaterThanAmount'
      );
    });

    it('redeem() reverts when amount greater than balance', async function () {
      const sender = signer1;
      await stakedLbtc.connect(minter)['mint(address,uint256)'](sender, randomBigInt(8));
      const balance = await stakedLbtc.balanceOf(sender);
      const amount = balance + 1n;
      await expect(stakedLbtc.connect(sender).redeem(amount))
        .to.be.revertedWithCustomError(stakedLbtc, 'ERC20InsufficientBalance')
        .withArgs(sender.address, balance, amount);
    });

    it('redeem() reverts when assetRouter is not set', async function () {
      const stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        await consortium.getAddress(),
        treasury.address,
        owner.address
      ]);
      stakedLbtc.address = await stakedLbtc.getAddress();
      await stakedLbtc.connect(owner).addMinter(minter.address);
      const sender = signer1;
      const amount = randomBigInt(8);
      await stakedLbtc.connect(minter)['mint(address,uint256)'](sender, amount);
      await expect(stakedLbtc.connect(sender).redeem(amount)).to.be.reverted;
    });

    it('redeem() reverts when contract paused', async function () {
      const sender = signer1;
      const amount = randomBigInt(8);
      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, amount);
      await stakedLbtc.connect(pauser).pause();
      await expect(stakedLbtc.connect(sender).redeem(amount)).to.be.revertedWithCustomError(
        stakedLbtc,
        'EnforcedPause'
      );
    });
  });

  describe('Deposit NativeLBTC', function () {
    let nonce = 1;
    before(async function () {
      await snapshot.restore();
      await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
      await nativeLBTC.connect(minter).mint(signer1, randomBigInt(8));
    });

    const args = [
      {
        name: 'partially',
        balance: randomBigInt(8),
        amount: (balance: bigint) => balance / 2n
      },
      {
        name: 'all',
        balance: randomBigInt(8),
        amount: (balance: bigint) => balance
      }
    ];

    args.forEach(function (arg) {
      it(`deposit() ${arg.name}`, async () => {
        const totalSupplyNativeBefore = await nativeLBTC.totalSupply();
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        const sender = signer1;
        const balance = await nativeLBTC.balanceOf(sender);
        const amount = arg.amount(balance);

        const body = getPayloadForAction(
          [
            CHAIN_ID,
            stakedLbtcBytes,
            encode(['address'], [sender.address]),
            encode(['address'], [sender.address]),
            amount
          ],
          DEPOSIT_REQUEST_SELECTOR
        );
        const payload = getGMPPayload(
          encode(['address'], [mailbox.address]),
          CHAIN_ID,
          LEDGER_CHAIN_ID,
          nonce,
          encode(['address'], [assetRouter.address]),
          BTC_STAKING_MODULE_ADDRESS,
          LEDGER_CALLER,
          body
        );
        nonce++;

        const tx = await stakedLbtc.connect(sender).deposit(amount);
        await expect(tx)
          .to.emit(mailbox, 'MessageSent')
          .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
        await expect(tx).to.changeTokenBalance(nativeLBTC, sender, -amount);

        const totalSupplyNativeAfter = await nativeLBTC.totalSupply();
        const totalSupplyAfter = await stakedLbtc.totalSupply();
        expect(totalSupplyNativeBefore - totalSupplyNativeAfter).to.be.eq(amount);
        expect(totalSupplyAfter).to.be.eq(totalSupplyBefore);
      });
    });

    it('deposit() reverts when amount is 0', async function () {
      const sender = signer1;
      const amount = 0n;
      await expect(stakedLbtc.connect(sender).deposit(amount)).to.be.revertedWithCustomError(
        assetRouter,
        'Assets_ZeroAmount'
      );
    });

    it('deposit() reverts when amount greater than balance', async function () {
      const sender = signer1;
      const balance = await nativeLBTC.balanceOf(sender);
      const amount = balance + 1n;
      await expect(stakedLbtc.connect(sender).deposit(amount))
        .to.be.revertedWithCustomError(nativeLBTC, 'ERC20InsufficientBalance')
        .withArgs(sender.address, balance, amount);
    });

    it('deposit() reverts when assetRouter is not set', async function () {
      const stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        await consortium.getAddress(),
        treasury.address,
        owner.address
      ]);
      stakedLbtc.address = await stakedLbtc.getAddress();
      await stakedLbtc.connect(owner).addMinter(minter.address);
      const sender = signer1;
      const amount = randomBigInt(8);
      await expect(stakedLbtc.connect(sender).deposit(amount)).to.be.reverted;
    });

    it('deposit() reverts when deposit route is not set', async function () {
      const stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        await consortium.getAddress(),
        treasury.address,
        owner.address
      ]);
      const stakedLbtcBytes = encode(['address'], [await stakedLbtc.getAddress()]);
      await stakedLbtc.connect(owner).addMinter(minter.address);
      await assetRouter.connect(owner).setRoute(BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
      await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
      const sender = signer1;
      const amount = randomBigInt(8);
      await expect(stakedLbtc.connect(sender).deposit(amount)).to.be.revertedWithCustomError(
        assetRouter,
        'AssetOperation_DepositNotAllowed'
      );
    });

    it('deposit() reverts when contract paused', async function () {
      const sender = signer1;
      await nativeLBTC.connect(minter).mint(sender, randomBigInt(8));
      const amount = await nativeLBTC.balanceOf(sender);
      await stakedLbtc.connect(pauser).pause();
      await nativeLBTC.connect(pauser).pause();

      await expect(stakedLbtc.connect(sender).deposit(amount)).to.be.revertedWithCustomError(
        stakedLbtc,
        'EnforcedPause'
      );
    });
  });

  describe('Burn and Transfer', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('burn() minter can burn accounts tokens', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await stakedLbtc.connect(minter)['mint(address,uint256)'](recipient.address, balance);
      expect(await stakedLbtc.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      const totalSupplyBefore = await stakedLbtc.totalSupply();
      const tx = await stakedLbtc.connect(minter)['burn(address,uint256)'](recipient.address, amount);
      await expect(tx).changeTokenBalance(stakedLbtc, recipient, -amount);
      const totalSupplyAfter = await stakedLbtc.totalSupply();
      expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(amount);
    });

    it('burn() reverts when called by not a minter', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await stakedLbtc.connect(minter)['mint(address,uint256)'](recipient.address, balance);
      expect(await stakedLbtc.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      await expect(stakedLbtc.connect(signer2)['burn(address,uint256)'](recipient.address, amount))
        .to.revertedWithCustomError(stakedLbtc, 'UnauthorizedAccount')
        .withArgs(signer2);
    });
  });
});
