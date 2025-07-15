import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  ASSETS_MODULE_ADDRESS,
  BITCOIN_CHAIN_ID,
  BITCOIN_NATIVE_COIN,
  BTC_STAKING_MODULE_ADDRESS,
  CHAIN_ID,
  DefaultData,
  deployContract,
  DEPOSIT_BTC_ACTION_V1,
  DEPOSIT_REQUEST_SELECTOR,
  e18,
  encode,
  FEE_APPROVAL_ACTION,
  getFeeTypedMessage,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  GMP_V1_SELECTOR,
  initNativeLBTC,
  initStakedLBTC,
  LEDGER_CALLER,
  LEDGER_CHAIN_ID,
  LEDGER_MAILBOX,
  MINT_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  REDEEM_FROM_NATIVE_TOKEN_SELECTOR,
  REDEEM_REQUEST_SELECTOR,
  signDepositBtcV0Payload,
  Signer,
  signPayload
} from './helpers';
import { AssetRouter, Bascule, Consortium, Mailbox, NativeLBTC, RatioFeedMock, StakedLBTC } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';
import { GMPUtils } from '../typechain-types/contracts/gmp/IHandler';
import { applyProviderWrappers } from 'hardhat/internal/core/providers/construction';

const DAY = 86400;
const REDEEM_FOR_BTC_MIN_AMOUNT = randomBigInt(4);

describe('AssetRouter', function () {
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
    signer3: Signer,
    owner2: Signer;
  let stakedLbtc: StakedLBTC & Addressable;
  let stakedLbtcBytes: string;
  let nativeLbtc: NativeLBTC & Addressable;
  let nativeLbtcBytes: string;
  let bascule: Bascule;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let consortium: Consortium & Addressable;
  const toNativeCommission = 1000;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let assetRouterBytes: string;

  before(async function () {
    [
      _,
      owner,
      treasury,
      minter,
      claimer,
      operator,
      pauser,
      reporter,
      notary1,
      notary2,
      signer1,
      signer2,
      signer3,
      owner2
    ] = await getSignersWithPrivateKeys();

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

    nativeLbtc = await deployContract<NativeLBTC & Addressable>('NativeLBTC', [
      await consortium.getAddress(),
      treasury.address,
      owner.address,
      0n //owner delay
    ]);
    nativeLbtc.address = await nativeLbtc.getAddress();
    nativeLbtcBytes = encode(['address'], [nativeLbtc.address]);

    // Minter
    await stakedLbtc.connect(owner).addMinter(minter.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), minter);
    // Claimer
    await stakedLbtc.connect(owner).addClaimer(claimer.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.CLAIMER_ROLE(), claimer);
    // Operator
    await stakedLbtc.connect(owner).changeOperator(operator.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.OPERATOR_ROLE(), operator);
    // Pauser
    await stakedLbtc.connect(owner).changePauser(pauser.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.PAUSER_ROLE(), pauser);

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
      ethers.ZeroAddress
    ]);
    assetRouter.address = await assetRouter.getAddress();
    assetRouterBytes = encode(['address'], [assetRouter.address]);
    // Configs
    await assetRouter.connect(owner).changeOracle(nativeLbtc.address, ratioFeed.address);
    await assetRouter.connect(owner).changeToNativeCommission(nativeLbtc.address, toNativeCommission);

    // Roles
    await assetRouter.connect(owner).grantRole(await assetRouter.CALLER_ROLE(), owner);
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);
    await assetRouter.connect(owner).grantRole(await assetRouter.CLAIMER_ROLE(), claimer);

    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 516, true);
    await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await nativeLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await stakedLbtc.connect(owner).addMinter(assetRouter.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), assetRouter.address);

    await expect(
      assetRouter
        .connect(owner)
        ['changeRedeemForBtcMinAmount(address,uint256)'](stakedLbtc.address, REDEEM_FOR_BTC_MIN_AMOUNT)
    );
    await expect(
      assetRouter
        .connect(owner)
        ['changeRedeemForBtcMinAmount(address,uint256)'](nativeLbtc.address, REDEEM_FOR_BTC_MIN_AMOUNT)
    );

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
    describe('Deployment values', function () {
      let assetRouter: AssetRouter & Addressable;
      const ownerDelay = randomBigInt(3);
      const ledgerChainId = encode(['uint256'], [randomBigInt(16)]);
      const bitcoinChainId = encode(['uint256'], [randomBigInt(8)]);
      const mailbox = ethers.Wallet.createRandom();
      const ratioFeed = ethers.Wallet.createRandom();
      const bascule = ethers.Wallet.createRandom();
      const toNativeCommission = randomBigInt(3);

      before(async function () {
        assetRouter = await deployContract<AssetRouter & Addressable>('AssetRouter', [
          owner2.address,
          ownerDelay,
          ledgerChainId,
          bitcoinChainId,
          mailbox.address,
          bascule.address
        ]);
        await assetRouter.connect(owner2).changeOracle(nativeLbtc.address, ratioFeed.address);
        await assetRouter.connect(owner2).changeToNativeCommission(nativeLbtc.address, toNativeCommission);
      });

      it('defaultAdmin', async function () {
        expect(await assetRouter.defaultAdmin()).to.be.eq(owner2.address);
      });

      it('defaultAdminDelay', async function () {
        expect(await assetRouter.defaultAdminDelay()).to.be.eq(ownerDelay);
      });

      it('bitcoinChainId', async function () {
        expect(await assetRouter.bitcoinChainId()).to.be.eq(bitcoinChainId);
      });

      it('mailbox', async function () {
        expect(await assetRouter.mailbox()).to.be.eq(mailbox.address);
      });

      it('oracle', async function () {
        expect(await assetRouter.oracle(nativeLbtc.address)).to.be.eq(ratioFeed.address);
      });

      it('bascule', async function () {
        expect(await assetRouter.bascule()).to.be.eq(bascule.address);
      });

      it('toNativeCommission', async function () {
        expect(await assetRouter.toNativeCommission(nativeLbtc.address)).to.be.eq(toNativeCommission);
      });
    });

    describe('Config', function () {
      let newRole: Signer;

      before(async function () {
        await snapshot.restore();
        newRole = signer1;
      });

      const args = [
        {
          name: 'Mailbox',
          setter: 'changeMailbox',
          getter: 'mailbox',
          event: 'AssetRouter_MailboxChanged',
          defaultAccount: () => mailbox.address,
          canBeZero: false
        },
        {
          name: 'NativeToken',
          setter: 'changeNativeToken',
          getter: 'nativeToken',
          event: 'AssetRouter_NativeTokenChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        },
        {
          name: 'Bascule',
          setter: 'changeBascule',
          getter: 'bascule',
          event: 'AssetRouter_BasculeChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        }
      ];
      args.forEach(function (arg) {
        it(`${arg.setter}() owner can set ${arg.name}`, async function () {
          // @ts-ignore
          await expect(assetRouter.connect(owner)[arg.setter](newRole))
            .to.emit(assetRouter, arg.event)
            .withArgs(arg.defaultAccount(), newRole.address);
        });

        it(`${arg.getter}() returns new ${arg.name}`, async function () {
          // @ts-ignore
          expect(await assetRouter[arg.getter]()).to.be.equal(newRole);
        });

        it(`${arg.setter}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(assetRouter.connect(newRole)[arg.setter](ethers.Wallet.createRandom().address))
            .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
            .withArgs(newRole.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
        });

        if (!arg.canBeZero) {
          it(`${arg.setter}() reverts when set to 0 address`, async function () {
            // @ts-ignore
            await expect(assetRouter.connect(owner)[arg.setter](ethers.ZeroAddress)).to.revertedWithCustomError(
              assetRouter,
              'AssetRouter_ZeroAddress'
            );
          });
        }
      });
    });

    describe('Fees', function () {
      before(async function () {
        await snapshot.restore();
      });

      const fees = [
        {
          name: 'ToNativeCommission',
          setter: 'changeToNativeCommission',
          getter: 'toNativeCommission',
          event: 'AssetRouter_ToNativeCommissionChanged',
          account: 'owner',
          role: async () => await assetRouter.DEFAULT_ADMIN_ROLE()
        },
        {
          name: 'MaxMintFee',
          setter: 'setMaxMintCommission',
          getter: 'maxMintCommission',
          event: 'AssetRouter_MintFeeChanged',
          account: 'operator',
          role: async () => await assetRouter.OPERATOR_ROLE()
        }
      ];

      fees.forEach(function (fee) {
        let newValue: bigint;

        it(`${fee.setter}() ${fee.account} can set ${fee.name}`, async function () {
          // @ts-ignore
          const oldValue = await assetRouter[fee.getter](nativeLbtc.address);
          newValue = randomBigInt(4);
          // @ts-ignore
          await expect(assetRouter.connect(eval(fee.account))[fee.setter](nativeLbtc.address, newValue))
            .to.emit(assetRouter, fee.event)
            .withArgs(oldValue, newValue);
        });

        it(`${fee.getter}() returns new ${fee.name}`, async function () {
          // @ts-ignore
          const actualValue = await assetRouter[fee.getter](nativeLbtc.address);
          expect(actualValue).to.be.equal(newValue);
        });

        it(`${fee.setter}() reverts when called by not ${fee.account}`, async function () {
          // @ts-ignore
          await expect(assetRouter.connect(signer1)[fee.setter](nativeLbtc.address, randomBigInt(3)))
            .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, await fee.role());
        });
      });

      it('changeRedeemFee() authorized caller can', async function () {
        const newValue = randomBigInt(3);
        await assetRouter.connect(owner).grantRole(await assetRouter.CALLER_ROLE(), signer1);
        await expect(assetRouter.connect(signer1)['changeRedeemFee(uint256)'](newValue))
          .to.emit(assetRouter, 'AssetRouter_RedeemFeeChanged')
          .withArgs(signer1.address, 0n, newValue);
        const [redeemFee, redeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(signer1.address);
        expect(redeemFee).to.be.eq(newValue);
        expect(redeemForBtcMinAmount).to.be.eq(0);
        expect(redeemEnabled).to.be.false;
      });

      it('changeRedeemFee() reverts when called by not an authorized caller', async function () {
        await expect(assetRouter.connect(signer2)['changeRedeemFee(uint256)'](randomBigInt(3)))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer2.address, await assetRouter.CALLER_ROLE());
      });

      it('changeRedeemFee() owner can', async function () {
        const [oldRedeemFee, oldRedeemForBtcMinAmount] = await assetRouter.tokenConfig(signer1.address);
        const newValue = randomBigInt(3);
        await expect(assetRouter.connect(owner)['changeRedeemFee(address,uint256)'](signer1, newValue))
          .to.emit(assetRouter, 'AssetRouter_RedeemFeeChanged')
          .withArgs(signer1.address, oldRedeemFee, newValue);
        const [redeemFee, redeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(signer1.address);
        expect(redeemFee).to.be.eq(newValue);
        expect(redeemForBtcMinAmount).to.be.eq(oldRedeemForBtcMinAmount);
        expect(redeemEnabled).to.be.false;
      });

      it('changeRedeemFee() reverts when called by not an owner', async function () {
        await expect(assetRouter.connect(signer2)['changeRedeemFee(address,uint256)'](signer2, randomBigInt(3)))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer2.address, await assetRouter.DEFAULT_ADMIN_ROLE());
      });

      it('changeRedeemForBtcMinAmount() authorized caller can', async function () {
        const [oldRdeemFee, ,] = await assetRouter.tokenConfig(signer1.address);
        const newValue = randomBigInt(4);
        await assetRouter.connect(owner).grantRole(await assetRouter.CALLER_ROLE(), signer1);
        await expect(assetRouter.connect(signer1)['changeRedeemForBtcMinAmount(uint256)'](newValue))
          .to.emit(assetRouter, 'AssetRouter_RedeemForBtcMinAmountChanged')
          .withArgs(signer1.address, 0n, newValue);
        const [redeemFee, redeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(signer1.address);
        expect(redeemFee).to.be.eq(oldRdeemFee);
        expect(redeemForBtcMinAmount).to.be.eq(newValue);
        expect(redeemEnabled).to.be.false;
      });

      it('changeRedeemForBtcMinAmount() reverts when called by not an authorized caller', async function () {
        await expect(assetRouter.connect(signer2)['changeRedeemForBtcMinAmount(uint256)'](randomBigInt(4)))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer2.address, await assetRouter.CALLER_ROLE());
      });

      it('changeRedeemForBtcMinAmount() owner can', async function () {
        const [oldRdeemFee, oldRedeemForBtcMinAmount] = await assetRouter.tokenConfig(signer1.address);
        const newValue = randomBigInt(4);
        await expect(assetRouter.connect(owner)['changeRedeemForBtcMinAmount(address,uint256)'](signer1, newValue))
          .to.emit(assetRouter, 'AssetRouter_RedeemForBtcMinAmountChanged')
          .withArgs(signer1.address, oldRedeemForBtcMinAmount, newValue);
        const [redeemFee, redeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(signer1.address);
        expect(redeemFee).to.be.eq(oldRdeemFee);
        expect(redeemForBtcMinAmount).to.be.eq(newValue);
        expect(redeemEnabled).to.be.false;
      });

      it('changeRedeemForBtcMinAmount() reverts when called by not an owner', async function () {
        await expect(
          assetRouter.connect(signer2)['changeRedeemForBtcMinAmount(address,uint256)'](signer2, randomBigInt(4))
        )
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer2.address, await assetRouter.DEFAULT_ADMIN_ROLE());
      });

      it('changeTokenConfig() admin can change redeemFee for a token', async function () {
        const token = ethers.Wallet.createRandom().address;
        const redeemFee = randomBigInt(3);
        const redeemForBtcMinAmount = randomBigInt(4);
        await expect(assetRouter.connect(owner).changeTokenConfig(token, redeemFee, redeemForBtcMinAmount, true))
          .to.emit(assetRouter, 'AssetRouter_RedeemFeeChanged')
          .withArgs(token, 0n, redeemFee)
          .and.to.emit(assetRouter, 'AssetRouter_RedeemForBtcMinAmountChanged')
          .withArgs(token, 0n, redeemForBtcMinAmount)
          .and.to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(token, true);

        const [actualRedeemFee, actualRedeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(token);
        expect(actualRedeemFee).to.be.eq(redeemFee);
        expect(actualRedeemForBtcMinAmount).to.be.eq(redeemForBtcMinAmount);
        expect(redeemEnabled).to.be.true;
      });

      it('changeTokenConfig() admin can disable redeem', async function () {
        const token = ethers.Wallet.createRandom().address;
        const redeemFee = randomBigInt(3);
        const redeemForBtcMinAmount = randomBigInt(4);
        await assetRouter.connect(owner).changeTokenConfig(token, redeemFee, redeemForBtcMinAmount, true);

        await expect(assetRouter.connect(owner).changeTokenConfig(token, redeemFee, redeemForBtcMinAmount, false))
          .to.emit(assetRouter, 'AssetRouter_RedeemFeeChanged')
          .withArgs(token, redeemFee, redeemFee)
          .and.to.emit(assetRouter, 'AssetRouter_RedeemForBtcMinAmountChanged')
          .withArgs(token, redeemForBtcMinAmount, redeemForBtcMinAmount)
          .and.to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(token, false);

        const [actualRedeemFee, actualRedeemForBtcMinAmount, redeemEnabled] = await assetRouter.tokenConfig(token);
        expect(actualRedeemFee).to.be.eq(redeemFee);
        expect(actualRedeemForBtcMinAmount).to.be.eq(redeemForBtcMinAmount);
        expect(redeemEnabled).to.be.false;
      });

      it('changeTokenConfig() reverts when called by not admin', async function () {
        await expect(
          assetRouter.connect(signer1).changeTokenConfig(signer1.address, randomBigInt(3), randomBigInt(4), false)
        )
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await assetRouter.DEFAULT_ADMIN_ROLE());
      });
    });

    describe('Route', function () {
      let nativeLbtcBytes2: string;
      const randomAddressBytes = encode(['address'], [ethers.Wallet.createRandom().address]);
      const randomChainId = encode(['uint256'], [randomBigInt(8)]);
      beforeEach(async function () {
        await snapshot.restore();
        nativeLbtcBytes2 = encode(
          ['address'],
          [(await initNativeLBTC(owner.address, treasury.address, consortium.address)).address]
        );
      });

      const args = [
        {
          name: 'set route for deposit to the same chain',
          fromToken: () => nativeLbtcBytes,
          fromChainId: CHAIN_ID,
          toToken: () => stakedLbtcBytes,
          toChainId: CHAIN_ID,
          type: 1
        },
        {
          name: 'set route for deposit to different chain',
          fromToken: () => nativeLbtcBytes,
          fromChainId: CHAIN_ID,
          toToken: () => randomAddressBytes,
          toChainId: randomChainId,
          type: 1
        },
        {
          name: 'set route for redeem to the same chain',
          fromToken: () => stakedLbtcBytes,
          fromChainId: CHAIN_ID,
          toToken: () => nativeLbtcBytes,
          toChainId: CHAIN_ID,
          type: 2
        },
        {
          name: 'set route for redeem to different chain',
          fromToken: () => stakedLbtcBytes,
          fromChainId: CHAIN_ID,
          toToken: () => randomAddressBytes,
          toChainId: randomChainId,
          type: 2
        }
      ];

      args.forEach(function (arg) {
        it(`setRoute() ${arg.name}`, async function () {
          const fromToken = arg.fromToken();
          const toToken = arg.toToken();

          await assetRouter.connect(owner).setRoute(fromToken, arg.fromChainId, toToken, arg.toChainId, arg.type);

          await expect(
            assetRouter.connect(owner).setRoute(fromToken, arg.fromChainId, toToken, arg.toChainId, arg.type)
          )
            .to.emit(assetRouter, 'AssetRouter_RouteSet')
            .withArgs(fromToken, arg.fromChainId, toToken, arg.toChainId, arg.type);

          expect(await assetRouter.getRouteType(fromToken, arg.fromChainId, arg.toChainId, toToken)).to.be.eq(arg.type);
        });
      });

      it('setRoute() can disable route by type 0', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        const type = 0;
        await expect(assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, type))
          .to.emit(assetRouter, 'AssetRouter_RouteSet')
          .withArgs(fromToken, fromChainId, toToken, toChainId, type);

        expect(await assetRouter.getRouteType(fromToken, fromChainId, toChainId, toToken)).to.be.eq(type);
      });

      it('setRoute() reverts when type is invalid', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        const type = 8;
        await expect(assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, type)).to.be
          .reverted;
      });

      it('setRoute() admin can change type', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        const oldType = 1;
        const newType = 2;
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, oldType);
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, newType);

        expect(await assetRouter.getRouteType(fromToken, fromChainId, toChainId, toToken)).to.be.eq(newType);
      });

      it('setRoute() reverts when fromChain already has native token', async function () {
        const fromToken = nativeLbtcBytes2;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, 1);
        await expect(
          assetRouter.connect(owner).setRoute(nativeLbtcBytes, fromChainId, toToken, toChainId, 1)
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_WrongNativeToken');
      });

      it('setRoute() reverts when toChain already has native token', async function () {
        const fromToken = nativeLbtcBytes2;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, 1);
        await expect(
          assetRouter.connect(owner).setRoute(toToken, toChainId, nativeLbtcBytes, fromChainId, 2)
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_WrongNativeToken');
      });

      it('setRoute() reverts when called by not an owner', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        await expect(assetRouter.connect(signer1).setRoute(fromToken, fromChainId, toToken, toChainId, 1))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });

      it('removeRoute() remove route for deposit', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        const type = 1;
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, type);
        expect(await assetRouter.getRouteType(fromToken, fromChainId, toChainId, toToken)).to.be.eq(type);

        await expect(assetRouter.connect(owner).removeRoute(fromToken, fromChainId, toToken, toChainId))
          .to.emit(assetRouter, 'AssetRouter_RouteRemoved')
          .withArgs(fromToken, fromChainId, toToken, toChainId);
        expect(await assetRouter.getRouteType(fromToken, fromChainId, toChainId, toToken)).to.be.eq(0n);
      });

      it('removeRoute() reverts when called by not an owner', async function () {
        const fromToken = nativeLbtcBytes;
        const fromChainId = CHAIN_ID;
        const toToken = randomAddressBytes;
        const toChainId = randomChainId;
        const type = 1;
        await assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, type);
        expect(await assetRouter.getRouteType(fromToken, fromChainId, toChainId, toToken)).to.be.eq(type);

        await expect(assetRouter.connect(signer1).removeRoute(fromToken, fromChainId, toToken, toChainId))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });
    });
  });

  describe('Minting', function () {
    before(async function () {
      await snapshot.restore();
    });

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
          const tx = await assetRouter.connect(sender).mint(payload, proof);
          await expect(tx).to.emit(stakedLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, recipient, amount);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });
      });

      it(`mint() when bascule is enabled`, async function () {
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
          const body = getPayloadForAction([stakedLbtcBytes, encode(['address'], [recipient]), amount], MINT_SELECTOR);
          const payload = getGMPPayload(
            LEDGER_MAILBOX,
            LEDGER_CHAIN_ID,
            arg.chainId,
            Number(randomBigInt(8)),
            BTC_STAKING_MODULE_ADDRESS,
            assetRouterBytes,
            assetRouterBytes,
            body
          );
          const { proof } = await signPayload(arg.signers(), arg.signatures, payload);
          await expect(assetRouter.mint(payload, proof))
            //@ts-ignore
            .to.revertedWithCustomError(...arg.customError());
        });
      });

      //TODO: BASCULE DOES NOT CHECK DEPOSITS WHEN ENABLED
      it('mint() reverts when not reported to bascule', async function () {
        this.skip();
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());

        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await assetRouter.connect(signer1).mint(payload, proof);
        // @ts-ignore
        // await expect(stakedLbtc.connect(signer1)['mint(bytes,bytes)'](payloadHash, proof)).to.be.revertedWithCustomError(
        //   bascule,
        //   'WithdrawalFailedValidation'
        // );
      });

      it('mint() reverts when payload has been used', async function () {
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await assetRouter.connect(signer1).mint(payload, proof);
        // @ts-ignore
        await expect(
          assetRouter.connect(signer1).mint(payload, proof, { gasLimit: 500_000n })
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_MintProcessingError');
      });

      it('mint() reverts when paused', async function () {
        await stakedLbtc.connect(pauser).pause();
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(assetRouter.connect(signer1).mint(payload, proof)).to.be.revertedWithCustomError(
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
            await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, fee.max);
            const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;
            const feeApprovalPayload = getPayloadForAction([fee.approved, snapshotTimestamp + DAY], 'feeApproval');
            const userSignature = await getFeeTypedMessage(
              recipient,
              stakedLbtc,
              fee.approved,
              snapshotTimestamp + DAY
            );

            // @ts-ignore
            const tx = await assetRouter
              .connect(claimer)
              .mintWithFee(payload, proof, feeApprovalPayload, userSignature);
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
        await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        for (let i = 0; i < 10; i++) {
          await time.increase(3600);
          const amount = randomBigInt(8);
          const { payload, proof } = await defaultData(recipient, amount);
          // @ts-ignore
          const tx = await assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
        }
      });

      it('mintWithFee() when bascule enabled', async function () {
        this.skip();
        await stakedLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await stakedLbtc.totalSupply();

        // new
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, feeMax);
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
        const tx = await assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature);
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
          assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(assetRouter, 'UserSignatureExpired')
          .withArgs(snapshotTimestamp);
      });

      it('mintWithFee() reverts when mint payload type is invalid', async function () {
        const { feeApprovalPayload, userSignature } = await defaultData();
        await expect(
          // @ts-ignore
          assetRouter.connect(claimer).mintWithFee(feeApprovalPayload, userSignature, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(mailbox, 'GMP_InvalidAction')
          .withArgs(GMP_V1_SELECTOR, FEE_APPROVAL_ACTION);
      });

      it('mintWithFee() reverts when fee payload type is invalid', async function () {
        const { payload, proof } = await defaultData();
        await expect(
          // @ts-ignore
          assetRouter.connect(claimer).mintWithFee(payload, proof, payload, proof)
        )
          .to.revertedWithCustomError(assetRouter, 'InvalidAction')
          .withArgs(FEE_APPROVAL_ACTION, GMP_V1_SELECTOR);
      });

      //TODO: should revert
      it('mintWithFee() reverts when called by not a claimer', async function () {
        await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, 1000n);
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData();
        // @ts-ignore
        await expect(assetRouter.connect(signer1).mintWithFee(payload, proof, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await assetRouter.CLAIMER_ROLE());
      });

      it('mintWithFee() reverts when mint amount equals fee', async function () {
        const amount = randomBigInt(3);
        const fee = amount + 1n;
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData(signer1, amount, fee);
        await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, fee);
        await expect(
          // @ts-ignore
          assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'AssetRouter_FeeGreaterThanAmount');
      });

      it('mintWithFee() reverts when fee approve signed by other account', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(claimer, stakedLbtc, 1, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
      });

      it('mintWithFee() reverts when fee signature doesnt match payload', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(signer1, stakedLbtc, 2, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          assetRouter.connect(claimer).mintWithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(assetRouter, 'InvalidFeeApprovalSignature');
      });
    });

    describe('Batch mint', function () {
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
          const tx = await assetRouter
            .connect(signer1)
            .batchMint([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() skips used payloads', async function () {
          const tx = await assetRouter
            .connect(signer1)
            .batchMint(
              [data1.payload, data1.payload, data2.payload, data2.payload],
              [data1.proof, data1.proof, data2.proof, data2.proof]
            );
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
            assetRouter
              .connect(signer1)
              .batchMint([data1.payload, data2.payload, payload], [data1.proof, data2.proof, proof])
          ).to.be.reverted;
        });

        it('batchMint() reverts when there is less payloads than proofs', async function () {
          await expect(
            assetRouter.connect(signer1).batchMint([data1.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when there is more payloads than proofs', async function () {
          await expect(
            assetRouter.connect(signer1).batchMint([data1.payload, data2.payload], [data1.proof])
          ).to.be.revertedWithCustomError(stakedLbtc, 'NonEqualLength');
        });

        it('batchMint() emits error when token is on pause', async function () {
          await stakedLbtc.connect(pauser).pause();

          let tx = await assetRouter
            .connect(signer1)
            .batchMint([data1.payload, data2.payload], [data1.proof, data2.proof]);
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data1.payloadHash, '', '0x');
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data2.payloadHash, '', '0x');

          await stakedLbtc.connect(owner).unpause();
          tx = await assetRouter.connect(signer1).batchMint([data1.payload, data2.payload], [data1.proof, data2.proof]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1, amount2]);
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
          await assetRouter.connect(operator).setMaxMintCommission(stakedLbtc.address, maxFee);
          data1 = await defaultData(signer1, amount1, maxFee + 1n);
          data2 = await defaultData(signer2, amount2, maxFee + 1n);
          data3 = await defaultData(signer3, amount3, maxFee + 1n);
        });

        it('batchMintWithFee() claimer can mint many payloads with fee', async function () {
          const tx = await assetRouter.connect(claimer).batchMintWithFee(
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
          const tx = await assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(claimer).batchMintWithFee(
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
            assetRouter.connect(signer1).batchMintWithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          )
            .to.revertedWithCustomError(assetRouter, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, await assetRouter.CLAIMER_ROLE());
        });

        it('batchMintWithFee() emits error when token is on pause', async function () {
          await stakedLbtc.connect(pauser).pause();

          let tx = await assetRouter.connect(claimer).batchMintWithFee(
            //@ts-ignore
            [data1.payload, data2.payload, data3.payload],
            [data1.proof, data2.proof, data3.proof],
            [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
            [data1.userSignature, data2.userSignature, data3.userSignature]
          );
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data1.payloadHash, '', '0x');
          await expect(tx).to.emit(assetRouter, 'AssetRouter_BatchMintError').withArgs(data2.payloadHash, '', '0x');

          await stakedLbtc.connect(owner).unpause();
          tx = await assetRouter.connect(signer1).batchMint([data1.payload, data2.payload], [data1.proof, data2.proof]);
          await expect(tx).changeTokenBalances(stakedLbtc, [signer1, signer2], [amount1, amount2]);
        });
      });
    });
  });

  describe('Redeem for BTC', function () {
    describe('Positive cases', function () {
      let nonce = 1;
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
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
          expectedAmount: 1000_000n,
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
          expectedAmount: randomBigInt(8),
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
        it(`redeemForBtc() stakedLBTC ${arg.name}`, async () => {
          await stakedLbtc.connect(owner).changeRedeemFee(arg.redeemFee);
          await assetRouter.connect(owner).changeToNativeCommission(stakedLbtc.address, arg.toNativeFee);
          await ratioFeed.setRatio(arg.ratio);

          // const redeemAmount = arg.expectedAmount + arg.redeemFee + (arg.toNativeFee * arg.ratio) / e18;
          const redeemAmount = arg.expectedAmount + arg.redeemFee + arg.toNativeFee;
          const { amountAfterFee } = await assetRouter.calcUnstakeRequestAmount(
            stakedLbtc.address,
            arg.scriptPubKey,
            redeemAmount
          );

          //Burn previous balance
          const balance = await stakedLbtc.balanceOf(signer1);
          await stakedLbtc.connect(signer1)['burn(uint256)'](balance);
          expect(await stakedLbtc.balanceOf(signer1)).to.be.eq(0n);

          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, arg.balance(redeemAmount));
          const totalSupplyBefore = await stakedLbtc.totalSupply();
          const totalFee = redeemAmount - amountAfterFee;

          const body = getPayloadForAction(
            [
              BITCOIN_CHAIN_ID,
              stakedLbtcBytes,
              encode(['address'], [signer1.address]),
              arg.scriptPubKey,
              amountAfterFee
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

          const tx = assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, stakedLbtc.address, arg.scriptPubKey, redeemAmount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, -redeemAmount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, totalFee);
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(redeemAmount - totalFee);
        });

        it(`redeemForBtc() nativeLBTC ${arg.name}`, async () => {
          await assetRouter.connect(owner).changeToNativeCommission(nativeLbtc.address, arg.toNativeFee);
          await ratioFeed.setRatio(arg.ratio);

          const redeemAmount = arg.expectedAmount + arg.toNativeFee;
          const { amountAfterFee } = await assetRouter.calcUnstakeRequestAmount(
            nativeLbtc.address,
            arg.scriptPubKey,
            redeemAmount
          );

          //Burn previous balance
          const balance = await nativeLbtc.balanceOf(signer1);
          await nativeLbtc.connect(signer1)['burn(uint256)'](balance);
          expect(await nativeLbtc.balanceOf(signer1)).to.be.eq(0n);

          await nativeLbtc.connect(minter).mint(signer1.address, arg.balance(redeemAmount));
          const totalSupplyBefore = await nativeLbtc.totalSupply();

          const body = getPayloadForAction(
            [encode(['address'], [signer1.address]), arg.scriptPubKey, amountAfterFee],
            REDEEM_FROM_NATIVE_TOKEN_SELECTOR
          );
          const payload = getGMPPayload(
            encode(['address'], [mailbox.address]),
            CHAIN_ID,
            LEDGER_CHAIN_ID,
            nonce++,
            encode(['address'], [assetRouter.address]),
            ASSETS_MODULE_ADDRESS,
            LEDGER_CALLER,
            body
          );

          const tx = await assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, nativeLbtc.address, arg.scriptPubKey, redeemAmount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, ASSETS_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(nativeLbtc, signer1, -redeemAmount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, arg.toNativeFee);
          const totalSupplyAfter = await nativeLbtc.totalSupply();
          expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(redeemAmount - arg.toNativeFee);
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
          assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, stakedLbtc.address, '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.revertedWithCustomError(assetRouter, 'AssetOperation_RedeemNotAllowed');
      });

      it('redeemForBtc() reverts when amount < toNativeCommission', async function () {
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, randomBigInt(10));

        const redeemFee = 100n;
        const toNativeCommission = 1000n;
        await assetRouter.connect(owner).changeToNativeCommission(stakedLbtc.address, toNativeCommission);
        await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        const amount = toNativeCommission - 1n;

        await expect(
          assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, stakedLbtc.address, '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        )
          .to.be.revertedWithCustomError(assetRouter, 'AmountLessThanCommission')
          .withArgs(toNativeCommission);
      });

      it('redeemForBtc() reverts when amount < redeemFee', async function () {
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, randomBigInt(10));

        const redeemFee = 1000n;
        const toNativeCommission = 100n;
        await assetRouter.connect(owner).changeToNativeCommission(stakedLbtc.address, toNativeCommission);
        await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        const amount = redeemFee - 1n;

        await expect(
          assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, stakedLbtc.address, '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_FeeGreaterThanAmount');
      });

      it('redeemForBtc() reverts when amount is below dust limit', async () => {
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        const toNativeCommission = randomBigInt(3);
        await assetRouter.connect(owner).changeToNativeCommission(stakedLbtc.address, toNativeCommission);

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
        await expect(
          assetRouter
            .connect(signer1)
            .redeemForBtc(signer1.address, stakedLbtc.address, p2wsh, amountJustBelowDustLimit)
        )
          .to.be.revertedWithCustomError(assetRouter, 'AmountBelowMinLimit')
          .withArgs(amountJustBelowDustLimit - toNativeCommission + 1n);
      });

      it('redeemForBtc() reverts with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          assetRouter.connect(signer1).redeemForBtc(signer1.address, stakedLbtc.address, p2sh, amount)
        ).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          assetRouter.connect(signer1).redeemForBtc(signer1.address, stakedLbtc.address, p2pkh, amount)
        ).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          assetRouter.connect(signer1).redeemForBtc(signer1.address, stakedLbtc.address, p2pk, amount)
        ).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });

      it('redeemForBtc() reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          assetRouter.connect(signer1).redeemForBtc(signer1.address, stakedLbtc.address, p2ms, amount)
        ).to.be.revertedWithCustomError(assetRouter, 'ScriptPubkeyUnsupported');
      });
    });
  });

  describe('Redeem for NativeLBTC', function () {
    describe('Redeem to the same chain', function () {
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
          name: 'just 1sat above redeemFee',
          balance: randomBigInt(8),
          amount: (balance: bigint) => redeemFee + 1n
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

          const tx = await assetRouter
            .connect(sender)
            ['redeem(address,address,uint256)'](sender.address, stakedLbtc.address, amount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(stakedLbtc, sender, -amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, redeemFee);
        });
      });

      describe('Negative cases', function () {
        beforeEach(async function () {
          await snapshot.restore();
          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, randomBigInt(8));
          await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 2);
          await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        });

        const invalidArgs = [
          {
            name: 'msgSender is not a fromAddress',
            msgSender: () => signer2,
            fromToken: () => stakedLbtc.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssetRouter_Unauthorized'
          },
          {
            name: 'reverts when amount = redeemFee',
            msgSender: () => signer1,
            fromToken: () => stakedLbtc.address,
            amount: async () => redeemFee,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount < redeemFee',
            msgSender: () => signer1,
            fromToken: () => stakedLbtc.address,
            amount: async () => redeemFee - 1n,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount = 0',
            msgSender: () => signer1,
            fromToken: () => stakedLbtc.address,
            amount: async () => 0n,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount > balance',
            msgSender: () => signer1,
            fromToken: () => stakedLbtc.address,
            amount: async () => (await stakedLbtc.balanceOf(signer1.address)) + 1n,
            errContract: () => stakedLbtc,
            err: 'ERC20InsufficientBalance'
          }
        ];

        invalidArgs.forEach(function (arg) {
          it(`redeem() reverts when ${arg.name}`, async function () {
            const fromToken = arg.fromToken();
            const amount = await arg.amount();
            await expect(
              assetRouter.connect(arg.msgSender())['redeem(address,address,uint256)'](signer1, fromToken, amount)
            ).to.be.revertedWithCustomError(arg.errContract(), arg.err);
          });
        });

        it('redeem() reverts when redeem route is inactive', async function () {
          const sender = signer1;
          const amount = randomBigInt(6);
          await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 0);
          await expect(
            assetRouter.connect(sender)['redeem(address,address,uint256)'](sender.address, stakedLbtc.address, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_RedeemNotAllowed');
        });

        it('redeem() reverts when contract paused', async function () {
          const sender = signer1;
          const amount = randomBigInt(6);
          await stakedLbtc.connect(pauser).pause();
          await expect(
            assetRouter.connect(sender)['redeem(address,address,uint256)'](sender.address, stakedLbtc.address, amount)
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });
    });

    describe('Redeem to any chain', function () {
      const redeemFee = randomBigInt(3);
      let nonce = 1;
      let randomAddressBytes = encode(['address'], [ethers.Wallet.createRandom().address]);
      let randomChainId = encode(['uint256'], [randomBigInt(8)]);
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 2);
        await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, randomAddressBytes, randomChainId, 2);
        await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
      });

      const args = [
        {
          name: 'partially',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance / 2n,
          recipient: () => signer1,
          toToken: () => nativeLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'just 1sat above redeemFee',
          balance: randomBigInt(8),
          amount: (balance: bigint) => redeemFee + 1n,
          recipient: () => signer1,
          toToken: () => nativeLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'all',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance,
          recipient: () => signer1,
          toToken: () => nativeLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'to other address',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance / 2n,
          recipient: () => signer2,
          toToken: () => nativeLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'to different chain',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance / 2n,
          recipient: () => signer1,
          toToken: () => randomAddressBytes,
          toChain: randomChainId
        }
      ];

      args.forEach(function (arg) {
        it(`redeem() ${arg.name}`, async () => {
          const recipient = encode(['address'], [arg.recipient().address]);
          const toToken = arg.toToken();
          const toChain = arg.toChain;
          const sender = signer1;

          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, randomBigInt(8));
          const totalSupplyNativeBefore = await nativeLbtc.totalSupply();
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const balance = await stakedLbtc.balanceOf(sender);
          const amount = arg.amount(balance);
          const expectedAmount = amount - redeemFee;

          const body = getPayloadForAction(
            [toChain, stakedLbtcBytes, encode(['address'], [sender.address]), recipient, expectedAmount],
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

          const tx = await assetRouter
            .connect(sender)
            [
              'redeem(address,bytes32,address,bytes32,bytes32,uint256)'
            ](sender.address, toChain, stakedLbtc.address, toToken, recipient, amount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(stakedLbtc, sender, -amount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, redeemFee);
          const totalSupplyNativeAfter = await nativeLbtc.totalSupply();
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(amount - redeemFee);
          expect(totalSupplyNativeAfter).to.be.eq(totalSupplyNativeBefore);
        });
      });

      describe('Negative cases', function () {
        beforeEach(async function () {
          await snapshot.restore();
          await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1, randomBigInt(8));
          await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 2);
          await stakedLbtc.connect(owner).changeRedeemFee(redeemFee);
        });

        const invalidArgs = [
          {
            name: 'msgSender is not a fromAddress',
            msgSender: () => signer2,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssetRouter_Unauthorized'
          },
          {
            name: 'fromAddress is 0 address',
            msgSender: () => signer2,
            fromAddress: () => ethers.ZeroAddress,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssetRouter_Unauthorized'
          },
          {
            name: 'reverts when amount = redeemFee',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => redeemFee,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount < redeemFee',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => redeemFee - 1n,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount = 0',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => 0n,
            errContract: () => assetRouter,
            err: 'AssetRouter_FeeGreaterThanAmount'
          },
          {
            name: 'reverts when amount > balance',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer2.address,
            amount: async () => (await stakedLbtc.balanceOf(signer1.address)) + 1n,
            errContract: () => stakedLbtc,
            err: 'ERC20InsufficientBalance'
          },
          {
            name: 'reverts when recipient is 0 address',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => ethers.ZeroAddress,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'Assets_ZeroRecipient'
          },
          {
            name: 'reverts when fromToken is unknown',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => ethers.Wallet.createRandom().address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer1.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'NotStakingToken'
          },
          {
            name: 'reverts when toChain is unsupported',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: randomChainId,
            fromToken: () => stakedLbtc.address,
            toToken: () => nativeLbtcBytes,
            recipient: () => signer1.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssetOperation_RedeemNotAllowed'
          },
          {
            name: 'reverts when toToken is unsupported',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => randomAddressBytes,
            recipient: () => signer1.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssetOperation_RedeemNotAllowed'
          },
          {
            name: 'reverts when toChain is Bitcoin chain',
            msgSender: () => signer1,
            fromAddress: () => signer1.address,
            toChainId: BITCOIN_CHAIN_ID,
            fromToken: () => stakedLbtc.address,
            toToken: () => randomAddressBytes,
            recipient: () => signer1.address,
            amount: async () => randomBigInt(6),
            errContract: () => assetRouter,
            err: 'AssertRouter_WrongRedeemDestinationChain'
          }
        ];

        invalidArgs.forEach(function (arg) {
          it(`redeem() reverts when ${arg.name}`, async function () {
            const fromToken = arg.fromToken();
            const toToken = arg.toToken();
            const recipient = encode(['address'], [arg.recipient()]);
            const amount = await arg.amount();
            await expect(
              assetRouter
                .connect(arg.msgSender())
                [
                  'redeem(address,bytes32,address,bytes32,bytes32,uint256)'
                ](arg.fromAddress(), arg.toChainId, fromToken, toToken, recipient, amount)
            ).to.be.revertedWithCustomError(arg.errContract(), arg.err);
          });
        });

        it('redeem() reverts when redeem route is inactive', async function () {
          const sender = signer1;
          const amount = randomBigInt(6);
          const recipient = encode(['address'], [sender.address]);
          await assetRouter.connect(owner).setRoute(stakedLbtcBytes, CHAIN_ID, nativeLbtcBytes, CHAIN_ID, 0);
          await expect(
            assetRouter
              .connect(sender)
              [
                'redeem(address,bytes32,address,bytes32,bytes32,uint256)'
              ](sender.address, CHAIN_ID, stakedLbtc.address, nativeLbtcBytes, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_RedeemNotAllowed');
        });

        it('redeem() reverts when contract paused', async function () {
          const sender = signer1;
          const amount = randomBigInt(6);
          const recipient = encode(['address'], [sender.address]);
          await stakedLbtc.connect(pauser).pause();
          await expect(
            assetRouter
              .connect(sender)
              [
                'redeem(address,bytes32,address,bytes32,bytes32,uint256)'
              ](sender.address, CHAIN_ID, stakedLbtc.address, nativeLbtcBytes, recipient, amount)
          ).to.be.revertedWithCustomError(stakedLbtc, 'EnforcedPause');
        });
      });
    });
  });

  describe('Deposit NativeLBTC', function () {
    describe('Deposit to the same chain', function () {
      let nonce = 1;
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
        await nativeLbtc.connect(minter).mint(signer1, randomBigInt(8));
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
          const totalSupplyNativeBefore = await nativeLbtc.totalSupply();
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const sender = signer1;
          const balance = await nativeLbtc.balanceOf(sender);
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
            nonce++,
            encode(['address'], [assetRouter.address]),
            BTC_STAKING_MODULE_ADDRESS,
            LEDGER_CALLER,
            body
          );

          const tx = await assetRouter
            .connect(sender)
            ['deposit(address,address,uint256)'](sender.address, stakedLbtc.address, amount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(nativeLbtc, sender, -amount);

          const totalSupplyNativeAfter = await nativeLbtc.totalSupply();
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyNativeBefore - totalSupplyNativeAfter).to.be.eq(amount);
          expect(totalSupplyAfter).to.be.eq(totalSupplyBefore);
        });
      });

      describe('Negative cases', function () {
        beforeEach(async function () {
          await snapshot.restore();
          await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
          await nativeLbtc.connect(minter).mint(signer1, randomBigInt(8));
        });
        it('deposit() reverts when msgSender is not a fromAddress', async function () {
          const amount = randomBigInt(6);
          await expect(
            assetRouter
              .connect(signer2)
              ['deposit(address,address,uint256)'](signer1.address, stakedLbtc.address, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetRouter_Unauthorized');
        });

        it('deposit() reverts when amount is 0', async function () {
          await expect(
            assetRouter.connect(signer1)['deposit(address,address,uint256)'](signer1.address, stakedLbtc.address, 0n)
          ).to.be.revertedWithCustomError(assetRouter, 'Assets_ZeroAmount');
        });

        it('deposit() reverts when amount greater than balance', async function () {
          const balance = await nativeLbtc.balanceOf(signer1);
          const amount = balance + 1n;
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(address,address,uint256)'](signer1.address, stakedLbtc.address, amount)
          )
            .to.be.revertedWithCustomError(nativeLbtc, 'ERC20InsufficientBalance')
            .withArgs(signer1.address, balance, amount);
        });

        it('deposit() reverts when deposit route is inactive', async function () {
          await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 0);
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(address,address,uint256)'](signer1.address, stakedLbtc.address, randomBigInt(6))
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_DepositNotAllowed');
        });

        it('deposit() reverts when nativeLBTC paused', async function () {
          await nativeLbtc.connect(pauser).pause();
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(address,address,uint256)'](signer1.address, stakedLbtc.address, randomBigInt(6))
          ).to.be.revertedWithCustomError(nativeLbtc, 'EnforcedPause');
        });
      });
    });

    describe('Deposit to any chain', function () {
      let nonce = 1;
      let randomAddressBytes = encode(['address'], [ethers.Wallet.createRandom().address]);
      let randomChainId = encode(['uint256'], [randomBigInt(8)]);
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, randomAddressBytes, randomChainId, 1);
        await nativeLbtc.connect(minter).mint(signer1, randomBigInt(8));
      });

      const args = [
        {
          name: 'partially',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance / 2n,
          recipient: () => signer1,
          toToken: () => stakedLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'all',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance,
          recipient: () => signer1,
          toToken: () => stakedLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'to other address',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance,
          recipient: () => signer2,
          toToken: () => stakedLbtcBytes,
          toChain: CHAIN_ID
        },
        {
          name: 'to other address to the different chain',
          balance: randomBigInt(8),
          amount: (balance: bigint) => balance,
          recipient: () => signer2,
          toToken: () => randomAddressBytes,
          toChain: randomChainId
        }
      ];

      args.forEach(function (arg) {
        it(`deposit(bytes32,bytes32,bytes32,uint256) ${arg.name}`, async () => {
          const sender = signer1;
          const recipient = encode(['address'], [arg.recipient().address]);
          await nativeLbtc.connect(minter).mint(signer1.address, randomBigInt(8));
          const balance = await nativeLbtc.balanceOf(sender);
          const amount = arg.amount(balance);

          const totalSupplyNativeBefore = await nativeLbtc.totalSupply();
          const totalSupplyBefore = await stakedLbtc.totalSupply();

          const toChain = arg.toChain;
          const toToken = arg.toToken();
          const body = getPayloadForAction(
            [toChain, toToken, encode(['address'], [sender.address]), recipient, amount],
            DEPOSIT_REQUEST_SELECTOR
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

          const tx = await assetRouter
            .connect(sender)
            ['deposit(bytes32,bytes32,bytes32,uint256)'](toChain, toToken, recipient, amount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, BTC_STAKING_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(nativeLbtc, sender, -amount);

          const totalSupplyNativeAfter = await nativeLbtc.totalSupply();
          const totalSupplyAfter = await stakedLbtc.totalSupply();
          expect(totalSupplyNativeBefore - totalSupplyNativeAfter).to.be.eq(amount);
          expect(totalSupplyAfter).to.be.eq(totalSupplyBefore);
        });
      });

      describe('Negative cases', function () {
        beforeEach(async function () {
          await snapshot.restore();
          await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, stakedLbtcBytes, CHAIN_ID, 1);
          await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, randomAddressBytes, randomChainId, 1);
          await nativeLbtc.connect(minter).mint(signer1, randomBigInt(8));
        });

        it('deposit() reverts when amount is 0', async function () {
          const toChain = CHAIN_ID;
          const toToken = stakedLbtcBytes;
          const recipient = encode(['address'], [signer1.address]);
          const amount = 0n;
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChain, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'Assets_ZeroAmount');
        });

        it('deposit() reverts when recipient is 0 address', async function () {
          const toChain = CHAIN_ID;
          const toToken = stakedLbtcBytes;
          const recipient = encode(['address'], [ethers.ZeroAddress]);
          const amount = randomBigInt(6);
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChain, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'Assets_ZeroRecipient');
        });

        it('deposit() reverts when amount greater than balance', async function () {
          const toChain = CHAIN_ID;
          const toToken = stakedLbtcBytes;
          const recipient = encode(['address'], [signer1.address]);
          const balance = await nativeLbtc.balanceOf(signer1);
          const amount = balance + 1n;
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChain, toToken, recipient, amount)
          )
            .to.be.revertedWithCustomError(nativeLbtc, 'ERC20InsufficientBalance')
            .withArgs(signer1.address, balance, amount);
        });

        it('deposit() reverts when deposit route is inactive', async function () {
          const fromToken = nativeLbtcBytes;
          const fromChainId = CHAIN_ID;
          const toToken = stakedLbtcBytes;
          const toChainId = CHAIN_ID;
          const type = 0;
          const recipient = encode(['address'], [signer1.address]);
          const amount = randomBigInt(6);

          await expect(assetRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId, type))
            .to.emit(assetRouter, 'AssetRouter_RouteSet')
            .withArgs(fromToken, fromChainId, toToken, toChainId, type);

          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChainId, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_DepositNotAllowed');
        });

        it('deposit() reverts when toToken is unknown', async function () {
          const toChainId = CHAIN_ID;
          const toToken = randomAddressBytes;
          const recipient = encode(['address'], [signer1.address]);
          const amount = randomBigInt(6);

          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChainId, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_DepositNotAllowed');
        });

        it('deposit() reverts when toChain is unknown', async function () {
          const toChainId = randomChainId;
          const toToken = stakedLbtcBytes;
          const recipient = encode(['address'], [signer1.address]);
          const amount = randomBigInt(6);

          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChainId, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(assetRouter, 'AssetOperation_DepositNotAllowed');
        });

        it('deposit() reverts when nativeLBTC paused', async function () {
          const toChainId = CHAIN_ID;
          const toToken = stakedLbtcBytes;
          const recipient = encode(['address'], [signer1.address]);
          const amount = randomBigInt(6);
          await nativeLbtc.connect(pauser).pause();
          await expect(
            assetRouter
              .connect(signer1)
              ['deposit(bytes32,bytes32,bytes32,uint256)'](toChainId, toToken, recipient, amount)
          ).to.be.revertedWithCustomError(nativeLbtc, 'EnforcedPause');
        });
      });
    });
  });

  describe('GMP', function () {
    describe('Handle payload', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      const invalidArgs = [
        {
          name: 'called by not a mailbox',
          mailbox: () => signer2,
          bodySelector: MINT_SELECTOR,
          tokenAddress: () => stakedLbtc.address,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          customError: () => [assetRouter, 'AssetRouter_MailboxExpected']
        },
        {
          name: 'invalid message prefix',
          mailbox: () => signer1,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          tokenAddress: () => stakedLbtc.address,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          bodySelector: DEPOSIT_BTC_ACTION_V1,
          customError: () => [assetRouter, 'Assets_InvalidSelector']
        },
        {
          name: 'token is 0 address',
          mailbox: () => signer1,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          tokenAddress: () => ethers.ZeroAddress,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          bodySelector: MINT_SELECTOR,
          customError: () => [assetRouter, 'Assets_ZeroToToken']
        },
        {
          name: 'token recipient is 0 address',
          mailbox: () => signer1,
          bodySelector: MINT_SELECTOR,
          tokenAddress: () => stakedLbtc.address,
          tokenRecipient: () => ethers.ZeroAddress,
          amount: randomBigInt(8),
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          customError: () => [assetRouter, 'Assets_ZeroRecipient']
        },
        {
          name: 'token amount is 0',
          mailbox: () => signer1,
          bodySelector: MINT_SELECTOR,
          tokenAddress: () => stakedLbtc.address,
          tokenRecipient: () => signer1.address,
          amount: 0n,
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          customError: () => [assetRouter, 'Assets_ZeroAmount']
        },
        {
          name: 'unknown sender from ledger',
          mailbox: () => signer1,
          bodySelector: MINT_SELECTOR,
          tokenAddress: () => stakedLbtc.address,
          tokenRecipient: () => signer1.address,
          amount: randomBigInt(8),
          msgSender: encode(['uint256'], [randomBigInt(16)]),
          customError: () => [assetRouter, 'AssetRouter_WrongSender']
        }
        // {
        //   name: 'valid',
        //   mailbox: () => signer1,
        //   bodySelector: MINT_SELECTOR,
        //   tokenAddress: () => stakedLbtc.address,
        //   tokenRecipient: () => signer1.address,
        //   amount: randomBigInt(8),
        //   msgSender: BTC_STAKING_MODULE_ADDRESS,
        //   customError: () => [assetRouter, 'Mailbox_MessagePathDisabled']
        // }
      ];

      invalidArgs.forEach(function (arg) {
        it(`handlePayload() reverts when ${arg.name}`, async function () {
          await assetRouter.connect(owner).changeMailbox(signer1);
          const recipient = arg.tokenRecipient();
          const amount = arg.amount;
          let body = getPayloadForAction(
            [encode(['address'], [arg.tokenAddress()]), encode(['address'], [recipient]), amount],
            MINT_SELECTOR
          );
          body = body.replace(MINT_SELECTOR, arg.bodySelector);
          const nonce = randomBigInt(8);
          const rawPayload = getGMPPayload(
            LEDGER_MAILBOX,
            LEDGER_CHAIN_ID,
            CHAIN_ID,
            nonce,
            arg.msgSender,
            assetRouterBytes,
            assetRouterBytes,
            body
          );
          const payload: GMPUtils.PayloadStruct = {
            id: Buffer.from(ethers.sha256(rawPayload).replace('0x', ''), 'hex'),
            msgPath: ethers.keccak256(
              encode(['bytes32', 'bytes32', 'bytes32'], [LEDGER_MAILBOX, LEDGER_CHAIN_ID, CHAIN_ID])
            ),
            msgNonce: nonce,
            msgSender: Buffer.from(arg.msgSender.replace('0x', ''), 'hex'),
            msgRecipient: assetRouter.address,
            msgDestinationCaller: assetRouter.address,
            msgBody: Buffer.from(body.replace('0x', ''), 'hex')
          };

          await expect(assetRouter.connect(arg.mailbox()).handlePayload(payload))
            //@ts-ignore
            .to.revertedWithCustomError(...arg.customError());
        });
      });
    });
  });
});
