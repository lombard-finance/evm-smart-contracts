import { Consortium, GMPHandlerMock, Mailbox } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  encode,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  GMP_V1_SELECTOR,
  NEW_VALSET,
  Signer,
  signPayload
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';

function getGMPPayload(
  sourceContract: string,
  sourceLChainId: string,
  destinationLChainId: string,
  nonce: number,
  sender: string,
  recipient: string,
  destinationCaller: string,
  msgBody: string
): string {
  const messagePath = ethers.keccak256(
    encode(['address', 'bytes32', 'bytes32'], [sourceContract, sourceLChainId, destinationLChainId])
  );

  return getPayloadForAction(
    [messagePath, encode(['uint256'], [nonce]), sender, recipient, destinationCaller, msgBody],
    GMP_V1_SELECTOR
  );
}

class Addressable {
  get address(): string {
    return this._address;
  }

  set address(value: string) {
    this._address = value;
  }
  private _address: string;
}

describe('Mailbox', function () {
  let deployer: Signer, owner: Signer, signer1: Signer, signer2: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let snapshot: SnapshotRestorer;
  let lChainId: string;
  let handlerMock: GMPHandlerMock & Addressable;
  let globalNonce = 0;

  before(async function () {
    [deployer, owner, signer1, signer2] = await getSignersWithPrivateKeys();

    // for both chains
    consortium = await deployContract<Consortium & Addressable>('Consortium', [deployer.address]);
    consortium.address = await consortium.getAddress();
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET));

    smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address]);
    smailbox.address = await smailbox.getAddress();
    dmailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address]);
    dmailbox.address = await dmailbox.getAddress();

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);
    await smailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [dmailbox.address]));
    await dmailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

    handlerMock = await deployContract<GMPHandlerMock & Addressable>('GMPHandlerMock', [true], false);
    handlerMock.address = await handlerMock.getAddress();

    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    beforeEach(async function () {
      await snapshot.restore();
      globalNonce = 0;
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
      await expect(smailbox.connect(owner).enableMessagePath(chain, encode(['address'], [mailbox.address])))
        .to.emit(smailbox, 'MessagePathEnabled')
        .withArgs(chain, encode(['address'], [mailbox.address]));
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
      await expect(smailbox.connect(owner).enableMessagePath(chain, encode(['address'], [mailbox.address])))
        .to.revertedWithCustomError(smailbox, 'Mailbox_ZeroChainId');
    });

    //When mailbox is 0 address it means that it wont be able to receive any message, only send
    it('enableMessagePath mailbox can be 0 address', async function () {
      let chain = encode(['uint256'], [12345]);
      let mailbox = ethers.ZeroAddress;
      await expect(smailbox.connect(owner).enableMessagePath(chain, encode(['address'], [mailbox])))
        .to.emit(smailbox, 'MessagePathEnabled')
        .withArgs(chain, encode(['address'], [mailbox]));
    });
  });

  describe('Base flow', function () {
    beforeEach(async function () {
      await snapshot.restore();
      globalNonce = 0;
    });

    it('transmit successful', async () => {
      const recipient = encode(['address'], [await handlerMock.getAddress()]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [signer1.address]),
        recipient,
        destinationCaller,
        body
      );

      await expect(smailbox.connect(signer1).send(lChainId, recipient, destinationCaller, body))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, signer1.address, recipient, payload);

      const { proof, payloadHash } = await signPayload([signer1], [true], payload);

      const result = dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
      await expect(result).to.emit(dmailbox, 'MessageDelivered').withArgs(payloadHash, signer1.address, payload);
      await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, signer1.address, body);
    });
  });

  describe('Send', function () {
    let newDstChain: string;
    let newDstMailbox;

    before(async function () {
      await snapshot.restore();
      globalNonce = 0;

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

      await expect(smailbox.connect(sender).send(lChainId, recipient, destinationCaller, body))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload);
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

      await expect(smailbox.connect(sender).send(lChainId, recipient, destinationCaller, body))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sender.address, recipient, payload);
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

      await expect(smailbox.connect(sender).send(newDstChain, recipient, destinationCaller, body))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(newDstChain, sender.address, recipient, payload);
    });

    const invalidArgs = [
      {
        name: 'Unknown destination chain',
        destinationChain: () => encode(['uint256'], [123]),
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        error: 'Mailbox_MessagePathDisabled'
      },
      {
        name: 'Recipient is 0 address',
        destinationChain: () => lChainId,
        recipient: () => encode(['address'], [ethers.ZeroAddress]),
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
        error: 'Mailbox_MessagePathDisabled'
      }
      //TODO: body max size
      // {
      //   name: 'Unknown destination chain',
      //   destinationChain: () => lChainId,
      //   recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      //   destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      //   body: () => ethers.hexlify(ethers.toUtf8Bytes('TEST')),
      //   error: 'Mailbox_MessagePathDisabled'
      // }
    ];

    invalidArgs.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        await expect(
          smailbox.connect(signer1).send(arg.destinationChain(), arg.recipient(), arg.destinationCaller(), arg.body())
        ).to.revertedWithCustomError(smailbox, arg.error);
      });
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

      before(async function () {
        await snapshot.restore();

        recipient = encode(['address'], [handlerMock.address]);
        destinationCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body);
        let receipt = await tx.wait();
        payload = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args.payload;
        expect(payload).to.not.undefined;

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
          .withArgs(payloadHash, destinationCaller.address, payload);
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

      it('deliver another message from the same dst', async function () {
        let body = ethers.hexlify(ethers.toUtf8Bytes('TEST 2'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body);
        let receipt = await tx.wait();
        let payload = receipt?.logs.find(l => l.eventName === 'MessageSent')?.args.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([signer1], [true], payload);

        const result = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, res.proof);
        await expect(result).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(res.payloadHash, destinationCaller.address, payload);
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
          .withArgs(payloadHash, destinationCaller.address, payload);
        await expect(result).to.emit(dmailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });

      it('other mailbox on dst chain can receive this message', async function () {
        const newDstMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address]);
        newDstMailbox.address = await newDstMailbox.getAddress();
        await newDstMailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

        const result = await newDstMailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(result).to.not.emit(newDstMailbox, 'MessageHandleError');
        await expect(result)
          .to.emit(newDstMailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, payload);
        await expect(result).to.emit(newDstMailbox, 'MessageHandled').withArgs(payloadHash, destinationCaller.address, body);
        await expect(result).to.emit(handlerMock, 'MessageReceived').withArgs(body);
      });
    });

    describe('Caller is arbitrary', function () {
      let recipient: string;
      let body: string;
      let payload: string;
      let proof: string;
      let payloadHash: string;

      before(async function () {
        await snapshot.restore();
        globalNonce = 0;

        recipient = encode(['address'], [handlerMock.address]);
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [ethers.ZeroAddress]), body);
        let receipt = await tx.wait();
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
          .withArgs(payloadHash, destinationCaller.address, payload);
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

      before(async function () {
        await snapshot.restore();
        globalNonce = 0;

        recipient = encode(['address'], [handlerMock.address]);
        destinationCaller = signer2;
        body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

        let tx = await smailbox
          .connect(signer1)
          .send(lChainId, recipient, encode(['address'], [destinationCaller.address]), body);
        let receipt = await tx.wait();
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
          .withArgs(payloadHash, destinationCaller.address, payload);
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
        unknownMailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address]);
        unknownMailbox.address = await unknownMailbox.getAddress();
      });
      let nonce = 0;

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
          ).to.be.revertedWithCustomError(...arg.customError());
        });
      });
    });
  });
});
