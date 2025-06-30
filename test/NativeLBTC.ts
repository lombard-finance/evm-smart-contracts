import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot, SnapshotRestorer, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  ASSETS_MODULE_ADDRESS,
  BITCOIN_CHAIN_ID,
  BITCOIN_NATIVE_COIN,
  CHAIN_ID, DEFAULT_DUST_FEE_RATE,
  DefaultData,
  deployContract,
  DEPOSIT_BTC_ACTION_V0,
  DEPOSIT_BTC_ACTION_V1,
  e18,
  encode,
  FEE_APPROVAL_ACTION,
  generatePermitSignature,
  getFeeTypedMessage,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  LEDGER_CALLER,
  LEDGER_CHAIN_ID,
  LEDGER_MAILBOX,
  NEW_VALSET,
  randomBigInt,
  REDEEM_FROM_NATIVE_TOKEN_SELECTOR,
  signDepositBtcV0Payload,
  signDepositBtcV1Payload,
  Signer
} from './helpers';
import { AssetRouter, Bascule, Consortium, Mailbox, NativeLBTC, RatioFeedMock } from '../typechain-types';

const DAY = 86400;

describe('NativeLBTC', function () {
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

    nativeLbtc = await deployContract<NativeLBTC & Addressable>('NativeLBTC', [
      await consortium.getAddress(),
      treasury.address,
      owner.address,
      0n //owner delay
    ]);
    nativeLbtc.address = await nativeLbtc.getAddress();
    nativeLbtcBytes = encode(['address'], [nativeLbtc.address]);

    // Roles
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), minter);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.CLAIMER_ROLE(), claimer);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.OPERATOR_ROLE(), operator);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.PAUSER_ROLE(), pauser);

    bascule = await deployContract<Bascule>(
      'Bascule',
      [owner.address, pauser.address, reporter.address, nativeLbtc.address, 100],
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
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);
    await assetRouter.connect(owner).grantRole(await assetRouter.CLAIMER_ROLE(), nativeLbtc.address);
    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 500, true);
    await nativeLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.MINTER_ROLE(), assetRouter.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  async function defaultData(
    recipient: Signer = signer1,
    amount: bigint = randomBigInt(8),
    feeApprove: bigint = 1n
  ): Promise<DefaultData> {
    const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
      [notary1, notary2],
      [true, true],
      CHAIN_ID,
      recipient.address,
      amount,
      encode(['uint256'], [randomBigInt(8)]), //txId
      nativeLbtc.address
    );
    const feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
    const userSignature = await getFeeTypedMessage(recipient, nativeLbtc, feeApprove, snapshotTimestamp + DAY);
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
        expect(await nativeLbtc.owner()).to.equal(owner.address);
      });

      it('treasury()', async function () {
        expect(await nativeLbtc.getTreasury()).to.equal(treasury.address);
      });

      it('consortium()', async function () {
        expect(await nativeLbtc.consortium()).to.equal(await consortium.getAddress());
      });

      it('decimals()', async function () {
        expect(await nativeLbtc.decimals()).to.equal(8n);
      });

      it('Bascule() is not set by default', async function () {
        expect(await nativeLbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
      });

      it('isNative() true', async function () {
        expect(await nativeLbtc.isNative()).to.be.true;
      });
    });

    describe('Pause', function () {
      beforeEach(async function () {
        await snapshot.restore();
      });

      it('LBTC is not paused by default', async function () {
        expect(await nativeLbtc.paused()).to.be.false;
      });

      it('pause() pauser can set on pause', async function () {
        await expect(nativeLbtc.connect(pauser).pause()).to.emit(nativeLbtc, 'Paused').withArgs(pauser.address);
        expect(await nativeLbtc.paused()).to.be.true;
      });

      it('changePauser() owner can change pauser', async function () {
        const newPauser = signer1;
        await expect(nativeLbtc.connect(owner).grantRole(await nativeLbtc.PAUSER_ROLE(), newPauser))
          .to.emit(nativeLbtc, 'RoleGranted')
          .withArgs(await nativeLbtc.PAUSER_ROLE(), newPauser.address, owner.address);
        await nativeLbtc.connect(signer1).pause();
      });

      it('pause() reverts when called by not an pauser', async function () {
        await expect(nativeLbtc.connect(owner).pause())
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(owner.address, await nativeLbtc.PAUSER_ROLE());
      });

      it('unpause() turns off enforced pause', async function () {
        await nativeLbtc.connect(pauser).pause();
        expect(await nativeLbtc.paused()).to.be.true;

        await expect(nativeLbtc.connect(owner).unpause()).to.emit(nativeLbtc, 'Unpaused').withArgs(owner.address);
        expect(await nativeLbtc.paused()).to.be.false;
      });

      it('unpause() reverts when called by not an owner', async function () {
        await nativeLbtc.connect(pauser).pause();
        expect(await nativeLbtc.paused()).to.be.true;

        await expect(nativeLbtc.connect(pauser).unpause())
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(pauser.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });
    });

    describe('Toggle withdrawals', function () {
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
      });

      it('toggleRedeemsForBtc() owner can enable', async function () {
        await expect(nativeLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(nativeLbtc.address, true);
        expect(await nativeLbtc.isRedeemsEnabled()).to.be.true;
      });

      it('toggleRedeemsForBtc() owner can disable', async function () {
        await expect(nativeLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(nativeLbtc.address, false);
        expect(await nativeLbtc.isRedeemsEnabled()).to.be.false;
      });

      it('toggleRedeemsForBtc() reverts when called by not an owner', async function () {
        await expect(nativeLbtc.connect(signer1).toggleRedeemsForBtc())
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
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
          name: 'Claimer',
          role: async () => await nativeLbtc.CLAIMER_ROLE(),
          defaultAccount: () => claimer
        },
        {
          name: 'Minter',
          role: async () => await nativeLbtc.MINTER_ROLE(),
          defaultAccount: () => minter
        },
        //TODO: move to negative cases
        // {
        //   name: 'Default admin',
        //   role: async () => await nativeLbtc.DEFAULT_ADMIN_ROLE(),
        //   defaultAccount: () => owner,
        // },
        {
          name: 'Operator',
          role: async () => await nativeLbtc.OPERATOR_ROLE(),
          defaultAccount: () => operator
        }
      ];

      roles.forEach(function (role) {
        it(`${role.name}: hasRole is false by default`, async function () {
          expect(await nativeLbtc.hasRole(await role.role(), newRole.address)).to.be.false;
        });

        it(`${role.name}: grantRole() owner can assign new ${role.name}`, async function () {
          await expect(nativeLbtc.connect(owner).grantRole(await role.role(), newRole.address))
            .to.emit(nativeLbtc, 'RoleGranted')
            .withArgs(await role.role(), newRole.address, owner.address);
          expect(await nativeLbtc.hasRole(await role.role(), newRole.address)).to.be.true;
        });

        it(`${role.name}: there could be more than one ${role.name}`, async function () {
          expect(await nativeLbtc.hasRole(await role.role(), role.defaultAccount())).to.be.true;
        });

        it(`${role.name}: revokeRole() owner can revoke role`, async function () {
          await expect(nativeLbtc.connect(owner).revokeRole(await role.role(), newRole.address))
            .to.emit(nativeLbtc, 'RoleRevoked')
            .withArgs(await role.role(), newRole.address, owner.address);
          expect(await nativeLbtc.hasRole(await role.role(), newRole.address)).to.be.false;
        });

        it(`${role.name} other accounts not affected`, async function () {
          expect(await nativeLbtc.hasRole(await role.role(), role.defaultAccount())).to.be.true;
        });
      });

      it('grantRole() reverts when called by not an owner', async function () {
        await expect(nativeLbtc.connect(signer1).grantRole(await nativeLbtc.CLAIMER_ROLE(), signer1))
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });

      it('revokeRole() reverts when called by not an owner', async function () {
        await expect(nativeLbtc.connect(signer1).revokeRole(await nativeLbtc.CLAIMER_ROLE(), claimer))
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
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
          getter: 'Bascule',
          event: 'BasculeChanged',
          defaultAccount: () => ethers.ZeroAddress,
          canBeZero: true
        },
        {
          name: 'Consortium',
          setter: 'changeConsortium',
          getter: 'consortium',
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
          await expect(nativeLbtc.connect(owner)[role.setter](newRole))
            .to.emit(nativeLbtc, role.event)
            .withArgs(role.defaultAccount(), newRole.address);
        });

        it(`${role.getter}() returns new ${role.name}`, async function () {
          // @ts-ignore
          expect(await nativeLbtc[role.getter]()).to.be.equal(newRole);
        });

        it(`${role.setter}() reverts when called by not an owner`, async function () {
          // @ts-ignore
          await expect(nativeLbtc.connect(newRole)[role.setter](ethers.Wallet.createRandom().address))
            .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
        });

        if (!role.canBeZero) {
          it(`${role.setter}() reverts when set to 0 address`, async function () {
            // @ts-ignore
            await expect(nativeLbtc.connect(owner)[role.setter](ethers.ZeroAddress)).to.revertedWithCustomError(
              nativeLbtc,
              'ZeroAddress'
            );
          });
        }
      });
    });

    describe('Name and symbol', function () {
      before(async function () {
        await snapshot.restore();
      });

      it('Default name', async function () {
        expect(await nativeLbtc.name()).to.be.eq('Lombard Liquid Bitcoin');
      });

      it('Default symbol', async function () {
        expect(await nativeLbtc.symbol()).to.be.eq('XLBTC');
      });

      it('changeNameAndSymbol() owner can rename token', async function () {
        const newName = 'NewName';
        const newSymbol = 'NewSymbol';
        const tx = await nativeLbtc.connect(owner).changeNameAndSymbol(newName, newSymbol);
        await expect(tx).to.emit(nativeLbtc, 'NameAndSymbolChanged').withArgs(newName, newSymbol);

        expect(await nativeLbtc.name()).to.be.eq(newName);
        expect(await nativeLbtc.symbol()).to.be.eq(newSymbol);
      });

      it('changeNameAndSymbol() updates domain separator', async function () {
        const name = await nativeLbtc.name();
        const symbol = await nativeLbtc.symbol();
        const newName = name + ' V1';
        const newSymbol = symbol + 'v1';
        await expect(nativeLbtc.connect(owner).changeNameAndSymbol(newName, newSymbol))
          .to.emit(nativeLbtc, 'NameAndSymbolChanged')
          .withArgs(newName, newSymbol);
        expect(await nativeLbtc.name()).to.equal(newName);
        expect(await nativeLbtc.symbol()).to.equal(newSymbol);
        const domain = await nativeLbtc.eip712Domain();
        expect(domain.name).to.equal(newName);
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const expectedDomainSeparator = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [typeHash, ethers.keccak256(ethers.toUtf8Bytes(newName)), ethers.keccak256(ethers.toUtf8Bytes("1")), chainId, await nativeLbtc.getAddress()],
          )
        );
        expect(await nativeLbtc.DOMAIN_SEPARATOR()).to.equal(expectedDomainSeparator);
      });

      it('changeNameAndSymbol() reverts when called by not an owner', async function () {
        const newName = 'NewName';
        const newSymbol = 'NewSymbol';
        await expect(nativeLbtc.connect(signer1).changeNameAndSymbol(newName, newSymbol))
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, '0x0000000000000000000000000000000000000000000000000000000000000000');
      });
    });

    describe('Fees', function() {
      before(async function () {
        await snapshot.restore();
      });

      it('getMintFee() returns mint fee on the contract side', async function() {
        const maxFee = randomBigInt(4);
        await assetRouter.connect(operator).setMaxMintCommission(maxFee);
        expect(await nativeLbtc.getMintFee()).to.be.eq(maxFee);
      });

      it('getRedeemFee() is always 0', async function() {
        expect(await nativeLbtc.getRedeemFee()).to.be.eq(0n);
      });

      it('getDustFeeRate()', async function () {
        expect(await nativeLbtc.getDustFeeRate()).to.be.eq(DEFAULT_DUST_FEE_RATE);
      });
    })
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
        it(`mintV1() ${arg.name}`, async function () {
          const totalSupplyBefore = await nativeLbtc.totalSupply();
          const recipient = arg.recipient().address;
          const amount = arg.amount;
          const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            recipient,
            amount,
            encode(['uint256'], [randomBigInt(8)]), //txId
            await nativeLbtc.getAddress()
          );

          const sender = arg.msgSender();
          // @ts-ignore
          const tx = await nativeLbtc.connect(sender).mintV1(payload, proof);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
          await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount);
          const totalSupplyAfter = await nativeLbtc.totalSupply();
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });
      });

      //TODO: fix
      it('mintV1() when bascule is enabled', async function () {
        this.skip();
        await nativeLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await nativeLbtc.totalSupply();

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
        const tx = nativeLbtc.connect(signer1)['mint(bytes,bytes)'](payload, proof);
        await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient, amount);
        await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount);
        const totalSupplyAfter = await nativeLbtc.totalSupply();
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
          tokenAddress: () => nativeLbtc.address,
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'invalid signatures',
          signers: () => [signer1, signer2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => nativeLbtc.address,
          customError: () => [consortium, 'NotEnoughSignatures']
        },
        {
          name: 'invalid destination chain',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: encode(['uint256'], [1]),
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => nativeLbtc.address,
          customError: () => [nativeLbtc, 'WrongChainId']
        },
        {
          name: 'recipient is 0 address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => ethers.ZeroAddress,
          amount: randomBigInt(8),
          tokenAddress: () => nativeLbtc.address,
          customError: () => [nativeLbtc, 'Actions_ZeroAddress']
        },
        {
          name: 'amount is 0',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: 0n,
          tokenAddress: () => nativeLbtc.address,
          customError: () => [nativeLbtc, 'ZeroAmount']
        },
        {
          name: 'invalid token address',
          signers: () => [notary1, notary2],
          signatures: [true, true],
          chainId: CHAIN_ID,
          recipient: () => signer1.address,
          amount: randomBigInt(8),
          tokenAddress: () => ethers.Wallet.createRandom().address,
          customError: () => [nativeLbtc, 'InvalidDestinationToken']
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
          await expect(nativeLbtc.mintV1(payload, proof))
            //@ts-ignore
            .to.revertedWithCustomError(...arg.customError());
        });
      });

      //TODO: BASCULE DOES NOT CHECK DEPOSITS WHEN ENABLED
      it('mintV1() reverts when not reported to bascule', async function () {
        this.skip();
        await nativeLbtc.connect(owner).changeBascule(await bascule.getAddress());

        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await nativeLbtc.connect(signer1).mintV1(payload, proof);
        // @ts-ignore
        // await expect(nativeLbtc.connect(signer1)['mint(bytes,bytes)'](payloadHash, proof)).to.be.revertedWithCustomError(
        //   bascule,
        //   'WithdrawalFailedValidation'
        // );
      });

      it('mintV1() reverts when payload has been used', async function () {
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        await nativeLbtc.connect(signer1).mintV1(payload, proof);
        // @ts-ignore
        await expect(
          nativeLbtc.connect(signer1).mintV1(payload, proof, { gasLimit: 500_000n })
        ).to.be.revertedWithCustomError(nativeLbtc, 'PayloadAlreadyUsed');
      });

      it('mintV1() reverts when paused', async function () {
        await nativeLbtc.connect(pauser).pause();
        const { payload, proof } = await defaultData(signer1, randomBigInt(8));
        // @ts-ignore
        await expect(nativeLbtc.connect(signer1).mintV1(payload, proof)).to.be.revertedWithCustomError(
          nativeLbtc,
          'EnforcedPause'
        );
      });

      it('mintV1() reverts when payload type is invalid', async function () {
        const { payload, proof } = await signDepositBtcV0Payload(
          [notary1, notary2],
          [true, true],
          CHAIN_ID,
          signer1.address,
          randomBigInt(8),
          encode(['uint256'], [randomBigInt(8)]) //txId
        );
        await expect(nativeLbtc.mintV1(payload, proof))
          .to.revertedWithCustomError(nativeLbtc, 'InvalidAction')
          .withArgs(DEPOSIT_BTC_ACTION_V1, DEPOSIT_BTC_ACTION_V0);
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
          it(`mintV1WithFee() ${fee.name} and ${arg.name}`, async function () {
            const totalSupplyBefore = await nativeLbtc.totalSupply();
            const recipient = arg.recipient();
            const amount = arg.amount;

            const { payload, proof, payloadHash, feeApprovalPayload, userSignature } = await defaultData(
              recipient,
              amount,
              fee.approved
            );

            // Set fee and approve
            await assetRouter.connect(operator).setMaxMintCommission(fee.max);
            const appliedFee = fee.approved < fee.max ? fee.approved : fee.max;

            const tx = await nativeLbtc
              .connect(claimer)
              // @ts-ignore
              .mintV1WithFee(payload, proof, feeApprovalPayload, userSignature);
            await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(recipient, payloadHash, payload);
            await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
            await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, recipient.address, amount);
            if (appliedFee > 0n) {
              await expect(tx)
                .to.emit(nativeLbtc, 'Transfer')
                .withArgs(recipient.address, treasury.address, appliedFee);
            }
            await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount - appliedFee);
            await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, appliedFee);
            const totalSupplyAfter = await nativeLbtc.totalSupply();
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });
      });

      it('mintV1WithFee() can use fee approve many times until it expired', async function () {
        const recipient = signer1;
        const feeApproved = randomBigInt(2);
        const feeMax = randomBigInt(2);
        const userSignature = await getFeeTypedMessage(recipient, nativeLbtc, feeApproved, snapshotTimestamp + DAY);
        const feeApprovalPayload = getPayloadForAction([feeApproved, snapshotTimestamp + DAY], 'feeApproval');
        await assetRouter.connect(operator).setMaxMintCommission(feeMax);
        const appliedFee = feeApproved < feeMax ? feeApproved : feeMax;

        for (let i = 0; i < 10; i++) {
          await time.increase(3600);
          const amount = randomBigInt(8);
          const { payload, proof } = await defaultData(recipient, amount);
          // @ts-ignore
          const tx = await nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(appliedFee, userSignature);
        }
      });

      //TODO: fix
      it('mintV1WithFee() when bascule enabled', async function () {
        this.skip();
        await nativeLbtc.connect(owner).changeBascule(await bascule.getAddress());
        const totalSupplyBefore = await nativeLbtc.totalSupply();

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
        const tx = await nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature);
        await expect(tx).to.emit(assetRouter, 'AssetRouter_FeeCharged').withArgs(appliedFee, userSignature);
        await expect(tx)
          .to.emit(nativeLbtc, 'Transfer')
          .withArgs(ethers.ZeroAddress, recipient.address, amount - appliedFee);
        await expect(tx).to.emit(nativeLbtc, 'Transfer').withArgs(ethers.ZeroAddress, treasury.address, appliedFee);
        await expect(tx).to.changeTokenBalance(nativeLbtc, recipient, amount - appliedFee);
        await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, appliedFee);
        const totalSupplyAfter = await nativeLbtc.totalSupply();
        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
      });

      it('mintV1WithFee() reverts when approve has expired', async function () {
        const { payload, proof } = await defaultData();
        const feeApprovalPayload = getPayloadForAction([1, snapshotTimestamp], 'feeApproval');
        const userSignature = await getFeeTypedMessage(signer1, nativeLbtc, 1, snapshotTimestamp);
        await expect(nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(nativeLbtc, 'UserSignatureExpired')
          .withArgs(snapshotTimestamp);
      });

      it('mintV1WithFee() reverts when mint payload type is invalid', async function () {
        const { feeApprovalPayload, userSignature } = await defaultData();
        await expect(
          nativeLbtc
            .connect(claimer)
            // @ts-ignore
            .mintV1WithFee(feeApprovalPayload, userSignature, feeApprovalPayload, userSignature)
        )
          .to.revertedWithCustomError(nativeLbtc, 'InvalidAction')
          .withArgs(DEPOSIT_BTC_ACTION_V1, FEE_APPROVAL_ACTION);
      });

      it('mintV1WithFee() reverts when fee payload type is invalid', async function () {
        const { payload, proof } = await defaultData();
        await expect(
          // @ts-ignore
          nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, payload, proof)
        )
          .to.revertedWithCustomError(nativeLbtc, 'InvalidAction')
          .withArgs(FEE_APPROVAL_ACTION, DEPOSIT_BTC_ACTION_V1);
      });

      it('mintV1WithFee() reverts when called by not a claimer', async function () {
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData();
        // @ts-ignore
        await expect(nativeLbtc.connect(signer1).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature))
          .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await nativeLbtc.CLAIMER_ROLE());
      });

      it('mintV1WithFee() reverts when mint amount equals fee', async function () {
        const amount = randomBigInt(3);
        const fee = amount + 1n;
        const { payload, proof, feeApprovalPayload, userSignature } = await defaultData(signer1, amount, fee);
        await assetRouter.connect(operator).setMaxMintCommission(fee);
        await expect(
          // @ts-ignore
          nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(nativeLbtc, 'FeeGreaterThanAmount');
      });

      it('mintV1WithFee() reverts when fee approve signed by other account', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(claimer, nativeLbtc, 1, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(nativeLbtc, 'InvalidFeeApprovalSignature');
      });

      it('mintV1WithFee() reverts when fee signature doesnt match payload', async function () {
        const { payload, proof, feeApprovalPayload } = await defaultData();
        const userSignature = await getFeeTypedMessage(signer1, nativeLbtc, 2, snapshotTimestamp + DAY);
        await expect(
          // @ts-ignore
          nativeLbtc.connect(claimer).mintV1WithFee(payload, proof, feeApprovalPayload, userSignature)
        ).to.revertedWithCustomError(nativeLbtc, 'InvalidFeeApprovalSignature');
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
          const tx = await nativeLbtc
            .connect(minter)
            .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3]);
          await expect(tx).changeTokenBalances(nativeLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            nativeLbtc.connect(minter).batchMint([signer1.address], [amount1, amount2])
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when count of signers is less than amounts', async function () {
          await expect(
            nativeLbtc.connect(minter).batchMint([signer1.address, signer2.address], [amount1])
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMint() reverts when called by not a minter', async function () {
          await expect(nativeLbtc.connect(signer1).batchMint([signer1.address], [amount1]))
            .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, await nativeLbtc.MINTER_ROLE());
        });

        it('batchMint() reverts when paused', async function () {
          await nativeLbtc.connect(pauser).pause();
          await expect(
            nativeLbtc
              .connect(minter)
              .batchMint([signer1.address, signer2.address, signer3.address], [amount1, amount2, amount3])
          ).to.be.revertedWithCustomError(nativeLbtc, 'EnforcedPause');
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
          const tx = await nativeLbtc
            .connect(signer1)
            .batchMintV1([data1.payload, data2.payload, data3.payload], [data1.proof, data2.proof, data3.proof]);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).changeTokenBalances(nativeLbtc, [signer1, signer2, signer3], [amount1, amount2, amount3]);
        });

        it('batchMintV1() skips used payloads', async function () {
          const tx = await nativeLbtc
            .connect(signer1)
            .batchMintV1(
              [data1.payload, data1.payload, data2.payload, data2.payload],
              [data1.proof, data1.proof, data2.proof, data2.proof]
            );
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(nativeLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(nativeLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(nativeLbtc, [signer1, signer2], [amount1, amount2]);
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
            nativeLbtc
              .connect(signer1)
              .batchMintV1([data1.payload, data2.payload, payload], [data1.proof, data2.proof, proof])
          )
            .to.revertedWithCustomError(nativeLbtc, 'InvalidAction')
            .withArgs(DEPOSIT_BTC_ACTION_V1, DEPOSIT_BTC_ACTION_V0);
        });

        it('batchMintV1() reverts when there is less payloads than proofs', async function () {
          await expect(
            nativeLbtc.connect(signer1).batchMintV1([data1.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1() reverts when there is more payloads than proofs', async function () {
          await expect(
            nativeLbtc.connect(signer1).batchMintV1([data1.payload, data2.payload], [data1.proof])
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1() reverts when paused', async function () {
          await nativeLbtc.connect(pauser).pause();
          await expect(
            nativeLbtc.connect(signer1).batchMintV1([data1.payload, data2.payload], [data1.proof, data2.proof])
          ).to.be.revertedWithCustomError(nativeLbtc, 'EnforcedPause');
        });
      });

      describe('batchMintV1WithFee() mints from batch of payloads with fee being charged', function () {
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

        it('batchMintV1WithFee() claimer can mint many payloads with fee', async function () {
          const tx = await nativeLbtc.connect(claimer).batchMintV1WithFee(
            //@ts-ignore
            [data1.payload, data2.payload, data3.payload],
            [data1.proof, data2.proof, data3.proof],
            [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
            [data1.userSignature, data2.userSignature, data3.userSignature]
          );
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer3, data3.payloadHash, data3.payload);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(maxFee, data3.userSignature);
          await expect(tx).changeTokenBalances(
            nativeLbtc,
            [signer1, signer2, signer3],
            [amount1 - maxFee, amount2 - maxFee, amount3 - maxFee]
          );
          await expect(tx).changeTokenBalance(nativeLbtc, treasury, maxFee * 3n);
        });

        it('batchMintV1WithFee() skips used payloads', async function () {
          const tx = await nativeLbtc.connect(claimer).batchMintV1WithFee(
            //@ts-ignore
            [data1.payload, data1.payload, data2.payload, data2.payload],
            [data1.proof, data1.proof, data2.proof, data2.proof],
            [data1.feeApprovalPayload, data1.feeApprovalPayload, data2.feeApprovalPayload, data2.feeApprovalPayload],
            [data1.userSignature, data1.userSignature, data2.userSignature, data2.userSignature]
          );
          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer1, data1.payloadHash, data1.payload);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(maxFee, data1.userSignature);
          await expect(tx).to.emit(nativeLbtc, 'BatchMintSkipped').withArgs(data1.payloadHash, data1.payload);

          await expect(tx).to.emit(nativeLbtc, 'MintProofConsumed').withArgs(signer2, data2.payloadHash, data2.payload);
          await expect(tx).to.emit(nativeLbtc, 'FeeCharged').withArgs(maxFee, data2.userSignature);
          await expect(tx).to.emit(nativeLbtc, 'BatchMintSkipped').withArgs(data2.payloadHash, data2.payload);
          await expect(tx).changeTokenBalances(nativeLbtc, [signer1, signer2], [amount1 - maxFee, amount2 - maxFee]);
          await expect(tx).changeTokenBalance(nativeLbtc, treasury, maxFee * 2n);
        });

        it('batchMintV1WithFee() reverts if failed to mint any payload', async function () {
          const { payload, proof } = await signDepositBtcV0Payload(
            [notary1, notary2],
            [true, true],
            CHAIN_ID,
            signer3.address,
            randomBigInt(8),
            encode(['uint256'], [randomBigInt(8)]) //txId
          );
          const feeApprovalPayload = getPayloadForAction([1n, snapshotTimestamp + DAY], 'feeApproval');
          const userSignature = await getFeeTypedMessage(signer3, nativeLbtc, 1n, snapshotTimestamp + DAY);

          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, payload],
              [data1.proof, data2.proof, proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, feeApprovalPayload],
              [data1.userSignature, data2.userSignature, userSignature]
            )
          ).to.be.reverted;
        });

        it('batchMintV1WithFee() reverts when there is less payloads than other entities', async function () {
          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less proofs than payloads', async function () {
          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less fee approvals than payloads', async function () {
          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when there is less user fee signatures than payloads', async function () {
          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature]
            )
          ).to.be.revertedWithCustomError(nativeLbtc, 'NonEqualLength');
        });

        it('batchMintV1WithFee() reverts when called by not a claimer', async function () {
          await expect(
            nativeLbtc.connect(signer1).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          )
            .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
            .withArgs(signer1.address, await nativeLbtc.CLAIMER_ROLE());
        });

        it('batchMintV1WithFee() reverts when paused', async function () {
          await nativeLbtc.connect(pauser).pause();
          await expect(
            nativeLbtc.connect(claimer).batchMintV1WithFee(
              //@ts-ignore
              [data1.payload, data2.payload, data3.payload],
              [data1.proof, data2.proof, data3.proof],
              [data1.feeApprovalPayload, data2.feeApprovalPayload, data3.feeApprovalPayload],
              [data1.userSignature, data2.userSignature, data3.userSignature]
            )
          ).to.be.revertedWithCustomError(nativeLbtc, 'EnforcedPause');
        });
      });
    });
  });

  describe('Redeem for BTC', function () {
    describe('Positive cases', function () {
      let nonce = 1;
      before(async function () {
        await snapshot.restore();
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
        await nativeLbtc.connect(owner).toggleRedeemsForBtc();
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
          name: 'fees = 0, ratio = 0.5 and expectedAmount > dustFee',
          toNativeFee: 0n,
          redeemFee: 0n,
          expectedAmount: 1000_000n,
          balance: (a: bigint) => a,
          ratio: e18 / 2n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 0.5 and expectedAmount > dustFee',
          toNativeFee: 1000n,
          redeemFee: 1000n,
          expectedAmount: 1000_000n,
          balance: (a: bigint) => a,
          ratio: e18 / 2n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 0.(9) and expectedAmount > dustFee',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount: randomBigInt(8),
          balance: (a: bigint) => a,
          ratio: e18 - 1n,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio = 1 and expectedAmount = dustFee + 1',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount:
            (BigInt(Buffer.from('00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', 'hex').byteLength) + 76n) * 3n + 1n,
          balance: (a: bigint) => a,
          ratio: e18,
          scriptPubKey: '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
          isAboveDust: true
        },
        {
          name: 'fees > 0, ratio is random and expectedAmount = dustFee + 1',
          toNativeFee: randomBigInt(4),
          redeemFee: randomBigInt(4),
          expectedAmount:
            (BigInt(Buffer.from('00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', 'hex').byteLength) + 76n) * 3n + 1n,
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
          await assetRouter.connect(owner).changeToNativeCommission(arg.toNativeFee);
          await ratioFeed.setRatio(arg.ratio);

          redeemAmount = arg.expectedAmount + arg.toNativeFee;
          [requestAmount, isAboveDust] = await assetRouter.calcUnstakeRequestAmount(
            nativeLbtc.address,
            arg.scriptPubKey,
            redeemAmount
          );
          expect(requestAmount).to.be.closeTo(arg.expectedAmount, 1n);
          expect(isAboveDust).to.be.eq(arg.isAboveDust);
        });

        it(`redeemForBtc() ${arg.name}`, async () => {
          //Burn previous balance
          const balance = await nativeLbtc.balanceOf(signer1);
          await nativeLbtc.connect(signer1)['burn(uint256)'](balance);
          expect(await nativeLbtc.balanceOf(signer1)).to.be.eq(0n);

          await nativeLbtc.connect(minter).mint(signer1.address, arg.balance(redeemAmount));
          const totalSupplyBefore = await nativeLbtc.totalSupply();

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

          const tx = await nativeLbtc.connect(signer1).redeemForBtc(arg.scriptPubKey, redeemAmount);
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
        await assetRouter.connect(owner).setRoute(nativeLbtcBytes, CHAIN_ID, BITCOIN_NATIVE_COIN, BITCOIN_CHAIN_ID, 2);
        await nativeLbtc.connect(owner).toggleRedeemsForBtc();
      });

      it('redeemForBtc() reverts when it is off', async function () {
        await expect(nativeLbtc.connect(owner).toggleRedeemsForBtc())
          .to.emit(assetRouter, 'AssetRouter_RedeemEnabled')
          .withArgs(nativeLbtc.address, false);
        const amount = 100_000_000n;
        await nativeLbtc.connect(minter).mint(signer1.address, amount);
        await expect(
          nativeLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.revertedWithCustomError(assetRouter, 'AssetRouter_RedeemsForBtcDisabled');
      });

      it('redeemForBtc() reverts when amount < toNativeCommission', async function () {
        await nativeLbtc.connect(minter).mint(signer1.address, randomBigInt(10));

        const toNativeCommission = 1000n;
        await assetRouter.connect(owner).changeToNativeCommission(toNativeCommission);
        const amount = toNativeCommission - 1n;

        await expect(nativeLbtc.connect(signer1).redeemForBtc('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount))
          .to.be.revertedWithCustomError(assetRouter, 'AmountLessThanCommission')
          .withArgs(toNativeCommission);
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
          [, isAboveDust] = await nativeLbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }

        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;
        await nativeLbtc.connect(minter).mint(signer1.address, amountJustBelowDustLimit);
        await expect(nativeLbtc.connect(signer1).redeemForBtc(p2wsh, amountJustBelowDustLimit))
          .to.be.revertedWithCustomError(assetRouter, 'AmountBelowDustLimit')
          .withArgs(amountJustBelowDustLimit - toNativeCommission);
      });

      it('redeemForBtc() reverts with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await nativeLbtc.connect(minter).mint(signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeemForBtc(p2sh, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await nativeLbtc.connect(minter).mint(signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeemForBtc(p2pkh, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await nativeLbtc.connect(minter).mint(signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeemForBtc(p2pk, amount)).to.be.revertedWithCustomError(
          assetRouter,
          'ScriptPubkeyUnsupported'
        );
      });

      it('redeemForBtc() reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await nativeLbtc.connect(minter).mint(signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeemForBtc(p2ms, amount)).to.be.revertedWithCustomError(
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
      // Mint some tokens
      await nativeLbtc.connect(minter).mint(signer1.address, 100_000_000n);
    });

    afterEach(async function () {
      await snapshot.restore();
    });

    it('should transfer funds with permit', async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer1,
        signer2.address,
        10_000n,
        timestamp + 100,
        chainId,
        0,
        (await nativeLbtc.eip712Domain()).name
      );

      await nativeLbtc.permit(signer1.address, signer2.address, 10_000n, timestamp + 100, v, r, s);

      // check allowance
      expect(await nativeLbtc.allowance(signer1.address, signer2.address)).to.equal(10_000n);

      // check transferFrom
      await nativeLbtc.connect(signer2).transferFrom(signer1.address, signer3.address, 10_000n);
      expect(await nativeLbtc.balanceOf(signer3.address)).to.equal(10_000n);

      // check nonce is incremented
      expect(await nativeLbtc.nonces(signer1.address)).to.equal(1);
    });

    describe("fail if permit params don't match the signature", function () {
      let v: number;
      let r: string;
      let s: string;

      before(async function () {
        // generate permit signature
        const signature = await generatePermitSignature(
          nativeLbtc.address,
          signer1,
          signer2.address,
          10_000n,
          timestamp + 100,
          chainId,
          0,
          (await nativeLbtc.eip712Domain()).name
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
            nativeLbtc.permit(signer(), spender(), value, deadline(), v, r, s)
          ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612InvalidSigner');
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
            nativeLbtc.address,
            signer(),
            spender(),
            value,
            deadline(),
            chainId(),
            nonce,
            (await nativeLbtc.eip712Domain()).name
          );
          await expect(
            nativeLbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s)
          ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612InvalidSigner');
        });
      });
    });
  });

  describe('Burn and Transfer', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('burn() minter can burn accounts tokens', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await nativeLbtc.connect(minter).mint(recipient.address, balance);
      expect(await nativeLbtc.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      const totalSupplyBefore = await nativeLbtc.totalSupply();
      const tx = await nativeLbtc.connect(minter)['burn(address,uint256)'](recipient.address, amount);
      await expect(tx).changeTokenBalance(nativeLbtc, recipient, -amount);
      const totalSupplyAfter = await nativeLbtc.totalSupply();
      expect(totalSupplyBefore - totalSupplyAfter).to.be.eq(amount);
    });

    it('burn() reverts when called by not a minter', async function () {
      const balance = randomBigInt(8);
      const recipient = signer1;
      await nativeLbtc.connect(minter).mint(recipient.address, balance);
      expect(await nativeLbtc.balanceOf(recipient)).to.be.eq(balance);

      const amount = balance / 3n;
      await expect(nativeLbtc.connect(signer2)['burn(address,uint256)'](recipient.address, amount))
        .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
        .withArgs(signer2.address, await nativeLbtc.MINTER_ROLE());
    });

    it('transfer() minter can transfer from account without approval', async function () {
      const balance = randomBigInt(8);
      const donor = signer1;
      const recipient = signer2;
      await nativeLbtc.connect(minter).mint(donor.address, balance);
      expect(await nativeLbtc.balanceOf(donor)).to.be.eq(balance);

      const amount = balance / 3n;
      const totalSupplyBefore = await nativeLbtc.totalSupply();
      const tx = await nativeLbtc
        .connect(minter)
        ['transfer(address,address,uint256)'](donor.address, recipient.address, amount);
      await expect(tx).changeTokenBalance(nativeLbtc, donor, -amount);
      await expect(tx).changeTokenBalance(nativeLbtc, recipient, amount);
      const totalSupplyAfter = await nativeLbtc.totalSupply();
      expect(totalSupplyAfter).to.be.eq(totalSupplyBefore);
    });

    it('transfer() reverts when called by not a minter', async function () {
      const balance = randomBigInt(8);
      const donor = signer1;
      const recipient = signer2;
      await nativeLbtc.connect(minter).mint(donor.address, balance);
      expect(await nativeLbtc.balanceOf(donor)).to.be.eq(balance);

      const amount = balance / 3n;
      await expect(nativeLbtc.connect(recipient)['transfer(address,address,uint256)'](donor.address, recipient.address, amount))
        .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
        .withArgs(recipient.address, await nativeLbtc.MINTER_ROLE());
    });
  });
});
