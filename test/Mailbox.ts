import { Consortium, Mailbox, GMPHandlerMock } from '../typechain-types';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  getSignersWithPrivateKeys,
  deployContract,
  getPayloadForAction,
  NEW_VALSET,
  encode,
  Signer,
  signPayload,
  getGMPPayload
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';

describe('Mailbox', function () {
  let deployer: Signer, signer1: Signer, signer2: Signer;
  let consortium: Consortium;
  let mailbox: Mailbox;
  let snapshot: SnapshotRestorer;
  let lChainId: string;
  let handlerMock: GMPHandlerMock;
  let globalNonce = 0;

  before(async function () {
    [deployer, signer1, signer2] = await getSignersWithPrivateKeys();

    // for both chains
    consortium = await deployContract<Consortium>('Consortium', [deployer.address]);
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET));

    mailbox = await deployContract<Mailbox>('Mailbox', [deployer.address, await consortium.getAddress()]);

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);

    await mailbox.enableMessagePath(lChainId, encode(['address'], [await mailbox.getAddress()]));

    handlerMock = await deployContract<GMPHandlerMock>('GMPHandlerMock', [true], false);

    snapshot = await takeSnapshot();
  });

  afterEach(async function () {
    await snapshot.restore();
    globalNonce = 0;
  });

  describe('Setters and Getters', () => {
    it('should return owner', async function () {
      expect(await mailbox.owner()).to.equal(deployer.address);
    });

    it('should return consortium', async function () {
      expect(await mailbox.consortium()).to.equal(await consortium.getAddress());
    });
  });

  describe('Transmit', function () {
    it('transmit successful', async () => {
      const recipient = encode(['address'], [await handlerMock.getAddress()]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.hexlify(ethers.toUtf8Bytes('TEST'));

      const payload = getGMPPayload(
        await mailbox.getAddress(),
        lChainId,
        lChainId,
        globalNonce++,
        encode(['address'], [signer1.address]),
        recipient,
        destinationCaller,
        body
      );

      await expect(mailbox.connect(signer1).send(lChainId, recipient, destinationCaller, body))
        .to.emit(mailbox, 'MessageSent')
        .withArgs(lChainId, signer1.address, recipient, payload);

      const { proof, payloadHash } = await signPayload([signer1], [true], payload);

      const result = mailbox.connect(signer1).deliverAndHandle(payload, proof);
      // await expect(result).to.emit(mailbox, 'MessageHandleError').withArgs(payloadHash, signer1.address, 'dfad');
      await expect(result).to.not.emit(mailbox, 'MessageHandleError');
      await expect(result).to.emit(mailbox, 'MessageDelivered').withArgs(payloadHash, signer1.address, payload);
      await expect(result).to.emit(mailbox, 'MessageHandled').withArgs(payloadHash, signer1.address, body);
    });

    // TODO: revert after message path disabled (when implemented)
    // TODO: revert if destination caller set, but caller is different
    // TODO: `MessageHandleError` emitted if handler call failed, but reprocessable without signatures
  });
});
