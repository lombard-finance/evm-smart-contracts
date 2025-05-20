import { BridgeV2, Consortium, LBTC, Mailbox } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  encode,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  GMP_V1_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  Signer,
  signPayload
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractTransactionReceipt } from 'ethers';
import { GMPUtils } from '../typechain-types/contracts/gmp/IHandler';
import PayloadStruct = GMPUtils.PayloadStruct;

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

const BRIDGE_PAYLOAD_SIZE = 356;

describe('BridgeV2', function () {
  let deployer: Signer, owner: Signer, minter: Signer, signer1: Signer, signer2: Signer, signer3: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let sLBTC: LBTC & Addressable, dLBTC: LBTC & Addressable;
  let sbridge: BridgeV2 & Addressable, dbridge: BridgeV2 & Addressable;

  let lChainId: string;
  let globalNonce = 1;
  let snapshot: SnapshotRestorer;

  const AMOUNT = 1000_0000_0000n;
  let sBridgeBytes: string;
  let dBridgeBytes: string;

  before(async () => {
    [deployer, owner, minter, signer1, signer2, signer3] = await getSignersWithPrivateKeys();

    // for both chains
    consortium = await deployContract<Consortium & Addressable>('Consortium', [deployer.address]);
    consortium.address = await consortium.getAddress();
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET));

    smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    smailbox.address = await smailbox.getAddress();
    dmailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
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
    // allow required payload size and exclude from fees
    await smailbox.connect(deployer).setSenderConfig(sbridge, BRIDGE_PAYLOAD_SIZE, true);

    await sLBTC.connect(minter)['mint(address,uint256)'](signer1.address, AMOUNT);
    await sLBTC.connect(signer1).approve(sbridge.address, ethers.MaxUint256);

    await sbridge.connect(owner).setDestinationBridge(lChainId, dBridgeBytes);
    await dbridge.connect(owner).setDestinationBridge(lChainId, sBridgeBytes);

    await sbridge.connect(owner).setDestinationToken(lChainId, sLBTC.address, encode(['address'], [dLBTC.address]));
    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    describe('Vew functions', () => {
      before(async () => {
        await snapshot.restore();
        globalNonce = 1;
      });

      it('Owner address', async () => {
        expect(await sbridge.owner()).to.equal(owner.address);
      });

      it('Mailbox address', async () => {
        expect(await sbridge.mailbox()).to.equal(smailbox.address);
      });
    });

    describe('setDestinationBridge', () => {
      let sbridge: BridgeV2 & Addressable;

      beforeEach(async () => {
        await snapshot.restore();
        globalNonce = 0;

        sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
        sbridge.address = await sbridge.getAddress();
      });

      //TODO: check for event
      it('setDestinationBridge owner can set', async () => {
        await sbridge.connect(owner).setDestinationBridge(lChainId, dBridgeBytes);
        expect(await sbridge.destinationBridge(lChainId)).to.be.eq(dBridgeBytes);
      });

      it('setDestinationBridge owner can update address', async () => {
        const newDBridgBytes = encode(['address'], [ethers.Wallet.createRandom().address]);
        await sbridge.connect(owner).setDestinationBridge(lChainId, newDBridgBytes);
        expect(await sbridge.destinationBridge(lChainId)).to.be.eq(newDBridgBytes);
      });

      it('setDestinationBridge reverts when called by not an owner', async () => {
        await expect(sbridge.connect(deployer).setDestinationBridge(lChainId, dBridgeBytes))
          .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
          .withArgs(deployer.address);
      });

      it('setDestinationBridge reverts when chain is 0', async () => {
        await expect(
          sbridge.connect(owner).setDestinationBridge(encode(['uint256'], [0]), dBridgeBytes)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroChainId');
      });

      it('setDestinationBridge owner can set to 0', async () => {
        const newDBridgBytes = encode(['address'], [ethers.ZeroAddress]);
        await sbridge.connect(owner).setDestinationBridge(lChainId, newDBridgBytes);
        expect(await sbridge.destinationBridge(lChainId)).to.be.eq(newDBridgBytes);
      });
    });

    describe('setDestinationToken', () => {
      let sbridge: BridgeV2 & Addressable;
      const destinationChain = encode(['uint256'], [randomBigInt(8)]);
      const sourceToken = ethers.Wallet.createRandom().address;
      const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);

      before(async () => {
        await snapshot.restore();
        globalNonce = 0;

        sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
        sbridge.address = await sbridge.getAddress();
        await sbridge.connect(owner).setDestinationBridge(destinationChain, dBridgeBytes);
      });

      //TODO: check for event
      it('setDestinationToken owner can', async () => {
        await sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken);
      });

      it('setDestinationToken add another sourceToken destinationToken pair for chain', async () => {
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken);
      });

      //TODO: must revert
      it('setDestinationToken add another sourceToken for the destinationToken', async () => {
        const sourceToken = ethers.Wallet.createRandom().address;
        await sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken);
      });

      //TODO: shall replace destination token?
      it('setDestinationToken add another destinationToken for sourceToken', async () => {
        const destinationToken = ethers.Wallet.createRandom().address;
        await sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken);
      });

      it('setDestinationToken reverts when called by not an owner', async () => {
        const destinationChain = encode(['uint256'], [randomBigInt(8)]);
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(deployer).setDestinationToken(destinationChain, sourceToken, destinationToken))
          .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
          .withArgs(deployer.address);
      });

      it('setDestinationToken reverts when destination chain is 0', async () => {
        const destinationChain = encode(['uint256'], [0]);
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken))
          .to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroPath')
          .withArgs(deployer.address);
      });

      it('setDestinationToken reverts when sourceToken is 0', async () => {
        const destinationChain = encode(['uint256'], [randomBigInt(8)]);
        const sourceToken = ethers.ZeroAddress;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(owner).setDestinationToken(destinationChain, sourceToken, destinationToken))
          .to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroToken')
          .withArgs(deployer.address);
      });
    });
  });

  describe('Base flow', function () {
    before(async () => {
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
    before(async () => {
      await snapshot.restore();
      globalNonce = 0;
    });

    it('New message', async () => {
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

    it('decodeMsgBody returns input args', async () => {
      const recipient = ethers.Wallet.createRandom().address;
      const destinationCaller = encode(['address'], [ethers.Wallet.createRandom().address]);
      const amount = randomBigInt(10);

      const tx = await sbridge
        .connect(signer1)
        .deposit(lChainId, sLBTC.address, encode(['address'], [recipient]), amount, destinationCaller);
      let receipt = (await tx.wait()) as ContractTransactionReceipt;
      globalNonce++;
      const logsPayload = payloadFromLogs(receipt);
      expect(logsPayload).to.not.undefined;
      const payload = decodePayload(logsPayload);

      const res = await dbridge.decodeMsgBody(payload.msgBody);
      expect(res[0]).to.be.eq(dLBTC.address);
      expect(res[1]).to.be.eq(recipient);
      expect(res[2]).to.be.eq(amount);
    });

    it('Another message to the same chain', async () => {
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

    it('To the new destination chain', async () => {
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

    //TODO: deposit different token

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
      it(`Reverts when ${arg.name}`, async () => {
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

  describe('Deliver and handle', function () {
    describe('Destination caller is specified', function () {
      let recipient: Signer;
      let destinationCaller: Signer;
      let amount: bigint;
      let payload: string;
      let proof: string;
      let payloadHash: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 0;

        recipient = signer2;
        destinationCaller = signer3;
        amount = randomBigInt(8);

        const tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [destinationCaller.address])
          );
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        payload = payloadFromLogs(receipt);
        expect(payload).to.not.undefined;

        let res = await signPayload([signer1], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle reverts when called by unauthorized caller', async () => {
        await expect(dmailbox.connect(signer1).deliverAndHandle(payload, proof))
          .to.be.revertedWithCustomError(dmailbox, 'Mailbox_UnexpectedDestinationCaller')
          .withArgs(destinationCaller.address, signer1.address);
      });

      it('handlePayload reverts when called by not a mailbox', async () => {
        const payloadStruct = decodePayload(payload);
        await expect(dbridge.connect(signer1).handlePayload(payloadStruct)).to.be.revertedWithCustomError(
          dbridge,
          'BridgeV2_MailboxExpected'
        );
      });

      it('deliverAndHandle by authorized caller', async () => {
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('repeated deliverAndHandle does not mint', async () => {
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx).to.not.emit(dbridge, 'WithdrawFromBridge');
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, 0n);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter).to.be.eq(dLbtcSupplyBefore);
      });

      it('deliver another message from the same src', async () => {
        let amount = randomBigInt(6);
        let tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [destinationCaller.address])
          );
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        payload = payloadFromLogs(receipt);
        expect(payload).to.not.undefined;

        let res = await signPayload([signer1], [true], payload);

        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, res.proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(res.payloadHash, destinationCaller.address, payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('deliver message from new src', async () => {
        const newSrcChain = encode(['uint256'], [12345]);
        const newSrcMailbox = ethers.Wallet.createRandom().address;
        const newSrcBridge = ethers.Wallet.createRandom().address;
        const newSrcBridgeBytes = encode(['address'], [newSrcBridge]);
        await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox]));
        await dbridge.connect(owner).setDestinationBridge(newSrcChain, newSrcBridgeBytes);

        const amount = randomBigInt(8);
        const body = ethers.solidityPacked(
          ['uint8', 'bytes32', 'bytes32', 'uint256'],
          [
            await sbridge.MSG_VERSION(),
            encode(['address'], [dLBTC.address]),
            encode(['address'], [recipient.address]),
            amount
          ]
        );

        const payload = getGMPPayload(
          newSrcMailbox,
          newSrcChain,
          lChainId,
          globalNonce++,
          newSrcBridgeBytes,
          dBridgeBytes,
          encode(['address'], [destinationCaller.address]),
          body
        );

        const { proof, payloadHash } = await signPayload([signer1], [true], payload);
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, newSrcChain, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      //TODO: deposit different token
    });

    describe('Caller is arbitrary', function () {
      let recipient: Signer;
      let destinationCaller: Signer;
      let amount: bigint;
      let payload: string;
      let proof: string;
      let payloadHash: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 0;

        recipient = signer2;
        destinationCaller = signer3;
        amount = randomBigInt(8);

        const tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [ethers.ZeroAddress])
          );
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        payload = payloadFromLogs(receipt);
        expect(payload).to.not.undefined;

        let res = await signPayload([signer1], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('any address can call deliverAndHandle', async () => {
        let destinationCaller = signer1;

        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, destinationCaller.address, payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('repeat deliverAndHandle with different caller', async () => {
        let destinationCaller = signer2;
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx).to.not.emit(dbridge, 'WithdrawFromBridge');
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, 0n);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter).to.be.eq(dLbtcSupplyBefore);
      });
    });

    describe('Payload is invalid', function () {
      let unknownToken: LBTC & Addressable;
      let nonce = 0;
      let newSrcChain: string;
      let newSrcMailbox: string;
      let newSrcBridge: string;
      let newSrcBridgeBytes: string;
      let messagePath: string;
      let newSrcMessagePath: string;

      before(async () => {
        await snapshot.restore();

        newSrcChain = encode(['uint256'], [12345]);
        newSrcMailbox = ethers.Wallet.createRandom().address;
        newSrcBridge = ethers.Wallet.createRandom().address;
        newSrcBridgeBytes = encode(['address'], [newSrcBridge]);
        await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox]));

        messagePath = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [smailbox.address, lChainId, lChainId])
        );
        newSrcMessagePath = ethers.keccak256(
          encode(['address', 'bytes32', 'bytes32'], [newSrcMailbox, newSrcChain, lChainId])
        );

        unknownToken = await deployContract<LBTC & Addressable>('LBTC', [
          consortium.address,
          0,
          owner.address,
          owner.address
        ]);
        unknownToken.address = await unknownToken.getAddress();
        await unknownToken.connect(owner).addMinter(dbridge.address);
      });

      const args = [
        {
          name: 'message version is different',
          msgVersion: () => 32n,
          dstToken: () => dLBTC.address,
          tokenRecipient: () => signer1.address,
          amount: () => randomBigInt(8),
          messagePath: () => messagePath,
          sBridgeBytes: () => sBridgeBytes,
          bodyModifier: (body: string): string => body,
          customError: (arg: any) =>
            dbridge.interface.encodeErrorResult('BridgeV2_VersionMismatch', [1n, arg.msgVersion()])
        },
        {
          name: 'tokens recipient is 0 address',
          msgVersion: () => 1n,
          dstToken: () => dLBTC.address,
          tokenRecipient: () => ethers.ZeroAddress,
          amount: () => randomBigInt(8),
          messagePath: () => messagePath,
          sBridgeBytes: () => sBridgeBytes,
          bodyModifier: (body: string): string => body,
          customError: (arg: any) => dLBTC.interface.encodeErrorResult('ERC20InvalidReceiver', [arg.tokenRecipient()])
        },
        {
          name: 'bridge came from unsupported chain',
          msgVersion: () => 1n,
          dstToken: () => dLBTC.address,
          tokenRecipient: () => signer1.address,
          amount: () => randomBigInt(8),
          messagePath: () => newSrcMessagePath,
          sBridgeBytes: () => newSrcBridgeBytes,
          bodyModifier: (body: string): string => body,
          customError: (arg: any) => dbridge.interface.encodeErrorResult('BridgeV2_PathNotAllowed', [])
        },
        {
          name: 'src bridge address is different',
          msgVersion: () => 1n,
          dstToken: () => dLBTC.address,
          tokenRecipient: () => signer1.address,
          amount: () => randomBigInt(8),
          messagePath: () => messagePath,
          sBridgeBytes: () => newSrcBridgeBytes,
          bodyModifier: (body: string): string => body,
          customError: (arg: any) => dbridge.interface.encodeErrorResult('BridgeV2_BadMsgSender', [])
        },
        {
          name: 'invalid body length',
          msgVersion: () => 1n,
          dstToken: () => dLBTC.address,
          tokenRecipient: () => signer1.address,
          amount: () => randomBigInt(8),
          messagePath: () => messagePath,
          sBridgeBytes: () => sBridgeBytes,
          bodyModifier: (body: string): string => body + 'aa',
          customError: (arg: any) => dbridge.interface.encodeErrorResult('BridgeV2_InvalidMsgBodyLength', [97, 98])
        }
        // {
        //   name: 'Correct',
        //   msgVersion: () => 1n,
        //   dstToken: () => dLBTC.address,
        //   tokenRecipient: () => signer1.address,
        //   amount: () => randomBigInt(8),
        //   messagePath: () => messagePath,
        //   sBridgeBytes: () => sBridgeBytes,
        //   bodyModifier: (body : string) : string => body,
        //   customError: (arg: any) => dbridge.interface.encodeErrorResult('BridgeV2_BadMsgSender', [])
        // }
      ];

      args.forEach(function (arg) {
        it(`Reverts when ${arg.name}`, async () => {
          let destinationCaller = signer1;
          let body = ethers.solidityPacked(
            ['uint8', 'bytes32', 'bytes32', 'uint256'],
            [
              arg.msgVersion(),
              encode(['address'], [arg.dstToken()]),
              encode(['address'], [arg.tokenRecipient()]),
              arg.amount()
            ]
          );
          body = arg.bodyModifier(body);

          const payload = getPayloadForAction(
            [
              arg.messagePath(),
              encode(['uint256'], [0n]),
              arg.sBridgeBytes(),
              dBridgeBytes,
              encode(['address'], [destinationCaller.address]),
              body
            ],
            GMP_V1_SELECTOR
          );

          const { proof } = await signPayload([signer1], [true], payload);

          const tx = await dmailbox.connect(destinationCaller).deliverAndHandle(payload, proof);
          const receipt = await tx.wait();
          await expect(receipt).to.emit(dmailbox, 'MessageHandleError');
          // @ts-ignore
          const errorEvent = receipt?.logs.find(l => l.eventName === 'MessageHandleError')?.args;
          expect(errorEvent.reason).to.be.eq('');
          console.log(errorEvent.customError);
          expect(errorEvent.customError).to.be.eq(arg.customError(arg));
        });
      });
    });
  });
});

function payloadFromLogs(receipt: ContractTransactionReceipt): string {
  const iface = new ethers.Interface([
    'event MessageSent(bytes32 indexed destinationLChainId, address indexed sender, bytes32 indexed recipient, bytes payload)'
  ]);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      // @ts-ignore
      if (parsed.name === 'MessageSent') {
        // @ts-ignore
        return parsed.args.payload;
      }
    } catch {}
  }
  return '0x';
}

function decodePayload(payload: string): PayloadStruct {
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['bytes32', 'uint256', 'bytes32', 'address', 'address', 'bytes'],
    payload.replace(GMP_V1_SELECTOR, '0x')
  );
  return {
    msgPath: decoded[0],
    msgNonce: decoded[1],
    msgSender: decoded[2],
    msgRecipient: decoded[3],
    msgDestinationCaller: decoded[4],
    msgBody: decoded[5]
  };
}
