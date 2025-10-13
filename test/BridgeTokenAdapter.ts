import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  ASSETS_MODULE_ADDRESS,
  BITCOIN_CHAIN_ID,
  BITCOIN_NATIVE_COIN,
  BTC_STAKING_MODULE_ADDRESS,
  calculateStorageSlot,
  CHAIN_ID,
  DefaultData,
  deployContract,
  DEPOSIT_BTC_ACTION_V0,
  DEPOSIT_BTC_ACTION_V1,
  e18,
  encode,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  LEDGER_CALLER,
  LEDGER_CHAIN_ID,
  LEDGER_MAILBOX,
  MINT_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  rawSign,
  REDEEM_FROM_NATIVE_TOKEN_SELECTOR,
  signDepositBtcV0Payload,
  signDepositBtcV1Payload,
  Signer,
  signPayload
} from './helpers';
import {
  AssetRouter,
  BasculeV3,
  Consortium,
  Mailbox,
  BridgeTokenAdapter,
  RatioFeedMock,
  BridgeTokenMock,
  BridgeV2
} from '../typechain-types';
import { GMPUtils } from '../typechain-types/contracts/gmp/IHandler';
import { Addressable as EthersAddressable, BytesLike } from 'ethers';

const REDEEM_FOR_BTC_MIN_AMOUNT = randomBigInt(4);

const reverseTxid = (txid: BytesLike) => {
  const nonPrefixed = txid.toString().replace('0x', '');
  let res = '';
  for (let i = nonPrefixed.length; i > 0; i -= 2) {
    res += nonPrefixed.slice(i - 2, i);
  }

  return '0x' + res;
};

describe('BridgeTokenAdapter', function () {
  let _: Signer,
    owner: Signer,
    treasury: Signer,
    operator: Signer,
    minter: Signer,
    pauser: Signer,
    reporter: Signer,
    notary1: Signer,
    notary2: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    trustedSigner: Signer;
  let bridgeTokenAdapter: BridgeTokenAdapter & Addressable;
  let bridgeTokenAdapterBytes: string;
  let bascule: BasculeV3;
  let snapshot: SnapshotRestorer;
  let consortium: Consortium & Addressable;
  const toNativeCommission = 1000;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let bridgeToken: BridgeTokenMock;
  let assetRouterBytes: string;

  before(async function () {
    [
      _,
      owner,
      treasury,
      operator,
      minter,
      pauser,
      reporter,
      notary1,
      notary2,
      signer1,
      signer2,
      signer3,
      trustedSigner
    ] = await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(
        getPayloadForAction([1, [notary1.publicKey, notary2.publicKey], [1, 1], 2, 1], NEW_VALSET)
      );

    bridgeToken = await deployContract<BridgeTokenMock>('BridgeTokenMock', [], false);
    bridgeTokenAdapter = await deployContract<BridgeTokenAdapter & Addressable>('BridgeTokenAdapter', [
      await consortium.getAddress(),
      treasury.address,
      owner.address,
      0n, //owner delay
      await bridgeToken.getAddress()
    ]);
    await bridgeToken.migrateBridgeRole(bridgeTokenAdapter);
    bridgeTokenAdapter.address = await bridgeTokenAdapter.getAddress();
    bridgeTokenAdapterBytes = encode(['address'], [bridgeTokenAdapter.address]);

    // Roles
    await bridgeTokenAdapter.connect(owner).grantRole(await bridgeTokenAdapter.MINTER_ROLE(), minter);
    await bridgeTokenAdapter.connect(owner).grantRole(await bridgeTokenAdapter.PAUSER_ROLE(), pauser);

    bascule = await deployContract<BasculeV3>(
      'BasculeV3',
      [owner.address, pauser.address, reporter.address, bridgeTokenAdapter.address, 100, trustedSigner.address],
      false
    );

    // Mailbox
    mailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    mailbox.address = await mailbox.getAddress();
    await mailbox.connect(owner).grantRole(await mailbox.TREASURER_ROLE(), treasury);
    await mailbox.connect(owner).grantRole(await mailbox.PAUSER_ROLE(), pauser);
    await mailbox.connect(owner).enableMessagePath(LEDGER_CHAIN_ID, LEDGER_MAILBOX, 3);

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
    assetRouterBytes = encode(['address'], [await assetRouter.getAddress()]);
    await assetRouter.connect(owner).changeOracle(bridgeTokenAdapter.address, ratioFeed.address);
    await assetRouter.connect(owner).changeToNativeCommission(bridgeTokenAdapter.address, toNativeCommission);
    assetRouter.address = await assetRouter.getAddress();
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);
    await assetRouter.connect(owner).grantRole(await assetRouter.CLAIMER_ROLE(), bridgeTokenAdapter.address);
    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 500, true);
    await bridgeTokenAdapter.connect(owner).changeAssetRouter(assetRouter.address);
    await bridgeTokenAdapter.connect(owner).grantRole(await bridgeTokenAdapter.MINTER_ROLE(), assetRouter.address);

    await assetRouter
      .connect(owner)
      ['changeRedeemForBtcMinAmount(address,uint256)'](bridgeTokenAdapter.address, REDEEM_FOR_BTC_MIN_AMOUNT);

    snapshot = await takeSnapshot();
  });

  it('Verify storage slot and consortium inside', async () => {
    const slot = calculateStorageSlot('lombardfinance.storage.BridgeTokenAdapter');
    const storage = await ethers.provider.getStorage(bridgeTokenAdapter, slot);
    expect(storage).to.be.eq(encode(['address'], [consortium.address]));
  });

  describe('Setters and getters', function () {
    describe('View functions', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('owner()', async function () {
        expect(await bridgeTokenAdapter.owner()).to.equal(owner.address);
      });

      it('getTreasury()', async function () {
        expect(await bridgeTokenAdapter.getTreasury()).to.equal(treasury.address);
      });

      it('getConsortium()', async function () {
        expect(await bridgeTokenAdapter.getConsortium()).to.equal(await consortium.getAddress());
      });

      it('getBascule() is not set by default', async function () {
        expect(await bridgeTokenAdapter.getBascule()).to.be.equal(ethers.ZeroAddress);
      });

      it('isNative() true', async function () {
        expect(await bridgeTokenAdapter.isNative()).to.be.true;
      });
    });

    describe('Pause', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('Adapter is not paused by default', async function () {
        expect(await bridgeTokenAdapter.paused()).to.be.false;
      });

      it('pause() pauser can set on pause', async function () {
        await expect(bridgeTokenAdapter.connect(pauser).pause())
          .to.emit(bridgeTokenAdapter, 'Paused')
          .withArgs(pauser.address);
        expect(await bridgeTokenAdapter.paused()).to.be.true;
      });

      it('changePauser() owner can change pauser', async function () {
        const newPauser = signer1;
        await expect(bridgeTokenAdapter.connect(owner).grantRole(await bridgeTokenAdapter.PAUSER_ROLE(), newPauser))
          .to.emit(bridgeTokenAdapter, 'RoleGranted')
          .withArgs(await bridgeTokenAdapter.PAUSER_ROLE(), newPauser.address, owner.address);
        await bridgeTokenAdapter.connect(signer1).pause();
      });

      it('pause() reverts when called by not an pauser', async function () {
        await expect(bridgeTokenAdapter.connect(owner).pause())
          .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
          .withArgs(owner.address, await bridgeTokenAdapter.PAUSER_ROLE());
      });

      it('unpause() turns off enforced pause', async function () {
        await bridgeTokenAdapter.connect(pauser).pause();
        expect(await bridgeTokenAdapter.paused()).to.be.true;

        await expect(bridgeTokenAdapter.connect(owner).unpause())
          .to.emit(bridgeTokenAdapter, 'Unpaused')
          .withArgs(owner.address);
        expect(await bridgeTokenAdapter.paused()).to.be.false;
      });

      it('unpause() reverts when called by not an owner', async function () {
        await bridgeTokenAdapter.connect(pauser).pause();
        expect(await bridgeTokenAdapter.paused()).to.be.true;

        await expect(bridgeTokenAdapter.connect(pauser).unpause())
          .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
          .withArgs(pauser.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });
    });

    describe('Roles management', function () {
      let newRole: Signer;

      before(async function () {
        await snapshot.restore();
        newRole = signer1;
      });

      const roles = [
        {
          name: 'Pauser',
          role: async () => await bridgeTokenAdapter.PAUSER_ROLE(),
          defaultAccount: () => pauser
        },
        {
          name: 'Minter',
          role: async () => await bridgeTokenAdapter.MINTER_ROLE(),
          defaultAccount: () => minter
        }
      ];

      roles.forEach(function (role) {
        it(`${role.name}: hasRole is false by default`, async function () {
          expect(await bridgeTokenAdapter.hasRole(await role.role(), newRole.address)).to.be.false;
        });

        it(`${role.name}: grantRole() owner can assign new ${role.name}`, async function () {
          await expect(bridgeTokenAdapter.connect(owner).grantRole(await role.role(), newRole.address))
            .to.emit(bridgeTokenAdapter, 'RoleGranted')
            .withArgs(await role.role(), newRole.address, owner.address);
          expect(await bridgeTokenAdapter.hasRole(await role.role(), newRole.address)).to.be.true;
        });

        it(`${role.name}: there could be more than one ${role.name}`, async function () {
          expect(await bridgeTokenAdapter.hasRole(await role.role(), role.defaultAccount())).to.be.true;
        });

        it(`${role.name}: revokeRole() owner can revoke role`, async function () {
          await expect(bridgeTokenAdapter.connect(owner).revokeRole(await role.role(), newRole.address))
            .to.emit(bridgeTokenAdapter, 'RoleRevoked')
            .withArgs(await role.role(), newRole.address, owner.address);
          expect(await bridgeTokenAdapter.hasRole(await role.role(), newRole.address)).to.be.false;
        });

        it(`${role.name} other accounts not affected`, async function () {
          expect(await bridgeTokenAdapter.hasRole(await role.role(), role.defaultAccount())).to.be.true;
        });
      });

      it('grantRole() reverts when called by not an owner', async function () {
        await expect(bridgeTokenAdapter.connect(signer1).grantRole(await bridgeTokenAdapter.PAUSER_ROLE(), signer1))
          .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });

      it('revokeRole() reverts when called by not an owner', async function () {
        await expect(bridgeTokenAdapter.connect(signer1).revokeRole(await bridgeTokenAdapter.PAUSER_ROLE(), pauser))
          .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });

      const values = [
        {
          name: 'AssetRouter',
          setter: 'changeAssetRouter',
          getter: 'getAssetRouter',
          event: 'AssetRouterChanged',
          defaultAccount: () => assetRouter.address,
          canBeZero: true
        },
        {
          name: 'Bascule',
          setter: 'changeBascule',
          getter: 'getBascule',
          event: 'BasculeChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        },
        {
          name: 'Consortium',
          setter: 'changeConsortium',
          getter: 'getConsortium',
          event: 'ConsortiumChanged',
          defaultAccount: () => consortium.address
        },
        {
          name: 'Treasury',
          setter: 'changeTreasuryAddress',
          getter: 'getTreasury',
          event: 'TreasuryAddressChanged',
          defaultAccount: () => treasury.address
        }
      ];
      values.forEach(function (role) {
        it(`${role.setter}() owner can set ${role.name}`, async function () {
          // @ts-ignore
          await expect(bridgeTokenAdapter.connect(owner)[role.setter](newRole))
            .to.emit(bridgeTokenAdapter, role.event)
            .withArgs(role.defaultAccount(), newRole.address);
        });

        it(`${role.getter}() returns new ${role.name}`, async function () {
          // @ts-ignore
          expect(await bridgeTokenAdapter[role.getter]()).to.be.equal(newRole);
        });

        it(`${role.setter}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(bridgeTokenAdapter.connect(newRole)[role.setter](ethers.Wallet.createRandom().address))
            .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
        });

        if (!role.canBeZero) {
          it(`${role.setter}() reverts when set to 0 address`, async function () {
            // @ts-ignore
            await expect(bridgeTokenAdapter.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(
              bridgeTokenAdapter,
              'ZeroAddress'
            );
          });
        }
      });
    });

    describe('Fees', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('getRedeemFee() is always 0', async function () {
        expect(await bridgeTokenAdapter.getRedeemFee()).to.be.eq(0n);
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

    async function defaultData(
      recipient: EthersAddressable = signer1,
      amount: bigint = randomBigInt(8),
      cutV: boolean = false
    ): Promise<DefaultData> {
      const txid = encode(['uint256'], [randomBigInt(8)]);
      const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
        [notary1, notary2],
        [true, true],
        CHAIN_ID,
        await recipient.getAddress(),
        amount,
        txid,
        await bridgeTokenAdapter.getAddress()
      );
      const depositId = ethers.keccak256('0x' + payload.slice(10));
      let cubistProof = rawSign(trustedSigner, depositId);
      if (cutV) {
        cubistProof = cubistProof.slice(0, 130); // remove V from each sig to follow real consortium
      }
      return {
        payload,
        payloadHash,
        proof,
        amount,
        tokenRecipient: recipient,
        depositId,
        cubistProof,
        txid
      } as unknown as DefaultData;
    }

    describe('Anyone can mint with valid payload', function () {
      args.forEach(function (arg) {
        it(`mintV1() ${arg.name}`, async function () {
          const totalSupplyBefore = await bridgeToken.totalSupply();
          const recipient = arg.recipient().address;
          const amount = arg.amount;
          const txid = encode(['uint256'], [randomBigInt(32)]);
          const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            recipient,
            amount,
            txid,
            await bridgeTokenAdapter.getAddress()
          );

          const sender = arg.msgSender();
          // @ts-ignore
          const tx = await bridgeTokenAdapter.connect(sender).mintV1(payload, proof);
          await expect(tx).to.emit(bridgeTokenAdapter, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(bridgeToken, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(bridgeToken, recipient, amount);
          await expect(tx)
            .to.emit(bridgeToken, 'Mint')
            .withArgs(recipient, amount, ethers.ZeroAddress, 0, reverseTxid(txid), 0);
          const totalSupplyAfter = await bridgeToken.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });
      });

      it('mintV1() when bascule is enabled', async function () {
        await bridgeTokenAdapter.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await bridgeToken.totalSupply();

        const recipient = signer2;
        const amount = randomBigInt(8);
        const { payload, proof, depositId, cubistProof, txid } = await defaultData(recipient, amount);

        // report deposit
        const reportId = ethers.randomBytes(32);
        await expect(bascule.connect(reporter).reportDeposits(reportId, [depositId], [cubistProof]))
          .to.emit(bascule, 'DepositsReported')
          .withArgs(reportId, 1);

        // @ts-ignore
        const tx = bridgeTokenAdapter.connect(signer1)['mintV1(bytes,bytes)'](payload, proof);
        await expect(tx).to.emit(bridgeToken, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
        await expect(tx).to.changeTokenBalance(bridgeToken, recipient, amount);
        await expect(tx)
          .to.emit(bridgeToken, 'Mint')
          .withArgs(recipient, amount, ethers.ZeroAddress, 0, reverseTxid(txid), 0);
        expect(await bascule.depositHistory(depositId)).to.be.eq(2); //WITHDRAWN
        const totalSupplyAfter = await bridgeToken.totalSupply();
        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
      });

      it('spendDeposit() spend payload without mint', async function () {
        const totalSupplyBefore = await bridgeToken.totalSupply();

        const recipient = bridgeTokenAdapter;
        const { payload, proof, payloadHash } = await defaultData(recipient, randomBigInt(8));

        // @ts-ignore
        const tx = bridgeTokenAdapter.connect(signer1).spendDeposit(payload, proof);
        await expect(tx).to.not.emit(bridgeToken, 'Transfer');
        await expect(tx).to.not.emit(bridgeToken, 'Mint');
        await expect(tx).to.emit(bridgeTokenAdapter, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
        const totalSupplyAfter = await bridgeToken.totalSupply();
        expect(totalSupplyAfter).to.be.eq(totalSupplyBefore);
      });

      const invalidArgs = [
        {
          name: 'not enough signatures',
          signers: () => [notary1, notary2],
          signatures: [true, false],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => bridgeTokenAdapter.address,
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'invalid signatures',
          signers: () => [signer1, signer2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => bridgeTokenAdapter.address,
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'invalid destination chain',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: encode(['uint256'], [1]),
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => bridgeTokenAdapter.address,
          customError: () => [bridgeTokenAdapter, 'WrongChainId']
        },
        {
          name: 'recipient is 0 address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => ethers.ZeroAddress,
          amount: randomBigInt(8),
          tokenAddress: () => bridgeTokenAdapter.address,
          customError: () => [bridgeTokenAdapter, 'Actions_ZeroAddress']
        },
        {
          name: 'amount is 0',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: 0n,
          tokenAddress: () => bridgeTokenAdapter.address,
          customError: () => [bridgeTokenAdapter, 'ZeroAmount']
        },
        {
          name: 'invalid token address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => ethers.Wallet.createRandom().address,
          customError: () => [bridgeTokenAdapter, 'InvalidDestinationToken']
        }
      ];

      invalidArgs.forEach(function (arg) {
        it(`mintV1() reverts when ${arg.name}`, async function () {
          const recipient = arg.recipient();
          const amount = arg.amount;

          const { payload, proof } = await signDepositBtcV1Payload(
            arg.signers(),
            arg.signatures,
            arg.chainId,
            recipient,
            amount,
            encode(['uint256'], [randomBigInt(8)]), //txId
            arg.tokenAddress()
          );
          await expect(bridgeTokenAdapter.mintV1(payload, proof))
            //@ts-ignore
            .to.revertedWithCustomError(...arg.customError());
        });
      });

      it('mintV1() reverts when not reported to bascule', async function () {
        await bridgeTokenAdapter.connect(owner).changeBascule(await bascule.getAddress());

        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(bridgeTokenAdapter.connect(signer1).mintV1(payload, proof)).to.be.revertedWithCustomError(
          bascule,
          'WithdrawalFailedValidation'
        );
      });

      it('mintV1() reverts when payload has been used', async function () {
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await bridgeTokenAdapter.connect(owner).changeBascule(ethers.ZeroAddress);
        await bridgeTokenAdapter.connect(signer1).mintV1(payload, proof);
        // @ts-ignore
        await expect(
          bridgeTokenAdapter.connect(signer1).mintV1(payload, proof, { gasLimit: 500_000n })
        ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'PayloadAlreadyUsed');
      });

      it('mintV1() reverts when paused', async function () {
        await bridgeTokenAdapter.connect(pauser).pause();
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(bridgeTokenAdapter.connect(signer1).mintV1(payload, proof)).to.be.revertedWithCustomError(
          bridgeTokenAdapter,
          'EnforcedPause'
        );
      });

      it('mintV1() reverts when payload type is invalid', async function () {
        if (await bridgeTokenAdapter.paused()) {
          await bridgeTokenAdapter.connect(owner).unpause();
        }
        const { payload, proof } = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          randomBigInt(8),
          encode(['uint256'], [randomBigInt(8)]) //txId
        );
        await expect(bridgeTokenAdapter.mintV1(payload, proof))
          .to.revertedWithCustomError(bridgeTokenAdapter, 'InvalidAction')
          .withArgs(DEPOSIT_BTC_ACTION_V1, DEPOSIT_BTC_ACTION_V0);
      });
    });

    describe('Batch mint', function () {
      describe('batchMint mints to listed addresses', function () {
        const amount1 = randomBigInt(8);
        const amount2 = randomBigInt(8);
        const amount3 = randomBigInt(8);
        before(async function () {
          await snapshot.restore();
        });

        it('batchMint() minter can mint to many accounts', async function () {
          const tx = await bridgeTokenAdapter
            .connect(minter)
            .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(bridgeToken, [signer1, signer2, signer3], [amount1, amount2, amount3]);
          await expect(tx)
            .to.emit(bridgeToken, 'Mint')
            .withArgs(signer1, amount1, ethers.ZeroAddress, 0, ethers.ZeroHash, ethers.MaxUint256);
          await expect(tx)
            .to.emit(bridgeToken, 'Mint')
            .withArgs(signer2, amount2, ethers.ZeroAddress, 0, ethers.ZeroHash, ethers.MaxUint256);
          await expect(tx)
            .to.emit(bridgeToken, 'Mint')
            .withArgs(signer3, amount3, ethers.ZeroAddress, 0, ethers.ZeroHash, ethers.MaxUint256);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            bridgeTokenAdapter.connect(minter).batchMint([signer1.address], [amount1, amount2])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'NonEqualLength');
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            bridgeTokenAdapter.connect(minter).batchMint([signer1.address, signer2.address], [amount1])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'NonEqualLength');
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(bridgeTokenAdapter.connect(signer1).batchMint([signer1.address], [amount1]))
            .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, await bridgeTokenAdapter.MINTER_ROLE());
        });

        it('batchMint() reverts when paused', async function () {
          await bridgeTokenAdapter.connect(pauser).pause();
          await expect(
            bridgeTokenAdapter
              .connect(minter)
              .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'EnforcedPause');
        });
      });

      describe('batchMintV1 mints from batch of payloads', function () {
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

        it('batchMintV1() anyone can mint batch of valid payloads', async function () {
          const tx = await bridgeTokenAdapter
            .connect(signer1)
            .batchMintV1([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          await expect(tx)
            .to.emit(bridgeTokenAdapter, 'MintProofConsumed')
            .withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx)
            .to.emit(bridgeTokenAdapter, 'MintProofConsumed')
            .withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx)
            .to.emit(bridgeTokenAdapter, 'MintProofConsumed')
            .withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).changeTokenBalances(bridgeToken, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMintV1() skips used payloads', async function () {
          const tx = await bridgeTokenAdapter
            .connect(signer1)
            .batchMintV1(
              [data1.payload, data1.payload, data2.payload, data2.payload],
              [data1.proof, data1.proof, data2.proof, data2.proof]
            );
          await expect(tx)
            .to.emit(bridgeTokenAdapter, 'MintProofConsumed')
            .withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(bridgeTokenAdapter, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);
          await expect(tx)
            .to.emit(bridgeTokenAdapter, 'MintProofConsumed')
            .withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(bridgeTokenAdapter, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(bridgeToken, [signer1, signer2], [amount1, amount2]);
        });

        it('batchMintV1() reverts if failed to mint any payload', async function () {
          const { payload, proof } = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer3.address,
            randomBigInt(8),
            encode(['uint256'], [randomBigInt(8)]) //txId
          );

          await expect(
            bridgeTokenAdapter
              .connect(signer1)
              .batchMintV1([data1.payload, data2.payload, payload], [data1.proof, data2.proof, proof])
          )
            .to.revertedWithCustomError(bridgeTokenAdapter, 'InvalidAction')
            .withArgs(DEPOSIT_BTC_ACTION_V1, DEPOSIT_BTC_ACTION_V0);
        });

        it('batchMintV1() reverts when there is less payloads than proofs', async function () {
          await expect(
            bridgeTokenAdapter.connect(signer1).batchMintV1([data1.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'NonEqualLength');
        });

        it('batchMintV1() reverts when there is more payloads than proofs', async function () {
          await expect(
            bridgeTokenAdapter.connect(signer1).batchMintV1([data1.payload, data2.payload], [data1.proof])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'NonEqualLength');
        });

        it('batchMintV1() reverts when paused', async function () {
          await bridgeTokenAdapter.connect(pauser).pause();
          await expect(
            bridgeTokenAdapter.connect(signer1).batchMintV1([data1.payload, data2.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(bridgeTokenAdapter, 'EnforcedPause');
        });
      });
    });

    describe('Asset router can mint', function () {
      before(async () => {
        await snapshot.restore();
      });
      it('mint on handle', async () => {
        const amount = 1000;
        await assetRouter.connect(owner).changeMailbox(signer1);

        let body = getPayloadForAction(
          [bridgeTokenAdapterBytes, encode(['address'], [signer2.address]), amount],
          MINT_SELECTOR
        );

        const payload: GMPUtils.PayloadStruct = {
          id: ethers.sha256('0x00'),
          msgPath: ethers.keccak256('0x00'),
          msgNonce: randomBigInt(8),
          msgSender: BTC_STAKING_MODULE_ADDRESS,
          msgRecipient: assetRouter.address,
          msgDestinationCaller: assetRouter.address,
          msgBody: body
        };

        const tx = await assetRouter.connect(signer1).handlePayload(payload);
        await expect(tx).to.changeTokenBalance(bridgeToken, signer2, amount);
        await expect(tx)
          .to.emit(bridgeToken, 'Mint')
          .withArgs(signer2, amount, ethers.ZeroAddress, 0, ethers.ZeroHash, ethers.MaxUint256);
      });
    });

    describe('BridgeV2 integration', function () {
      let bridge: BridgeV2;
      let bridgeAddressBytes: string;
      // let mailboxMock: Signer;

      before(async () => {
        await snapshot.restore();

        bridge = await deployContract<BridgeV2>('BridgeV2', [owner.address, mailbox.address]);
        await bridgeTokenAdapter.connect(owner).grantRole(await bridgeTokenAdapter.MINTER_ROLE(), bridge);
        bridgeAddressBytes = encode(['address'], [await bridge.getAddress()]);

        // allow some mocked paths
        await bridge.connect(owner).setDestinationBridge(CHAIN_ID, bridgeAddressBytes);
        await bridge
          .connect(owner)
          .addDestinationToken(CHAIN_ID, bridgeTokenAdapter, encode(['address'], [bridgeTokenAdapter.address]));
        await mailbox.connect(owner).enableMessagePath(CHAIN_ID, encode(['address'], [mailbox.address]), 3);
        await mailbox.connect(owner).setSenderConfig(bridge, 388, true);
        // set rate limit to resolve error
        await bridge.connect(owner).setTokenRateLimits(bridgeTokenAdapter, {
          chainId: CHAIN_ID,
          limit: 1_0000_0000,
          window: 1000n
        });
        await bridge.connect(owner).setSenderConfig(signer1, 100_00n, true);
        await bridge.connect(owner).setAllowance(bridgeToken, bridgeTokenAdapter, true);
      });

      it('mint on withdrawals', async () => {
        const amount = 1000;

        const sender = encode(['address'], [signer1.address]);
        const recipient = encode(['address'], [signer1.address]);
        const body = ethers.solidityPacked(
          ['uint8', 'bytes32', 'bytes32', 'bytes32', 'uint256'],
          [await bridge.MSG_VERSION(), encode(['address'], [bridgeTokenAdapter.address]), sender, recipient, amount]
        );

        const payload = getGMPPayload(
          encode(['address'], [mailbox.address]),
          CHAIN_ID,
          CHAIN_ID,
          randomBigInt(8),
          bridgeAddressBytes,
          bridgeAddressBytes,
          ethers.ZeroHash,
          body
        );
        const { proof } = await signPayload([notary1, notary2], [true, true], payload);

        const tx = await mailbox.connect(signer1).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(mailbox, 'MessageHandleError');

        await expect(tx)
          .to.emit(bridge, 'WithdrawFromBridge')
          .withArgs(signer1.address, CHAIN_ID, bridgeTokenAdapter, amount);
        await expect(tx).to.changeTokenBalance(bridgeToken, signer1, amount);
        await expect(tx)
          .to.emit(bridgeToken, 'Mint')
          .withArgs(signer1, amount, ethers.ZeroAddress, 0, ethers.ZeroHash, ethers.MaxUint256);
      });

      it('burn on deposit', async () => {
        const amount = 1000;
        const recipient = encode(['address'], [signer1.address]);

        await bridgeToken.connect(signer1).approve(bridgeTokenAdapter, amount * 2);

        const fee = await bridge.getFee(signer1);
        const tx = await bridge
          .connect(signer1)
          [
            'deposit(bytes32,address,bytes32,uint256,bytes32)'
          ](CHAIN_ID, bridgeTokenAdapter, recipient, amount, ethers.ZeroHash, { value: fee });
        await expect(tx).to.emit(mailbox, 'MessageSent');
        await expect(tx).to.changeTokenBalance(bridgeToken, signer1, -amount);
      });
    });
  });

  describe('Redeem for BTC', function () {
    describe('Positive cases', function () {
      let nonce = 1;
      before(async function () {
        await snapshot.restore();
        await assetRouter
          .connect(owner)
          .setRoute(bridgeTokenAdapterBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
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
          name: 'fees > 0, ratio = 1 and expectedAmount = minAmount',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: REDEEM_FOR_BTC_MIN_AMOUNT,
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        }
      ];

      args.forEach(function (arg) {
        let redeemAmount: bigint;
        let requestAmount: bigint;
        let isAboveDust: boolean;

        it(`calcUnstakeRequestAmount ${arg.name}`, async function () {
          await assetRouter.connect(owner).changeToNativeCommission(bridgeTokenAdapter.address, arg.toNativeFee);
          await ratioFeed.setRatio(arg.ratio);

          redeemAmount = arg.expectedAmount + arg.toNativeFee;
          [requestAmount, isAboveDust] = await assetRouter.calcUnstakeRequestAmount(
            bridgeTokenAdapter.address,
            arg.scriptPubKey,
            redeemAmount
          );
          expect(requestAmount).to.be.closeTo(arg.expectedAmount, 1n);
          expect(isAboveDust).to.be.eq(arg.isAboveDust);
        });

        it(`redeemForBtc() ${arg.name}`, async () => {
          //Burn previous balance
          const balance = await bridgeToken.balanceOf(signer1);
          await bridgeToken.connect(signer1).approve(bridgeTokenAdapter, balance);
          await bridgeToken.connect(signer1).burn(balance);
          expect(await bridgeToken.balanceOf(signer1)).to.be.eq(0n);

          await bridgeTokenAdapter.connect(minter).mint(signer1.address, arg.balance(redeemAmount));
          const totalSupplyBefore = await bridgeToken.totalSupply();

          const body = getPayloadForAction(
            [encode(['address'], [signer1.address]), arg.scriptPubKey, requestAmount],
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

          await bridgeToken.connect(signer1).approve(bridgeTokenAdapter, redeemAmount);
          const tx = await assetRouter
            .connect(signer1)
            .redeemForBtc(signer1, bridgeTokenAdapter, arg.scriptPubKey, redeemAmount);
          await expect(tx)
            .to.emit(mailbox, 'MessageSent')
            .withArgs(LEDGER_CHAIN_ID, assetRouter.address, ASSETS_MODULE_ADDRESS, payload);
          await expect(tx).to.changeTokenBalance(bridgeToken, signer1, -redeemAmount);
          await expect(tx).to.changeTokenBalance(bridgeToken, treasury, arg.toNativeFee);
          const totalSupplyAfter = await bridgeToken.totalSupply();
          expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(redeemAmount - arg.toNativeFee);
        });
      });
    });
  });

  describe('Burn and Transfer', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('burn(address,uint256) minter can burn accounts tokens', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await bridgeTokenAdapter.connect(minter).mint(recipient.address, balance);
      expect(await bridgeToken.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      const totalSupplyBefore = await bridgeToken.totalSupply();
      await bridgeToken.connect(recipient).approve(bridgeTokenAdapter, amount);
      const tx = await bridgeTokenAdapter.connect(minter)['burn(address,uint256)'](recipient.address, amount);
      await expect(tx).changeTokenBalance(bridgeToken, recipient, -amount);
      const totalSupplyAfter = await bridgeToken.totalSupply();
      expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(amount);
    });

    it('burn(address,uint256) reverts when called by not a minter', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await bridgeTokenAdapter.connect(minter).mint(recipient.address, balance);
      expect(await bridgeToken.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      await expect(bridgeTokenAdapter.connect(signer2)['burn(address,uint256)'](recipient.address, amount))
        .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
        .withArgs(signer2.address, await bridgeTokenAdapter.MINTER_ROLE());
    });

    it('burn(uint256) reverts when called by not a minter', async () => {
      const balance = randomBigInt(8);
      await bridgeTokenAdapter.connect(minter).mint(signer1, balance);
      expect(await bridgeToken.balanceOf(signer1)).to.be.eq(balance);

      const amount = balance / 3n;
      await expect(bridgeTokenAdapter.connect(signer1)['burn(uint256)'](amount))
        .to.revertedWithCustomError(bridgeTokenAdapter, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1, await bridgeTokenAdapter.MINTER_ROLE());
    });
  });
});
