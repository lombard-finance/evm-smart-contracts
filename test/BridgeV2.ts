import { MailboxMock, LBTCMock, BridgeV2, Consortium, Mailbox, LBTC } from '../typechain-types';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  getSignersWithPrivateKeys,
  deployContract,
  encode,
  Signer,
  getGMPPayload,
  getPayloadForAction,
  NEW_VALSET,
  signPayload,
  randomBigInt
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

describe('BridgeV2', function () {
  let deployer: Signer, owner: Signer, minter: Signer, signer1: Signer, signer2: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let sLBTC: LBTC & Addressable, dLBTC: LBTC & Addressable;
  let sbridge: BridgeV2 & Addressable, dbridge: BridgeV2 & Addressable;

  let lChainId: string;
  let globalNonce = 0;
  let snapshot: SnapshotRestorer;

  const AMOUNT = 1000_0000_0000n;
  let sBridgeBytes: string;
  let dBridgeBytes: string;

  before(async function () {
    [deployer, owner, minter, signer1, signer2] = await getSignersWithPrivateKeys();

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

    sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
    sbridge.address = await sbridge.getAddress();
    dbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, dmailbox.address]);
    dbridge.address = await dbridge.getAddress();

    // LBTC tokens
    sLBTC = await deployContract<LBTC & Addressable>('LBTC', [consortium.address, 0, owner.address, owner.address]);
    sLBTC.address = await sLBTC.getAddress();
    await sLBTC.connect(owner).addMinter(minter.address);
    dLBTC = await deployContract<LBTC & Addressable>('LBTC', [consortium.address, 0, owner.address, owner.address]);
    dLBTC.address = await dLBTC.getAddress();
    await dLBTC.connect(owner).addMinter(minter.address);
    await dLBTC.connect(owner).addMinter(dbridge.address);

    sBridgeBytes = encode(['address'], [sbridge.address]);
    dBridgeBytes = encode(['address'], [dbridge.address]);

    await sLBTC.connect(minter)['mint(address,uint256)'](signer1.address, AMOUNT);
    await sLBTC.connect(signer1).approve(sbridge.address, ethers.MaxUint256);

    await sbridge.connect(owner).setDestinationBridge(lChainId, dBridgeBytes);
    await dbridge.connect(owner).setDestinationBridge(lChainId, sBridgeBytes);

    await sbridge.connect(owner).setDestinationToken(lChainId, sLBTC.address, encode(['address'], [dLBTC.address]));
    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    beforeEach(async function () {
      await snapshot.restore();
      globalNonce = 0;
    });

    it('Owner address', async function () {
      expect(await sbridge.owner()).to.equal(owner.address);
    });

    it('Mailbox address', async function () {
      expect(await sbridge.mailbox()).to.equal(smailbox.address);
    });
  });

  describe('Base flow', function () {
    before(async function () {
      await snapshot.restore();
      globalNonce = 0;
    });
    // TODO: should fail if token not added
    // TODO: should fail if destination bridge not added

    it('successful', async () => {
      const recipient = encode(['address'], [signer1.address]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC.address]), recipient, AMOUNT]
      );

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        sBridgeBytes,
        dBridgeBytes,
        destinationCaller,
        body
      );
      const { proof } = await signPayload([signer1], [true], payload);

      await expect(sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, AMOUNT, destinationCaller))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload);

      const tx = await dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
      await expect(tx)
        .to.emit(dbridge, 'WithdrawFromBridge')
        .withArgs(signer1.address, lChainId, dLBTC.address, AMOUNT);
    });

    // TODO: revert after message path disabled (when implemented)
    // TODO: revert if destination caller set, but caller is different
    // TODO: `MessageHandleError` emitted if handler call failed, but reprocessable without signatures
  });

  describe('Deposit', function () {
    before(async function () {
      await snapshot.restore();
      globalNonce = 0;
    });

    it('New message', async function () {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const amount = randomBigInt(10);
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC.address]), recipient, amount]
      );

      const sLbtcSupplyBefore = await sLBTC.totalSupply();

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        sBridgeBytes,
        dBridgeBytes,
        destinationCaller,
        body
      );

      const tx = await sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, amount, destinationCaller);
      await expect(tx)
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload)
        .and.to.emit(sLBTC, 'Transfer')
        .withArgs(signer1.address, sbridge.address, amount);
      await expect(tx).to.changeTokenBalance(sLBTC, signer1.address, -1n * amount);

      const sLbtcSupplyAfter = await sLBTC.totalSupply();
      expect(sLbtcSupplyBefore - sLbtcSupplyAfter).to.be.eq(amount);
    });

    it('Another message to the same chain', async function () {
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const amount = randomBigInt(10);
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC.address]), recipient, amount]
      );

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        sBridgeBytes,
        dBridgeBytes,
        destinationCaller,
        body
      );

      await expect(sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, amount, destinationCaller))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload);
    });

    it('To the new destination chain', async function () {
      let newDstChain = encode(['uint256'], [12345]);
      let newDstMailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
      await smailbox.connect(owner).enableMessagePath(newDstChain, newDstMailbox);

      let newDstToken = ethers.Wallet.createRandom().address;
      let newDstBridge = encode(['address'], [ethers.Wallet.createRandom().address]);
      await sbridge.connect(owner).setDestinationBridge(newDstChain, newDstBridge);
      await sbridge.connect(owner).setDestinationToken(newDstChain, sLBTC.address, encode(['address'], [newDstToken]));

      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const amount = randomBigInt(10);
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [newDstToken]), recipient, amount]
      );

      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        newDstChain,
        globalNonce++,
        sBridgeBytes,
        newDstBridge,
        destinationCaller,
        body
      );

      await expect(sbridge.connect(signer1).deposit(newDstChain, sLBTC.address, recipient, amount, destinationCaller))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(newDstChain, sbridge.address, newDstBridge, payload);
    });

    const invalidArgs = [
      {
        name: 'Unsupported destination chain',
        destinationChain: () => encode(['uint256'], [123]),
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_PathNotAllowed']
      },
      {
        name: 'Unsupported token',
        destinationChain: () => lChainId,
        token: () => ethers.Wallet.createRandom().address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_TokenNotAllowed']
      },
      {
        name: 'Recipient is 0 address',
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.ZeroAddress]),
        amount: () => 10000_0000,
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_ZeroRecipient']
      },
      {
        name: 'Amount is 0',
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 0,
        destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_ZeroAmount']
      }
      // {
      //   name: 'Correct case',
      //   destinationChain: () => lChainId,
      //   token: () => sLBTC.address,
      //   recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      //   amount: () => 10000_0000,
      //   destinationCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      // },
    ];

    invalidArgs.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        await expect(
          sbridge
            .connect(signer1)
            .deposit(arg.destinationChain(), arg.token(), arg.recipient(), arg.amount(), arg.destinationCaller())
        )
          // @ts-ignore
          .to.be.revertedWithCustomError(...arg.customError());
      });
    });
  });
});
