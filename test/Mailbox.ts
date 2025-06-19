import { Consortium, GMPHandlerMock, Mailbox, MailboxTreasuryMock, StakedLBTC } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  calcFee,
  calculateStorageSlot,
  deployContract, DEPOSIT_BTC_ACTION_V1,
  encode,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys, GMP_V1_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  Signer,
  signPayload
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';

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

const GLOBAL_MAX_PAYLOAD_SIZE = 10000n;
const DEFAULT_FEE_PER_BYTE = 100n;
const VERY_BIG_FEE = 9999_9999_9999n;
const e18 = 10n ** 18n;

describe('Mailbox', function () {
  let deployer: Signer,
    owner: Signer,
    pauser: Signer,
    treasury: Signer,
    notary: Signer,
    signer1: Signer,
    signer2: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let handlerMock: GMPHandlerMock & Addressable;

  let snapshot: SnapshotRestorer;

  let globalNonce = 1;
  let lChainId: string;
  let sMailboxBytes: string, dMailboxBytes: string;

  before(async () => {
    [deployer, owner, pauser, treasury, notary, signer1, signer2] = await getSignersWithPrivateKeys();

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);

    // for both chains
    consortium = await deployContract<Consortium & Addressable>('Consortium', [deployer.address]);
    consortium.address = await consortium.getAddress();
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [notary.publicKey], [1], 1, 1], NEW_VALSET));

    smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [
      owner.address,
      consortium.address,
      DEFAULT_FEE_PER_BYTE,
      0n
    ]);
    smailbox.address = await smailbox.getAddress();
    sMailboxBytes = encode(['address'], [smailbox.address]);
    await smailbox.connect(owner).grantRole(await smailbox.PAUSER_ROLE(), pauser);
    await smailbox.connect(owner).grantRole(await smailbox.TREASURER_ROLE(), treasury);
    await smailbox.connect(owner).setDefaultMaxPayloadSize(1000);

    dmailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    dmailbox.address = await dmailbox.getAddress();
    dMailboxBytes = encode(['address'], [dmailbox.address]);
    await dmailbox.connect(owner).grantRole(await smailbox.PAUSER_ROLE(), pauser);
    await dmailbox.connect(owner).grantRole(await smailbox.TREASURER_ROLE(), treasury);
    await dmailbox.connect(owner).setDefaultMaxPayloadSize(1000);

    await smailbox.connect(owner).enableMessagePath(lChainId, dMailboxBytes);
    await dmailbox.connect(owner).enableMessagePath(lChainId, sMailboxBytes);

    handlerMock = await deployContract<GMPHandlerMock & Addressable>('GMPHandlerMock', [true], false);
    handlerMock.address = await handlerMock.getAddress();

    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    it('Owner', async () => {
      expect(await smailbox.owner()).to.equal(owner.address);
    });

    it('Consortium', async () => {
      expect(await smailbox.consortium()).to.equal(consortium.address);
    });

    it('Verify storage slot and nonce inside', async () => {
      const slot = calculateStorageSlot('lombardfinance.storage.Mailbox');
      const storage = await ethers.provider.getStorage(smailbox, slot);
      expect(storage).to.be.eq(encode(['uint256'], [1]));
    });

    describe('Enable message path', () => {
      beforeEach(async () => {
        await snapshot.restore();
        globalNonce = 1;
      });

      it('enableMessagePath default admin can', async () => {
        let chain = encode(['uint256'], [12345]);
        let mailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
        const messagePathOut = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [smailbox.address, lChainId, chain])
        );
        const messagePathIn = ethers.keccak256(encode(['bytes32', 'bytes32', 'bytes32'], [mailbox, chain, lChainId]));

        await expect(smailbox.connect(owner).enableMessagePath(chain, mailbox))
          .to.emit(smailbox, 'MessagePathEnabled')
          .withArgs(chain, messagePathIn, messagePathOut, mailbox);
      });

      it('enableMessagePath reverts when called by not an admin', async () => {
        let chain = encode(['uint256'], [12345]);
        let mailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(smailbox.connect(signer1).enableMessagePath(chain, mailbox))
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });

      it('enableMessagePath reverts when destination contract is set for the chain', async () => {
        let mailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(smailbox.connect(owner).enableMessagePath(lChainId, mailbox))
          .to.revertedWithCustomError(smailbox, 'Mailbox_MessagePathEnabled')
          .withArgs(ethers.keccak256(encode(['bytes32', 'bytes32', 'bytes32'], [sMailboxBytes, lChainId, lChainId])));
      });

      it('enableMessagePath reverts when chainId is 0', async () => {
        let chain = encode(['uint256'], [0]);
        let mailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(smailbox.connect(owner).enableMessagePath(chain, mailbox)).to.revertedWithCustomError(
          smailbox,
          'Mailbox_ZeroChainId'
        );
      });

      it('enableMessagePath mailbox cannot be be 0 address', async () => {
        let chain = encode(['uint256'], [12345]);
        let mailbox = encode(['address'], [ethers.ZeroAddress]);
        await expect(smailbox.connect(owner).enableMessagePath(chain, mailbox)).to.revertedWithCustomError(
          smailbox,
          'Mailbox_ZeroMailbox'
        );
      });
    });

    describe('Disable message path', () => {
      let dChain: string;
      let dMailbox: string;
      let dMailboxBytes: string;
      let messagePathIn: string;
      let messagePathOut: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        dChain = encode(['uint256'], [12345]);
        dMailbox = ethers.Wallet.createRandom().address;
        dMailboxBytes = encode(['address'], [dMailbox]);
        messagePathIn = ethers.keccak256(encode(['address', 'bytes32', 'bytes32'], [dMailbox, dChain, lChainId]));
        messagePathOut = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [smailbox.address, lChainId, dChain])
        );

        await smailbox.connect(owner).enableMessagePath(dChain, dMailboxBytes);
      });

      it('disableMessagePath reverts when called by not an admin', async () => {
        await expect(smailbox.connect(signer1).disableMessagePath(dChain, dMailboxBytes))
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });

      it('disableMessagePath default admin can', async () => {
        await expect(smailbox.connect(owner).disableMessagePath(dChain, dMailboxBytes))
          .to.emit(smailbox, 'MessagePathDisabled')
          .withArgs(dChain, messagePathIn, messagePathOut, dMailboxBytes);
      });

      it('Can not send when the path is disabled', async () => {
        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const dCaller = encode(['address'], [ethers.ZeroAddress]);
        const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));
        await expect(
          smailbox.connect(signer1).send(dChain, recipient, dCaller, body, { value: e18 })
        ).to.revertedWithCustomError(smailbox, 'Mailbox_MessagePathDisabled');
      });

      it('Can not receive when the path is disabled', async () => {
        const payload = getGMPPayload(
          encode(['address'], [dMailbox]),
          dChain,
          lChainId,
          globalNonce,
          encode(['address'], [signer1.address]),
          encode(['address'], [handlerMock.address]),
          encode(['address'], [ethers.ZeroAddress]),
          ethers.hexlify(ethers.toUtf8Bytes('TEST'))
        );
        const { proof } = await signPayload([notary], [true], payload);

        await expect(smailbox.connect(signer1).deliverAndHandle(payload, proof)).to.be.revertedWithCustomError(
          smailbox,
          'Mailbox_MessagePathDisabled'
        );
      });

      it('Can set new mailbox for the chain', async () => {
        let newMailbox = ethers.Wallet.createRandom().address;
        const mailbox32Bytes = encode(['address'], [newMailbox]);
        const messagePathOut = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [smailbox.address, lChainId, dChain])
        );
        const messagePathIn = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [newMailbox, dChain, lChainId])
        );

        await expect(smailbox.connect(owner).enableMessagePath(dChain, mailbox32Bytes))
          .to.emit(smailbox, 'MessagePathEnabled')
          .withArgs(dChain, messagePathIn, messagePathOut, mailbox32Bytes);
      });

      it('disableMessagePath reverts when mailbox is 0 address', async () => {
        await expect(
          smailbox.connect(owner).disableMessagePath(dChain, encode(['address'], [ethers.ZeroAddress]))
        ).to.revertedWithCustomError(smailbox, 'Mailbox_ZeroMailbox');
      });

      it('disableMessagePath reverts when chain is 0', async () => {
        await expect(
          smailbox.connect(owner).disableMessagePath(encode(['uint256'], [0]), dMailboxBytes)
        ).to.revertedWithCustomError(smailbox, 'Mailbox_ZeroChainId');
      });
    });

    describe('Default payload size', () => {
      let smailbox: Mailbox & Addressable;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
        smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
        smailbox.address = await smailbox.getAddress();
        await smailbox.connect(owner).enableMessagePath(lChainId, dMailboxBytes);
      });

      it('Initial default payload size is 0', async () => {
        expect(await smailbox.getDefaultMaxPayloadSize()).to.be.eq(0n);
      });

      it('Can not send message before default size has been set', async () => {
        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const dCaller = encode(['address'], [ethers.ZeroAddress]);
        const body = ethers.hexlify(ethers.toUtf8Bytes(''));
        await expect(smailbox.connect(signer1).send(lChainId, recipient, dCaller, body, { value: e18 }))
          .to.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
          .withArgs(0n, 228);
      });

      it('setDefaultMaxPayloadSize admin can', async () => {
        const size = randomBigInt(3);
        await expect(smailbox.connect(owner).setDefaultMaxPayloadSize(size))
          .to.emit(smailbox, 'DefaultPayloadSizeSet')
          .withArgs(size);
        expect(await smailbox.getDefaultMaxPayloadSize()).to.be.equal(size);
      });

      it('setDefaultMaxPayloadSize can set to 0', async () => {
        const size = 0n;
        await expect(smailbox.connect(owner).setDefaultMaxPayloadSize(size))
          .to.emit(smailbox, 'DefaultPayloadSizeSet')
          .withArgs(size);
        expect(await smailbox.getDefaultMaxPayloadSize()).to.be.equal(size);
      });

      it('setDefaultMaxPayloadSize reverts when called by not an admin', async () => {
        const size = randomBigInt(3);
        await expect(smailbox.connect(signer1).setDefaultMaxPayloadSize(size))
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });

      it('setDefaultMaxPayloadSize reverts when value is greater than MAX', async () => {
        const size = GLOBAL_MAX_PAYLOAD_SIZE + 1n;
        await expect(smailbox.connect(owner).setDefaultMaxPayloadSize(size))
          .to.be.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
          .withArgs(GLOBAL_MAX_PAYLOAD_SIZE, size);
      });
    });

    describe('Sender config', () => {
      let smailbox: Mailbox & Addressable;
      let configSender: Signer;
      let recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      let dCaller = encode(['address'], [ethers.ZeroAddress]);
      let body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));
      let configPayloadLength: number;
      let defaultMaxPayloadSize: number;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
        configSender = signer2;
        smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
        smailbox.address = await smailbox.getAddress();
        await smailbox.connect(owner).enableMessagePath(lChainId, dMailboxBytes);

        const testPayload = getGMPPayload(
          encode(['address'], [smailbox.address]),
          lChainId,
          lChainId,
          globalNonce,
          encode(['address'], [configSender.address]),
          recipient,
          dCaller,
          body
        );
        configPayloadLength = ethers.getBytes(testPayload).byteLength;
      });

      it('setSenderConfig admin can', async () => {
        await expect(smailbox.connect(owner).setSenderConfig(configSender, configPayloadLength, false))
          .to.emit(smailbox, 'SenderConfigUpdated')
          .withArgs(configSender, configPayloadLength, false);

        const cfg = await smailbox.getSenderConfigWithDefault(configSender);
        expect(cfg.maxPayloadSize).to.be.eq(configPayloadLength);
        expect(cfg.feeDisabled).to.be.false;
      });

      it('Send message when sender has config and default size is not set', async () => {
        const tx = await smailbox.connect(configSender).send(lChainId, recipient, dCaller, body, { value: 0n });
        await expect(tx).to.emit(smailbox, 'MessageSent').and.to.emit(smailbox, 'MessagePaid');
      });

      it('Sender can not exceed size from config even if default is greater', async () => {
        defaultMaxPayloadSize = 512;
        await smailbox.connect(owner).setDefaultMaxPayloadSize(defaultMaxPayloadSize);

        const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
        const dCaller = encode(['address'], [ethers.ZeroAddress]);
        const body = ethers.hexlify(ethers.toUtf8Bytes('LONG TEST MESSAGE TO SEND FROM THE MAILBOX'));
        const payload = getGMPPayload(
          encode(['address'], [smailbox.address]),
          lChainId,
          lChainId,
          globalNonce,
          encode(['address'], [configSender.address]),
          recipient,
          dCaller,
          body
        );
        const size = ethers.getBytes(payload).byteLength;

        await expect(smailbox.connect(configSender).send(lChainId, recipient, dCaller, body, { value: 0n }))
          .to.be.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
          .withArgs(configPayloadLength, size);
      });

      it('setSenderConfig admin can change config', async () => {
        await expect(smailbox.connect(owner).setSenderConfig(configSender, 0n, true))
          .to.emit(smailbox, 'SenderConfigUpdated')
          .withArgs(configSender, 0n, true);

        const cfg = await smailbox.getSenderConfigWithDefault(configSender);
        expect(cfg.maxPayloadSize).to.be.eq(defaultMaxPayloadSize);
        expect(cfg.feeDisabled).to.be.true;
      });

      it('Sender is limited to default size when config value is 0', async () => {
        let tx = await smailbox.connect(configSender).send(lChainId, recipient, dCaller, body, { value: 0n });
        await expect(tx).to.emit(smailbox, 'MessageSent').and.to.emit(smailbox, 'MessagePaid');

        const longBody = ethers.hexlify(new Uint8Array(512));
        const payload = getGMPPayload(
          encode(['address'], [smailbox.address]),
          lChainId,
          lChainId,
          globalNonce,
          encode(['address'], [configSender.address]),
          recipient,
          dCaller,
          longBody
        );
        const size = ethers.getBytes(payload).byteLength;
        await expect(smailbox.connect(configSender).send(lChainId, recipient, dCaller, longBody, { value: 0n }))
          .to.be.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
          .withArgs(defaultMaxPayloadSize, size);
      });

      it('setSenderConfig reverts when size greater than max', async () => {
        await expect(smailbox.connect(owner).setSenderConfig(configSender, GLOBAL_MAX_PAYLOAD_SIZE + 1n, false))
          .to.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
          .withArgs(GLOBAL_MAX_PAYLOAD_SIZE, GLOBAL_MAX_PAYLOAD_SIZE + 1n);
      });

      it('setSenderConfig reverts when called by not an admin', async () => {
        await expect(smailbox.connect(signer1).setSenderConfig(configSender, configPayloadLength, false))
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });
    });

    describe('Fee', () => {
      let senderWithEnabledFee: Signer;
      let senderWithDisabledFee: Signer;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        senderWithEnabledFee = signer1;
        await smailbox.connect(owner).setSenderConfig(senderWithEnabledFee, GLOBAL_MAX_PAYLOAD_SIZE, false);

        senderWithDisabledFee = signer2;
        await smailbox.connect(owner).setSenderConfig(senderWithDisabledFee, GLOBAL_MAX_PAYLOAD_SIZE, true);
      });

      const feeArgs = [
        {
          name: 'price is 0',
          bytePrice: 0n
        },
        {
          name: 'price is 1n',
          bytePrice: 1n
        },
        {
          name: 'price is 1000_000n',
          bytePrice: 1000_000n
        }
      ];

      const senders = [
        {
          name: 'sender with config and enabled fee',
          sender: () => senderWithEnabledFee,
          feeFunc: calcFee
        },
        {
          name: 'sender with disabled fees',
          sender: () => senderWithDisabledFee,
          feeFunc: (body: string, _: any) => calcFee(body, 0n)
        },
        {
          name: 'sender without config',
          sender: () => owner,
          feeFunc: calcFee
        }
      ];

      feeArgs.forEach(feeArg => {
        it(`Set fee ${feeArg.name}`, async () => {
          await expect(smailbox.connect(owner).setFee(feeArg.bytePrice))
            .to.emit(smailbox, 'FeePerByteSet')
            .withArgs(feeArg.bytePrice);
        });

        senders.forEach(sender => {
          it(`getFee for ${sender.name}`, async () => {
            const body = ethers.hexlify(new Uint8Array(Number(randomBigInt(2))));

            const { fee } = sender.feeFunc(body, feeArg.bytePrice);
            const actualFee = await smailbox.getFee(sender.sender(), body);
            expect(actualFee).to.be.eq(fee);
          });
        });
      });

      it('setFee reverts when called by not an admin', async () => {
        const bytePrice = 1n;
        await expect(smailbox.connect(signer1).setFee(bytePrice))
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer1.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });
    });

    describe('Pause', () => {
      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
      });

      it('pauser can pause', async () => {
        await expect(smailbox.connect(pauser).pause()).to.emit(smailbox, 'Paused').withArgs(pauser.address);
        expect(await smailbox.paused()).to.be.true;
      });

      it('pauser can not unpause', async () => {
        await expect(smailbox.connect(pauser).unpause())
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(pauser.address, await smailbox.DEFAULT_ADMIN_ROLE());
      });

      it('admin can unpause', async () => {
        await expect(smailbox.connect(owner).unpause()).to.emit(smailbox, 'Unpaused').withArgs(owner.address);
        expect(await smailbox.paused()).to.be.false;
      });

      it('pause reverts when called by not a pauser', async () => {
        await expect(smailbox.connect(signer2).pause())
          .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
          .withArgs(signer2.address, await smailbox.PAUSER_ROLE());
      });
    });
  });

  describe('Rescue ERC20', function () {
    let token: StakedLBTC & Addressable;
    let dummy: Signer;

    before(async () => {
      await snapshot.restore();
      globalNonce = 1;

      const rndAddr = ethers.Wallet.createRandom();
      token = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        rndAddr.address,
        0,
        rndAddr.address,
        owner.address
      ]);
      token.address = await token.getAddress();
      dummy = signer2;
      await token.connect(owner).addMinter(owner);
      await token.connect(owner)['mint(address,uint256)'](dummy, e18);
    });

    it('Treasury can transfer ERC20 from mailbox', async () => {
      const amount = randomBigInt(8);
      let tx = await token.connect(dummy)['transfer(address,uint256)'](smailbox, amount);
      await expect(tx).changeTokenBalance(token, smailbox, amount);

      tx = await smailbox.connect(treasury).rescueERC20(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, smailbox, -amount);
    });

    it('Reverts when called by not a treasury', async () => {
      const amount = randomBigInt(8);
      const tx = await token.connect(dummy)['transfer(address,uint256)'](smailbox, amount);
      await expect(tx).changeTokenBalance(token, smailbox, amount);

      await expect(smailbox.connect(dummy).rescueERC20(token.address, dummy.address, amount))
        .to.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
        .withArgs(dummy.address, await smailbox.TREASURER_ROLE());
    });

    it('Reverts when mailbox is on pause', async () => {
      const amount = randomBigInt(8);
      const tx = await token.connect(dummy)['transfer(address,uint256)'](smailbox, amount);
      await expect(tx).changeTokenBalance(token, smailbox, amount);

      await smailbox.connect(pauser).pause();

      await expect(smailbox.connect(treasury).rescueERC20(token, dummy, amount)).to.revertedWithCustomError(
        smailbox,
        'EnforcedPause'
      );
    });
  });

  describe('Withdraw fee', function () {
    beforeEach(async () => {
      await snapshot.restore();
      globalNonce = 1;

      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

      await smailbox.connect(signer1).send(lChainId, recipient, dCaller, body, { value: e18 });
      expect(await ethers.provider.getBalance(smailbox.address)).to.be.eq(e18);
    });

    it('Reverts when called by not a treasury', async () => {
      await expect(smailbox.connect(owner).withdrawFee())
        .to.be.revertedWithCustomError(smailbox, 'AccessControlUnauthorizedAccount')
        .withArgs(owner.address, await smailbox.TREASURER_ROLE());
    });

    it('Reverts when mailbox is on pause', async () => {
      await smailbox.connect(pauser).pause();

      try {
        await expect(smailbox.connect(treasury).withdrawFee()).to.revertedWithCustomError(smailbox, 'EnforcedPause');
      } finally {
        await smailbox.connect(owner).unpause();
      }
    });

    it('Treasury can withdraw ether balance', async () => {
      const totalFee = await ethers.provider.getBalance(smailbox.address);
      const tx = await smailbox.connect(treasury).withdrawFee();
      await expect(tx).to.emit(smailbox, 'FeeWithdrawn').withArgs(treasury.address, totalFee);
      await expect(tx).to.changeEtherBalance(treasury, totalFee, { includeFee: false });
      await expect(tx).to.changeEtherBalance(smailbox, -totalFee);
    });

    it('Reverts when mailbox is empty', async () => {
      await smailbox.connect(treasury).withdrawFee();
      await expect(smailbox.connect(treasury).withdrawFee()).to.be.revertedWithCustomError(
        smailbox,
        'Mailbox_ZeroAmount'
      );
    });

    it('Reverts when treasury does not accept funds', async () => {
      const treasuryMock = await deployContract<MailboxTreasuryMock>('MailboxTreasuryMock', [smailbox.address], false);
      await smailbox.connect(owner).grantRole(await smailbox.TREASURER_ROLE(), treasuryMock);
      await treasuryMock.disableReceive();

      await expect(treasuryMock.connect(signer1).withdrawFee()).to.revertedWithCustomError(
        smailbox,
        'Mailbox_CallFailed'
      );
    });
  });

  describe('Base flow', function () {
    beforeEach(async () => {
      await snapshot.restore();
      globalNonce = 1;
    });

    it('transmit a message and withdraw fee', async () => {
      const recipient = encode(['address'], [handlerMock.address]);
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

      const signer1Bytes = encode(['address'], [signer1.address]);

      const payload = getGMPPayload(
        encode(['address'], [smailbox.address]),
        lChainId,
        lChainId,
        globalNonce++,
        signer1Bytes,
        recipient,
        dCaller,
        body
      );

      const { fee, payloadLength } = calcFee(body, DEFAULT_FEE_PER_BYTE);

      const sendTx = smailbox.connect(signer1).send(lChainId, recipient, dCaller, body, { value: fee });

      await expect(sendTx)
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, signer1.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);
      await expect(sendTx).changeEtherBalance(signer1, -fee, { includeFee: false });

      const { proof, payloadHash } = await signPayload([notary], [true], payload);

      const result = dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
      await expect(result)
        .to.emit(dmailbox, 'MessageDelivered')
        .withArgs(payloadHash, signer1.address, globalNonce - 1, signer1Bytes, payload);
      await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, signer1.address, body);

      // withdraw the fee
      const withdrawFeeTx = smailbox.connect(treasury).withdrawFee();
      await expect(withdrawFeeTx).to.emit(smailbox, 'FeeWithdrawn').withArgs(treasury, fee);
      await expect(withdrawFeeTx).to.changeEtherBalance(treasury, fee, { includeFee: false });
    });
  });

  describe('Send', function () {
    let newDstChain: string;
    let newDstMailbox;

    before(async () => {
      await snapshot.restore();
      globalNonce = 1;

      newDstChain = encode(['uint256'], [12345]);
      newDstMailbox = ethers.Wallet.createRandom();
      await smailbox.connect(owner).enableMessagePath(newDstChain, encode(['address'], [newDstMailbox.address]));
    });

    it('New message', async () => {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));
      const sender = signer1;

      const payload = getGMPPayload(
        encode(['address'], [smailbox.address]),
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [sender.address]), //cosmos
        recipient, //StakingRouter
        dCaller, //anyone (StakingRouter)
        body
      );

      const { fee, payloadLength } = calcFee(body, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(lChainId, recipient, dCaller, body, { value: fee }))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);
    });

    it('Another message to the same chain', async () => {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST 2'));
      const sender = signer1;

      const payload = getGMPPayload(
        encode(['address'], [smailbox.address]),
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [sender.address]),
        recipient,
        dCaller,
        body
      );

      const { fee, payloadLength } = calcFee(body, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(lChainId, recipient, dCaller, body, { value: fee }))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);
    });

    it('Message to different chain', async () => {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST 3'));
      const sender = signer2;

      const payload = getGMPPayload(
        encode(['address'], [smailbox.address]),
        lChainId,
        newDstChain,
        globalNonce++,
        encode(['address'], [sender.address]),
        recipient,
        dCaller,
        body
      );
      const { fee, payloadLength } = calcFee(body, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(newDstChain, recipient, dCaller, body, { value: fee }))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(newDstChain, sender.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), sender, payloadLength, fee);
    });

    const invalidArgs = [
      {
        name: 'Unknown destination chain',
        destinationChain: () => encode(['uint256'], [123]),
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        feeFunc: calcFee,
        error: 'Mailbox_MessagePathDisabled'
      },
      {
        name: 'Recipient is 0 address',
        destinationChain: () => lChainId,
        recipient: () => encode(['address'], [ethers.ZeroAddress]),
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        feeFunc: calcFee,
        error: 'Mailbox_ZeroRecipient'
      },
      {
        name: 'Not enough fee',
        destinationChain: () => lChainId,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        feeFunc: (body: string, price: bigint) => {
          const res = calcFee(body, price);
          res.fee -= 1n;
          return res;
        },
        error: 'Mailbox_NotEnoughFee'
      }
    ];

    invalidArgs.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async () => {
        const { fee } = arg.feeFunc(arg.body(), DEFAULT_FEE_PER_BYTE);
        await expect(
          smailbox.connect(signer1).send(arg.destinationChain(), arg.recipient(), arg.dCaller(), arg.body(), {
            value: fee
          })
        ).to.revertedWithCustomError(smailbox, arg.error);
      });
    });

    it('Reverts when payload oversized', async () => {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const body = ethers.hexlify(new Uint8Array(255));

      const { fee, payloadLength } = calcFee(body, DEFAULT_FEE_PER_BYTE);

      // max payload for sender payload.length - 1
      await expect(smailbox.connect(owner).setSenderConfig(signer1, payloadLength - 1, false))
        .to.emit(smailbox, 'SenderConfigUpdated')
        .withArgs(signer1, payloadLength - 1, false);

      await expect(smailbox.connect(signer1).send(lChainId, recipient, dCaller, body, { value: fee }))
        .to.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
        .withArgs(payloadLength - 1, payloadLength);
    });

    it('Reverts when mailbox is on pause', async () => {
      await smailbox.connect(pauser).pause();

      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const dCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const body = ethers.hexlify(new Uint8Array(16));
      const { fee } = calcFee(body, DEFAULT_FEE_PER_BYTE);
      await expect(
        smailbox.connect(signer1).send(lChainId, recipient, dCaller, body, { value: fee })
      ).to.revertedWithCustomError(smailbox, 'EnforcedPause');
    });
  });

  describe('Deliver and handle', function () {
    describe('Caller is specified', function () {
      let recipient: string;
      let dCaller: Signer;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;
      let msgSender: string;
      let nonce: bigint;

      before(async () => {
        await snapshot.restore();

        recipient = encode(['address'], [handlerMock.address]);
        dCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [dCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        const args = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args;
        expect(args.payload).to.not.undefined;
        payload = args.payload;
        msgSender = encode(['address'], [args.msgSender]);
        nonce = ethers.toBigInt(payload.slice(74, 138));

        let res = await signPayload([notary], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle reverts when called by unauthorized caller', async () => {
        await expect(dmailbox.connect(signer1).deliverAndHandle(payload, proof))
          .to.be.revertedWithCustomError(dmailbox, 'Mailbox_UnexpectedDestinationCaller')
          .withArgs(dCaller.address, signer1.address);
      });

      it('deliverAndHandle reverts when mailbox is on pause', async () => {
        await dmailbox.connect(pauser).pause();

        try {
          await expect(dmailbox.connect(dCaller).deliverAndHandle(payload, proof)).to.revertedWithCustomError(
            dmailbox,
            'EnforcedPause'
          );
        } finally {
          await dmailbox.connect(owner).unpause();
        }
      });

      it('deliverAndHandle by authorized caller', async () => {
        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, nonce, msgSender, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('repeated deliverAndHandle does not produce MessageDelivered event', async () => {
        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('other mailbox on dst chain can receive this message', async () => {
        const newDstMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [
          owner.address,
          consortium.address,
          0n,
          0n
        ]);
        newDstMailbox.address = await newDstMailbox.getAddress();
        await newDstMailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

        const result = await newDstMailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(newDstMailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(newDstMailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, nonce, msgSender, payload);
        await expect(result).to.emit(newDstMailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('deliver another message from the same dst', async () => {
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST 2'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [dCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        const args = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args;
        expect(args.payload).to.not.undefined;
        payload = args.payload;
        msgSender = encode(['address'], [args.msgSender]);
        nonce = ethers.toBigInt(payload.slice(74, 138));

        let res = await signPayload([notary], [true], payload);

        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, res.proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(res.payloadHash, dCaller.address, nonce, msgSender, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(res.payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('deliver message from new dst', async () => {
        const newSrcChain = encode(['uint256'], [12345]);
        const newSrcMailbox = ethers.Wallet.createRandom();
        await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox.address]));
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST 3'));

        const payload = getGMPPayload(
          encode(['address'], [newSrcMailbox.address]),
          newSrcChain,
          lChainId,
          globalNonce++,
          encode(['address'], [signer1.address]),
          recipient,
          encode(['address'], [dCaller.address]),
          body
        );
        const { proof, payloadHash } = await signPayload([notary], [true], payload);

        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, globalNonce - 1, msgSender, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Caller is arbitrary', function () {
      let recipient: string;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;
      let signer1Bytes: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
        signer1Bytes = encode(['address'], [signer1.address]);

        recipient = encode(['address'], [handlerMock.address]);
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [ethers.ZeroAddress]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        payload = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([notary], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('any address can call deliverAndHandle', async () => {
        let dCaller = signer1;
        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, globalNonce, signer1Bytes, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('repeat deliverAndHandle with different caller', async () => {
        let dCaller = signer2;
        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Recipient rejects call and retry later', function () {
      let recipient: string;
      let dCaller: Signer;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;
      let signer1Bytes: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
        signer1Bytes = encode(['address'], [signer1.address]);

        recipient = encode(['address'], [handlerMock.address]);
        dCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [dCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        payload = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([notary], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle when recipient is inactive', async () => {
        await handlerMock.disable();

        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result)
          .to.emit(dmailbox, 'MessageHandleError')
          .withArgs(payloadHash, dCaller.address, 'not enabled', '0x');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, globalNonce, signer1Bytes, payload);
        await expect(result).to.not.emit(dmailbox, 'MessageHandled');
        await expect(result).to.not.emit(handlerMock, 'MessageReceived');
      });

      it('retry deliverAndHandle when recipient is still inactive', async () => {
        await handlerMock.disable();

        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result)
          .to.emit(dmailbox, 'MessageHandleError')
          .withArgs(payloadHash, dCaller.address, 'not enabled', '0x');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.not.emit(dmailbox, 'MessageHandled');
        await expect(result).to.not.emit(handlerMock, 'MessageReceived');
      });

      it('retry deliverAndHandle when recipient became active', async () => {
        await handlerMock.enable();

        const result = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, dCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Payload is invalid', function () {
      let unknownMailbox: Mailbox & Addressable;

      before(async () => {
        await snapshot.restore();
        unknownMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [
          owner.address,
          consortium.address,
          0,
          0n
        ]);
        unknownMailbox.address = await unknownMailbox.getAddress();
      });
      let nonce = 1;

      const args = [
        {
          name: 'Recipient is not IHandler',
          recipientAddress: () => signer1.address,
          srcContract: () => smailbox.address,
          srcChain: () => lChainId,
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => notary,
          customError: () => [dmailbox, 'Mailbox_HandlerNotImplemented']
        },
        {
          name: 'Recipient is 0 address',
          recipientAddress: () => ethers.ZeroAddress,
          srcContract: () => smailbox.address,
          srcChain: () => lChainId,
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => notary,
          customError: () => [dmailbox, 'GMP_ZeroRecipient']
        },
        {
          name: 'Unknown src mailbox',
          recipientAddress: () => handlerMock.address,
          srcContract: () => unknownMailbox.address,
          srcChain: () => lChainId,
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => notary,
          customError: () => [dmailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'Unknown src chain',
          recipientAddress: () => handlerMock.address,
          srcContract: () => smailbox.address,
          srcChain: () => encode(['uint256'], [12345n]),
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => notary,
          customError: () => [dmailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'Invalid dst chain',
          recipientAddress: () => handlerMock.address,
          srcContract: () => smailbox.address,
          srcChain: () => lChainId,
          dstChain: () => encode(['uint256'], [12345n]),
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => notary,
          customError: () => [dmailbox, 'Mailbox_MessagePathDisabled']
        },
        {
          name: 'Sender is 0 address',
          recipientAddress: () => handlerMock.address,
          srcContract: () => smailbox.address,
          srcChain: () => lChainId,
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => ethers.ZeroAddress,
          notary: () => notary,
          customError: () => [dmailbox, 'GMP_ZeroSender']
        },
        {
          name: 'Invalid signature',
          recipientAddress: () => handlerMock.address,
          srcContract: () => smailbox.address,
          srcChain: () => lChainId,
          dstChain: () => lChainId,
          nonce: () => nonce,
          sender: () => signer2.address,
          notary: () => signer2,
          customError: () => [consortium, 'NotEnoughSignatures']
        }
        // {
        //   name: 'Correct',
        //   recipientAddress: () => handlerMock.address,
        //   srcContract: () => smailbox.address,
        //   srcChain: () => lChainId,
        //   dstChain: () => lChainId,
        //   nonce: () => nonce,
        //   sender: () => signer2.address,
        //   notary: () => notary,
        //   customError: 'Mailbox_HandlerNotImplemented'
        // },
      ];

      args.forEach(function (arg) {
        it(`Reverts when ${arg.name}`, async () => {
          let dCaller = signer2;
          let body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

          const payload = getGMPPayload(
            encode(['address'], [arg.srcContract()]),
            arg.srcChain(),
            arg.dstChain(),
            arg.nonce(),
            encode(['address'], [arg.sender()]),
            encode(['address'], [arg.recipientAddress()]),
            encode(['address'], [dCaller.address]),
            body
          );

          const { proof } = await signPayload([arg.notary()], [true], payload);

          await expect(
            dmailbox.connect(dCaller).deliverAndHandle(payload, proof)
            // @ts-ignore
          ).to.be.revertedWithCustomError(...arg.customError());
        });
      });

      it('Invalid selector', async function() {
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let payload = getGMPPayload(
          encode(['address'], [smailbox.address]),
          lChainId,
          lChainId,
          1,
          encode(['address'], [signer1.address]),
          encode(['address'], [handlerMock.address]),
          encode(['address'], [ethers.ZeroAddress]),
          body
        );
        console.log(payload);
        payload = payload.replace(GMP_V1_SELECTOR, DEPOSIT_BTC_ACTION_V1);

        const { proof } = await signPayload([notary], [true], payload);
        await expect(dmailbox.connect(signer1).deliverAndHandle(payload, proof))
          .to.be.revertedWithCustomError(dmailbox, 'GMP_InvalidAction')
          .withArgs(GMP_V1_SELECTOR, DEPOSIT_BTC_ACTION_V1)
      })
    });
  });
});
