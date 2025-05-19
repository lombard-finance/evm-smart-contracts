import { Consortium, GMPHandlerMock, LBTCMock, Mailbox } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  encode,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  NEW_VALSET,
  Signer,
  signPayload,
  getGMPPayload
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';

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

async function calcFee(
  payload: BytesLike,
  weiPerByte: bigint
): Promise<{
  fee: BigNumberish;
  length: number;
}> {
  const length = ethers.getBytes(payload).length;
  return {
    fee: weiPerByte * BigInt(length),
    length
  };
}

const DEFAULT_FEE_PER_BYTE = 100n;
const VERY_BIG_FEE = 9999_9999_9999n;

describe('Mailbox', function () {
  let deployer: Signer, owner: Signer, signer1: Signer, signer2: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let snapshot: SnapshotRestorer;
  let lChainId: string;
  let handlerMock: GMPHandlerMock & Addressable;
  let globalNonce = 1;

  before(async function () {
    [deployer, owner, signer1, signer2] = await getSignersWithPrivateKeys();

    // for both chains
    consortium = await deployContract<Consortium & Addressable>('Consortium', [deployer.address]);
    consortium.address = await consortium.getAddress();
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET));

    smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [
      owner.address,
      consortium.address,
      DEFAULT_FEE_PER_BYTE
    ]);
    smailbox.address = await smailbox.getAddress();
    dmailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n]);
    dmailbox.address = await dmailbox.getAddress();

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);
    await smailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [dmailbox.address]));
    await dmailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

    handlerMock = await deployContract<GMPHandlerMock & Addressable>('GMPHandlerMock', [true], false);
    handlerMock.address = await handlerMock.getAddress();

    await smailbox.connect(owner).setDefaultMaxPayloadSize(1000);
    await dmailbox.connect(owner).setDefaultMaxPayloadSize(1000);

    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    beforeEach(async function () {
      await snapshot.restore();
      globalNonce = 1;
    });

    it('Owner', async function () {
      expect(await smailbox.owner()).to.equal(owner.address);
    });

    it('Consortium', async function () {
      expect(await smailbox.consortium()).to.equal(consortium.address);
    });

    it('enableMessagePath owner can', async function () {
      let chain = encode(['uint256'], [12345]);
      let mailbox = ethers.Wallet.createRandom();

      const mailbox32Bytes = encode(['address'], [mailbox.address]);

      const messagePathOut = ethers.keccak256(
        encode(['address', 'bytes32', 'bytes32'], [smailbox.address, lChainId, chain])
      );
      const messagePathIn = ethers.keccak256(
        encode(['address', 'bytes32', 'bytes32'], [mailbox.address, chain, lChainId])
      );

      await expect(smailbox.connect(owner).enableMessagePath(chain, mailbox32Bytes))
        .to.emit(smailbox, 'MessagePathEnabled')
        .withArgs(chain, messagePathIn, messagePathOut, mailbox32Bytes);
    });

    it('enableMessagePath reverts when called by not an owner', async function () {
      let chain = encode(['uint256'], [12345]);
      let mailbox = ethers.Wallet.createRandom();
      await expect(smailbox.connect(signer1).enableMessagePath(chain, encode(['address'], [mailbox.address])))
        .to.revertedWithCustomError(smailbox, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });

    it('enableMessagePath reverts when destination contract is set', async function () {
      const srcContract = encode(['address'], [smailbox.address]);
      const dstContract = encode(['address'], [ethers.Wallet.createRandom().address]);
      await expect(smailbox.connect(owner).enableMessagePath(lChainId, dstContract))
        .to.revertedWithCustomError(smailbox, 'Mailbox_MessagePathEnabled')
        .withArgs(ethers.keccak256(encode(['bytes32', 'bytes32', 'bytes32'], [srcContract, lChainId, lChainId])));
    });

    it('enableMessagePath reverts when chainId is 0', async function () {
      let chain = encode(['uint256'], [0]);
      let mailbox = ethers.Wallet.createRandom();
      await expect(
        smailbox.connect(owner).enableMessagePath(chain, encode(['address'], [mailbox.address]))
      ).to.revertedWithCustomError(smailbox, 'Mailbox_ZeroChainId');
    });

    it('enableMessagePath mailbox cannot be be 0 address', async function () {
      let chain = encode(['uint256'], [12345]);
      let mailbox = ethers.ZeroAddress;
      await expect(
        smailbox.connect(owner).enableMessagePath(chain, encode(['address'], [mailbox]))
      ).to.revertedWithCustomError(smailbox, 'Mailbox_ZeroMailbox');
    });

    // TODO: `setDefaultMaxPayloadSize` reverted with Mailbox_PayloadOversize when set > GLOBAL_MAX_PAYLOAD_SIZE

    it('DefaultMaxPayloadSize', async () => {
      const size = 10000n;
      await expect(smailbox.connect(owner).setDefaultMaxPayloadSize(size))
        .to.emit(smailbox, 'DefaultPayloadSizeSet')
        .withArgs(size);
      expect(await smailbox.getDefaultMaxPayloadSize()).to.be.equal(size);
    });

    // TODO: `setSenderConfig` reverted with Mailbox_PayloadOversize when set > GLOBAL_MAX_PAYLOAD_SIZE

    it('SenderConfig', async () => {
      const payloadSize = 111;
      await expect(smailbox.connect(owner).setSenderConfig(signer2, payloadSize))
        .to.emit(smailbox, 'SenderConfigUpdated')
        .withArgs(signer2, payloadSize);

      const cfg = await smailbox.getSenderConfigWithDefault(signer2);
      expect(cfg['maxPayloadSize']).to.be.eq(payloadSize);
    });

    it('Fee', async () => {
      const fee = 1n;
      await expect(smailbox.connect(owner).setFee(fee)).to.emit(smailbox, 'FeePerByteSet').withArgs(fee);

      // precalculate expected fee
      const payload = getGMPPayload(
        ethers.ZeroAddress,
        ethers.ZeroHash,
        ethers.ZeroHash,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash,
        ethers.ZeroHash,
        '0x'
      );
      const { fee: expectedFee } = await calcFee(payload, fee);
      expect(await smailbox.getFee('0x')).to.be.eq(expectedFee);
    });
  });

  describe('Rescue ERC20', function () {
    // TODO: should revert if not owner
    it('should rescue erc20', async () => {
      const rndAddr = ethers.Wallet.createRandom();
      const someErc20 = await deployContract<LBTCMock>('LBTCMock', [
        rndAddr.address,
        0,
        rndAddr.address,
        owner.address
      ]);
      const AMOUNT = 1_000_000n;
      await someErc20.mintTo(signer2, AMOUNT);
      await someErc20.connect(signer2).transfer(smailbox, AMOUNT);
      expect(await someErc20.balanceOf(signer2)).to.be.eq(0);
      expect(await someErc20.balanceOf(smailbox)).to.be.eq(AMOUNT);

      await smailbox.connect(owner).rescueERC20(someErc20, signer2, AMOUNT);

      expect(await someErc20.balanceOf(signer2)).to.be.eq(AMOUNT);
      expect(await someErc20.balanceOf(smailbox)).to.be.eq(0);
    });
  });

  describe('Base flow', function () {
    beforeEach(async function () {
      await snapshot.restore();
      globalNonce = 1;
    });

    // TODO: `smailbox` throws `Mailbox_NotEnoughFee` when not enough fee

    it('transmit successful', async () => {
      const recipient = encode(['address'], [await handlerMock.getAddress()]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));
      const balanceBefore = await ethers.provider.getBalance(signer1);

      const signer1Bytes = encode(['address'], [signer1.address]);

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        signer1Bytes,
        recipient,
        destinationCaller,
        body
      );

      const { fee, length: payloadLength } = await calcFee(payload, DEFAULT_FEE_PER_BYTE);

      const sendTx = smailbox.connect(signer1).send(lChainId, recipient, destinationCaller, body, { value: fee });

      await expect(sendTx)
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, signer1.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);

      const receipt = await ethers.provider.getTransactionReceipt((await sendTx).hash);
      const txFee = receipt?.fee || 0n;

      const balanceAfter = await ethers.provider.getBalance(signer1);
      // the difference should be GMP Fee + Tx Fee
      expect(balanceBefore - balanceAfter).to.be.equal(txFee + BigInt(fee));

      const { proof, payloadHash } = await signPayload([signer1], [true], payload);

      const result = dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
      await expect(result)
        .to.emit(dmailbox, 'MessageDelivered')
        .withArgs(payloadHash, signer1.address, globalNonce - 1, signer1Bytes, payload);
      await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, signer1.address, body);
    });
  });

  describe('Send', function () {
    let newDstChain: string;
    let newDstMailbox;

    before(async function () {
      await snapshot.restore();
      globalNonce = 1;

      newDstChain = encode(['uint256'], [12345]);
      newDstMailbox = ethers.Wallet.createRandom();
      await smailbox.connect(owner).enableMessagePath(newDstChain, encode(['address'], [newDstMailbox.address]));
    });

    it('New message', async function () {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));
      const sender = signer1;

      const payload = getGMPPayload(
        await smailbox.getAddress(),
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [sender.address]),
        recipient,
        destinationCaller,
        body
      );

      const { fee, length: payloadLength } = await calcFee(payload, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(lChainId, recipient, destinationCaller, body, { value: fee }))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);
    });

    it('Another message to the same chain', async function () {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST 2'));
      const sender = signer1;

      const payload = getGMPPayload(
        await smailbox.getAddress(),
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [sender.address]),
        recipient,
        destinationCaller,
        body
      );

      const { fee, length: payloadLength } = await calcFee(payload, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(lChainId, recipient, destinationCaller, body, { value: fee }))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload)
        .and.to.emit(smailbox, 'MessagePaid')
        .withArgs(ethers.sha256(payload), signer1.address, payloadLength, fee);
    });

    it('Message to different chain', async function () {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST 3'));
      const sender = signer2;

      const payload = getGMPPayload(
        await smailbox.getAddress(),
        lChainId,
        newDstChain,
        globalNonce++,
        encode(['address'], [sender.address]),
        recipient,
        destinationCaller,
        body
      );
      const { fee, length: payloadLength } = await calcFee(payload, DEFAULT_FEE_PER_BYTE);

      await expect(smailbox.connect(sender).send(newDstChain, recipient, destinationCaller, body, { value: fee }))
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
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        fee: VERY_BIG_FEE,
        error: 'Mailbox_MessagePathDisabled'
      },
      {
        name: 'Recipient is 0 address',
        destinationChain: () => lChainId,
        recipient: () => encode(['address'], [ethers.ZeroAddress]),
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        fee: VERY_BIG_FEE,
        error: 'Mailbox_ZeroRecipient'
      },
      {
        name: 'Not enough fee',
        destinationChain: () => lChainId,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        fee: 1,
        error: 'Mailbox_NotEnoughFee'
      }
    ];

    invalidArgs.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        await expect(
          smailbox.connect(signer1).send(arg.destinationChain(), arg.recipient(), arg.destinationCaller(), arg.body(), {
            value: arg.fee
          })
        ).to.revertedWithCustomError(smailbox, arg.error);
      });
    });

    it('Reverts when payload oversized', async () => {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const body = ethers.hexlify(new Uint8Array(255));

      const payload = getGMPPayload(
        await smailbox.getAddress(),
        lChainId,
        lChainId,
        globalNonce,
        encode(['address'], [signer1.address]),
        recipient,
        destinationCaller,
        body
      );

      const { fee, length: payloadLength } = await calcFee(payload, DEFAULT_FEE_PER_BYTE);

      // max payload for sender payload.length - 1
      await smailbox.connect(owner).setSenderConfig(signer1, payloadLength - 1);

      await expect(smailbox.connect(signer1).send(lChainId, recipient, destinationCaller, body, { value: fee }))
        .to.revertedWithCustomError(smailbox, 'Mailbox_PayloadOversize')
        .withArgs(payloadLength - 1, payloadLength);
    });
  });

  describe('Deliver and handle', function () {
    describe('Caller is specified', function () {
      let recipient: string;
      let destinationCaller: Signer;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;
      let msgSender: string;
      let nonce: bigint;

      before(async function () {
        await snapshot.restore();

        recipient = encode(['address'], [handlerMock.address]);
        destinationCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        const args = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args;
        expect(args.payload).to.not.undefined;
        payload = args.payload;
        msgSender = encode(['address'], [args.msgSender]);
        nonce = ethers.toBigInt(payload.slice(74, 138));

        let res = await signPayload([signer1], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle reverts when called by unauthorized caller', async function () {
        await expect(dmailbox.connect(signer1).deliverAndHandle(payload, proof))
          .to.be.revertedWithCustomError(dmailbox, 'Mailbox_UnexpectedDestinationCaller')
          .withArgs(destinationCaller.address, signer1.address);
      });

      it('deliverAndHandle by authorized caller', async function () {
        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, nonce, msgSender, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('repeated deliverAndHandle does not produce MessageDelivered event', async function () {
        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('other mailbox on dst chain can receive this message', async function () {
        const newDstMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [
          owner.address,
          consortium.address,
          0
        ]);
        newDstMailbox.address = await newDstMailbox.getAddress();
        await newDstMailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

        const result = await newDstMailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(newDstMailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(newDstMailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, nonce, msgSender, payload);
        await expect(result)
          .to.emit(newDstMailbox, 'MessageHandled')
          .withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('deliver another message from the same dst', async function () {
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST 2'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        const args = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args;
        expect(args.payload).to.not.undefined;
        payload = args.payload;
        msgSender = encode(['address'], [args.msgSender]);
        nonce = ethers.toBigInt(payload.slice(74, 138));

        let res = await signPayload([signer1], [true], payload);

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, res.proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(res.payloadHash, destinationCaller.address, nonce, msgSender, payload);
        await expect(result)
          .to.emit(dmailbox, 'MessageHandled')
          .withArgs(res.payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('deliver message from new dst', async function () {
        const newSrcChain = encode(['uint256'], [12345]);
        const newSrcMailbox = ethers.Wallet.createRandom();
        await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox.address]));
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST 3'));

        const payload = getGMPPayload(
          newSrcMailbox.address,
          newSrcChain,
          lChainId,
          globalNonce++,
          encode(['address'], [signer1.address]),
          recipient,
          encode(['address'], [destinationCaller.address]),
          body
        );
        const { proof, payloadHash } = await signPayload([signer1], [true], payload);

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, globalNonce - 1, msgSender, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
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

      before(async function () {
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

        let res = await signPayload([signer1], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('any address can call deliverAndHandle', async function () {
        let destinationCaller = signer1;
        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, globalNonce, signer1Bytes, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('repeat deliverAndHandle with different caller', async function () {
        let destinationCaller = signer2;
        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Recipient rejects call and retry later', function () {
      let recipient: string;
      let destinationCaller: Signer;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;
      let signer1Bytes: string;

      before(async function () {
        await snapshot.restore();
        globalNonce = 1;
        signer1Bytes = encode(['address'], [signer1.address]);

        recipient = encode(['address'], [handlerMock.address]);
        destinationCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body, { value: VERY_BIG_FEE });
        let receipt = await tx.wait();
        // @ts-ignore
        payload = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([signer1], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle when recipient is inactive', async function () {
        await handlerMock.disable();

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result)
          .to.emit(dmailbox, 'MessageHandleError')
          .withArgs(payloadHash, destinationCaller.address, 'not enabled');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, globalNonce, signer1Bytes, payload);
        await expect(result).to.not.emit(dmailbox, 'MessageHandled');
        await expect(result).to.not.emit(handlerMock, 'MessageReceived');
      });

      it('retry deliverAndHandle when recipient is still inactive', async function () {
        await handlerMock.disable();

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result)
          .to.emit(dmailbox, 'MessageHandleError')
          .withArgs(payloadHash, destinationCaller.address, 'not enabled');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.not.emit(dmailbox, 'MessageHandled');
        await expect(result).to.not.emit(handlerMock, 'MessageReceived');
      });

      it('retry deliverAndHandle when recipient became active', async function () {
        await handlerMock.enable();

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Payload is invalid', function () {
      let unknownMailbox: Mailbox & Addressable;

      before(async function () {
        await snapshot.restore();
        unknownMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0]);
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
          notary: () => signer1,
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
          notary: () => signer1,
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
          notary: () => signer1,
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
          notary: () => signer1,
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
          notary: () => signer1,
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
          notary: () => signer1,
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
        //   notary: () => signer1,
        //   customError: 'Mailbox_HandlerNotImplemented'
        // },
      ];

      args.forEach(function (arg) {
        it(`Reverts when ${arg.name}`, async () => {
          let destinationCaller = signer2;
          let body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

          const payload = getGMPPayload(
            arg.srcContract(),
            arg.srcChain(),
            arg.dstChain(),
            arg.nonce(),
            encode(['address'], [arg.sender()]),
            encode(['address'], [arg.recipientAddress()]),
            encode(['address'], [destinationCaller.address]),
            body
          );

          const { proof } = await signPayload([arg.notary()], [true], payload);

          await expect(
            dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof)
            // @ts-ignore
          ).to.be.revertedWithCustomError(...arg.customError());
        });
      });
    });
  });
});
