import { BridgeV2, Consortium, Mailbox, StakedLBTC } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  calcFee,
  calculateStorageSlot,
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
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
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
const MAX_FEE_DISCOUNT = 10000n;

describe('BridgeV2', function () {
  let deployer: Signer,
    owner: Signer,
    pauser: Signer,
    treasury: Signer,
    minter: Signer,
    notary: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer;
  let consortium: Consortium & Addressable;
  let smailbox: Mailbox & Addressable, dmailbox: Mailbox & Addressable;
  let sLBTC: StakedLBTC & Addressable, dLBTC: StakedLBTC & Addressable;
  let sbridge: BridgeV2 & Addressable, dbridge: BridgeV2 & Addressable;

  let lChainId: string;
  let globalNonce = 1;
  let snapshot: SnapshotRestorer;

  const AMOUNT = 1000_0000_0000n;
  let sBridgeBytes: string;
  let dBridgeBytes: string;
  let weiPerByte = 1000n;

  before(async () => {
    [deployer, owner, pauser, treasury, minter, notary, signer1, signer2, signer3] = await getSignersWithPrivateKeys();

    // Consortium
    consortium = await deployContract<Consortium & Addressable>('Consortium', [deployer.address]);
    consortium.address = await consortium.getAddress();
    await consortium.setInitialValidatorSet(getPayloadForAction([1, [notary.publicKey], [1], 1, 1], NEW_VALSET));

    // Mailboxes
    smailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    smailbox.address = await smailbox.getAddress();
    await smailbox.connect(owner).grantRole(await smailbox.TREASURER_ROLE(), treasury);
    await smailbox.connect(owner).grantRole(await smailbox.PAUSER_ROLE(), pauser);
    await smailbox.connect(owner).setFee(1000);
    dmailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    dmailbox.address = await dmailbox.getAddress();
    await dmailbox.connect(owner).grantRole(await dmailbox.TREASURER_ROLE(), treasury);
    await dmailbox.connect(owner).grantRole(await dmailbox.PAUSER_ROLE(), pauser);

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);
    await smailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [dmailbox.address]));
    await dmailbox.connect(owner).enableMessagePath(lChainId, encode(['address'], [smailbox.address]));

    // Bridges
    sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
    sbridge.address = await sbridge.getAddress();
    sBridgeBytes = encode(['address'], [sbridge.address]);
    dbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, dmailbox.address]);
    dbridge.address = await dbridge.getAddress();
    dBridgeBytes = encode(['address'], [dbridge.address]);

    // Tokens
    sLBTC = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
      consortium.address,
      0,
      owner.address,
      owner.address
    ]);
    sLBTC.address = await sLBTC.getAddress();
    await sLBTC.connect(owner).addMinter(minter.address);
    dLBTC = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
      consortium.address,
      0,
      owner.address,
      owner.address
    ]);
    dLBTC.address = await dLBTC.getAddress();
    await dLBTC.connect(owner).addMinter(minter.address);
    await dLBTC.connect(owner).addMinter(dbridge.address);

    // Set paths and map tokens
    await sbridge.connect(owner).setDestinationBridge(lChainId, dBridgeBytes);
    await sbridge.connect(owner).addDestinationToken(lChainId, sLBTC, encode(['address'], [dLBTC.address]));
    await dbridge.connect(owner).setDestinationBridge(lChainId, sBridgeBytes);
    await dbridge.connect(owner).addDestinationToken(lChainId, dLBTC, encode(['address'], [sLBTC.address]));
    // Disable fees for the bridge and set payload size
    await smailbox.connect(owner).setSenderConfig(sbridge, BRIDGE_PAYLOAD_SIZE, true);

    await sLBTC.connect(minter)['mint(address,uint256)'](signer1.address, AMOUNT);
    await sLBTC.connect(signer1).approve(sbridge.address, ethers.MaxUint256);

    snapshot = await takeSnapshot();
  });

  describe('Setters and Getters', () => {
    describe('Vew functions', () => {
      before(async () => {
        await snapshot.restore();
      });

      it('Verify storage slot and mailbox inside', async () => {
        const slot = calculateStorageSlot('lombardfinance.storage.BridgeV2');
        const storage = await ethers.provider.getStorage(sbridge, slot + 3n);
        expect(storage).to.be.eq(encode(['address'], [smailbox.address]));
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

      it('setDestinationBridge owner can set', async () => {
        await expect(sbridge.connect(owner).setDestinationBridge(lChainId, dBridgeBytes))
          .to.emit(sbridge, 'DestinationBridgeSet')
          .withArgs(lChainId, dBridgeBytes);
        expect(await sbridge.destinationBridge(lChainId)).to.be.eq(dBridgeBytes);
      });

      it('setDestinationBridge owner can update address', async () => {
        const newDBridgBytes = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(owner).setDestinationBridge(lChainId, newDBridgBytes))
          .to.emit(sbridge, 'DestinationBridgeSet')
          .withArgs(lChainId, newDBridgBytes);
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
        await expect(sbridge.connect(owner).setDestinationBridge(lChainId, newDBridgBytes))
          .to.emit(sbridge, 'DestinationBridgeSet')
          .withArgs(lChainId, newDBridgBytes);
        expect(await sbridge.destinationBridge(lChainId)).to.be.eq(newDBridgBytes);
      });
    });

    describe('Add destination token', () => {
      let sbridge: BridgeV2 & Addressable;
      const dChain = encode(['uint256'], [randomBigInt(8)]);
      const sToken = ethers.Wallet.createRandom().address;
      const dToken = encode(['address'], [ethers.Wallet.createRandom().address]);

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
        sbridge.address = await sbridge.getAddress();
        await sbridge.connect(owner).setDestinationBridge(dChain, dBridgeBytes);
      });

      it('addDestinationToken owner can add tokens mapping', async () => {
        await expect(sbridge.connect(owner).addDestinationToken(dChain, sToken, dToken))
          .to.emit(sbridge, 'DestinationTokenAdded')
          .withArgs(dChain, dToken, sToken);

        expect(await sbridge.getAllowedDestinationToken(dChain, sToken)).to.be.eq(dToken);
      });

      it('Add another token mapping', async () => {
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(owner).addDestinationToken(dChain, sourceToken, destinationToken))
          .to.emit(sbridge, 'DestinationTokenAdded')
          .withArgs(dChain, destinationToken, sourceToken);
        expect(await sbridge.getAllowedDestinationToken(dChain, sourceToken)).to.be.eq(destinationToken);
      });

      it('Reverts when destination token has mapping', async () => {
        const sourceToken = ethers.Wallet.createRandom().address;
        await expect(
          sbridge.connect(owner).addDestinationToken(dChain, sourceToken, dToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_AlreadyAllowed');
      });

      it('Reverts when source token has mapping', async () => {
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(
          sbridge.connect(owner).addDestinationToken(dChain, sToken, destinationToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_AlreadyAllowed');
      });

      it('Reverts when called by not an owner', async () => {
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(signer1).addDestinationToken(dChain, sourceToken, destinationToken))
          .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });

      it('Reverts when destination chain is 0', async () => {
        const destinationChain = encode(['uint256'], [0]);
        const sourceToken = ethers.Wallet.createRandom().address;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(
          sbridge.connect(owner).addDestinationToken(destinationChain, sourceToken, destinationToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroPath');
      });

      it('Reverts when source token is 0 address', async () => {
        const sourceToken = ethers.ZeroAddress;
        const destinationToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(
          sbridge.connect(owner).addDestinationToken(dChain, sourceToken, destinationToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroToken');
      });
    });

    describe('Remove destination token', () => {
      let sbridge: BridgeV2 & Addressable;
      const dChain = encode(['uint256'], [randomBigInt(8)]);
      const sToken = ethers.Wallet.createRandom().address;
      const dToken = encode(['address'], [ethers.Wallet.createRandom().address]);

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
        sbridge.address = await sbridge.getAddress();
        await sbridge.connect(owner).setDestinationBridge(dChain, dBridgeBytes);
        await sbridge.connect(owner).addDestinationToken(dChain, sToken, dToken);
      });

      it('Reverts when called by not an owner', async () => {
        await expect(sbridge.connect(signer1).removeDestinationToken(dChain, sToken, dToken))
          .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
          .withArgs(signer1.address);
      });

      it('removeDestinationToken owner can remove tokens mapping', async () => {
        await expect(sbridge.connect(owner).removeDestinationToken(dChain, sToken, dToken))
          .to.emit(sbridge, 'DestinationTokenRemoved')
          .withArgs(dChain, dToken, sToken);

        expect(await sbridge.getAllowedDestinationToken(dChain, sToken)).to.be.eq(ethers.hexlify(new Uint8Array(32)));
      });

      it('Can remap source token after the prior mapping has been removed', async () => {
        const dToken = encode(['address'], [ethers.Wallet.createRandom().address]);
        await expect(sbridge.connect(owner).addDestinationToken(dChain, sToken, dToken))
          .to.emit(sbridge, 'DestinationTokenAdded')
          .withArgs(dChain, dToken, sToken);
        expect(await sbridge.getAllowedDestinationToken(dChain, sToken)).to.be.eq(dToken);
      });

      it('Can remap destination token after the prior mapping has been removed', async () => {
        const sToken = ethers.Wallet.createRandom().address;
        await expect(sbridge.connect(owner).addDestinationToken(dChain, sToken, dToken))
          .to.emit(sbridge, 'DestinationTokenAdded')
          .withArgs(dChain, dToken, sToken);
        expect(await sbridge.getAllowedDestinationToken(dChain, sToken)).to.be.eq(dToken);
      });

      it('Reverts when destination chain is 0', async () => {
        const dChain = encode(['uint256'], [0]);
        await expect(
          sbridge.connect(owner).removeDestinationToken(dChain, sToken, dToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroPath');
      });

      it('Reverts when source token is 0 address', async () => {
        const sToken = ethers.ZeroAddress;
        await expect(
          sbridge.connect(owner).removeDestinationToken(dChain, sToken, dToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroToken');
      });

      it('Reverts when destination token is 0 address', async () => {
        const dToken = encode(['address'], [ethers.ZeroAddress]);
        await expect(
          sbridge.connect(owner).removeDestinationToken(dChain, sToken, dToken)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroToken');
      });
    });
  });

  describe('Rescue ERC20', function () {
    let token: StakedLBTC & Addressable;
    let dummy: Signer;
    const e18 = 10n ** 18n;

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

    it('Owner can transfer ERC20 from mailbox', async () => {
      const amount = randomBigInt(8);
      let tx = await token.connect(dummy).transfer(sbridge, amount);
      await expect(tx).changeTokenBalance(token, sbridge, amount);

      tx = await sbridge.connect(owner).rescueERC20(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, sbridge, -amount);
    });

    it('Reverts when called by not an owner', async () => {
      const amount = randomBigInt(8);
      const tx = await token.connect(dummy).transfer(sbridge, amount);
      await expect(tx).changeTokenBalance(token, sbridge, amount);

      await expect(sbridge.connect(dummy).rescueERC20(token.address, dummy.address, amount))
        .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
        .withArgs(dummy.address);
    });
  });

  describe('Base flow', function () {
    before(async () => {
      await snapshot.restore();
      globalNonce = 1;

      await sbridge.connect(owner).setSenderConfig(signer1, 0n, true);
      await dbridge.connect(owner).setTokenRateLimits(dLBTC, {
        chainId: lChainId,
        limit: AMOUNT * 100n,
        window: 300n
      });
    });

    it('successful', async () => {
      const recipient = encode(['address'], [signer1.address]);
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
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
        dCaller,
        body
      );
      const { proof } = await signPayload([notary], [true], payload);

      const fee = await sbridge.getFee(signer1);
      await expect(
        sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, AMOUNT, dCaller, { value: fee })
      )
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload);

      const tx = await dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
      await expect(tx)
        .to.emit(dbridge, 'WithdrawFromBridge')
        .withArgs(signer1.address, lChainId, dLBTC.address, AMOUNT);
    });
  });

  describe('Deposit', function () {
    const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
    const dCaller = encode(['address'], [ethers.Wallet.createRandom().address]);

    before(async () => {
      await snapshot.restore();
      globalNonce = 1;

      await sbridge.connect(owner).setSenderConfig(signer1, 0n, true);
    });

    it('New message', async () => {
      const sLbtcSupplyBefore = await sLBTC.totalSupply();

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
        dCaller,
        body
      );

      const fee = await sbridge.getFee(signer1);
      const tx = await sbridge
        .connect(signer1)
        .deposit(lChainId, sLBTC.address, recipient, amount, dCaller, { value: fee });
      await expect(tx)
        .to.emit(sbridge, 'DepositToBridge')
        .withArgs(signer1, recipient, ethers.sha256(payload))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload)
        .and.to.emit(sLBTC, 'Transfer')
        .withArgs(signer1.address, sbridge.address, amount);
      await expect(tx).to.changeTokenBalance(sLBTC, signer1.address, -amount);
      // Fees go to mailbox
      await expect(tx).to.changeEtherBalance(signer1, -fee, { includeFee: false });
      await expect(tx).to.changeEtherBalance(smailbox, fee, { includeFee: false });

      const sLbtcSupplyAfter = await sLBTC.totalSupply();
      expect(sLbtcSupplyBefore - sLbtcSupplyAfter).to.be.eq(amount);
    });

    it('decodeMsgBody returns input args', async () => {
      const amount = randomBigInt(10);

      const fee = await sbridge.getFee(signer1);
      const tx = await sbridge
        .connect(signer1)
        .deposit(lChainId, sLBTC.address, recipient, amount, dCaller, { value: fee });
      let receipt = (await tx.wait()) as ContractTransactionReceipt;
      globalNonce++;
      const logsData = await payloadFromReceipt(receipt);
      expect(logsData?.payload).to.not.undefined;
      // @ts-ignore
      const payload = decodePayload(logsData.payload);

      const res = await dbridge.decodeMsgBody(payload.msgBody);
      expect(res[0]).to.be.eq(dLBTC.address);
      expect(encode(['address'], [res[1]])).to.be.eq(recipient);
      expect(res[2]).to.be.eq(amount);
    });

    it('Another message to the same chain', async () => {
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
        dCaller,
        body
      );

      const fee = await sbridge.getFee(signer1);
      const tx = sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, amount, dCaller, { value: fee });
      await expect(tx)
        .to.emit(sbridge, 'DepositToBridge')
        .withArgs(signer1, recipient, ethers.sha256(payload))
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, dBridgeBytes, payload);
    });

    it('Other token pair to the same chain', async () => {
      const sLBTC = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        consortium.address,
        0,
        owner.address,
        owner.address
      ]);
      sLBTC.address = await sLBTC.getAddress();
      await sLBTC.connect(owner).addMinter(minter.address);
      await sLBTC.connect(minter)['mint(address,uint256)'](signer1, AMOUNT);
      await sLBTC.connect(signer1).approve(sbridge, AMOUNT);
      let newDstToken = ethers.Wallet.createRandom().address;
      let newDstBridge = encode(['address'], [ethers.Wallet.createRandom().address]);

      await sbridge.connect(owner).setDestinationBridge(lChainId, newDstBridge);
      await sbridge.connect(owner).addDestinationToken(lChainId, sLBTC.address, encode(['address'], [newDstToken]));

      const amount = randomBigInt(6);
      const fee = await sbridge.getFee(signer1);
      await expect(
        sbridge.connect(signer1).deposit(lChainId, sLBTC.address, recipient, amount, dCaller, { value: fee })
      )
        .to.emit(smailbox, 'MessageSent')
        .withArgs(lChainId, sbridge.address, newDstBridge, anyValue);
      globalNonce++;
    });

    it('To the new destination chain', async () => {
      let newDstChain = encode(['uint256'], [12345]);
      let newDstMailbox = encode(['address'], [ethers.Wallet.createRandom().address]);
      await smailbox.connect(owner).enableMessagePath(newDstChain, newDstMailbox);

      let newDstToken = ethers.Wallet.createRandom().address;
      let newDstBridge = encode(['address'], [ethers.Wallet.createRandom().address]);
      await sbridge.connect(owner).setDestinationBridge(newDstChain, newDstBridge);
      await sbridge.connect(owner).addDestinationToken(newDstChain, sLBTC.address, encode(['address'], [newDstToken]));

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
        dCaller,
        body
      );

      const fee = await sbridge.getFee(signer1);
      await expect(
        sbridge.connect(signer1).deposit(newDstChain, sLBTC.address, recipient, amount, dCaller, { value: fee })
      )
        .to.emit(smailbox, 'MessageSent')
        .withArgs(newDstChain, sbridge.address, newDstBridge, payload);
    });

    const invalidArgs = [
      {
        name: 'Unsupported destination chain',
        sender: () => signer1,
        destinationChain: () => encode(['uint256'], [123]),
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        feeFunc: async (sender: Signer) => await sbridge.getFee(sender),
        customError: () => [sbridge, 'BridgeV2_PathNotAllowed']
      },
      {
        name: 'Unsupported token',
        sender: () => signer1,
        destinationChain: () => lChainId,
        token: () => ethers.Wallet.createRandom().address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        feeFunc: async (sender: Signer) => await sbridge.getFee(sender),
        customError: () => [sbridge, 'BridgeV2_TokenNotAllowed']
      },
      {
        name: 'Recipient is 0 address',
        sender: () => signer1,
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.ZeroAddress]),
        amount: () => 10000_0000,
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        feeFunc: async (sender: Signer) => await sbridge.getFee(sender),
        customError: () => [sbridge, 'BridgeV2_ZeroRecipient']
      },
      {
        name: 'Amount is 0',
        sender: () => signer1,
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 0,
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        feeFunc: async (sender: Signer) => await sbridge.getFee(sender),
        customError: () => [sbridge, 'BridgeV2_ZeroAmount']
      },
      {
        name: 'User is not whitelisted',
        sender: () => signer2,
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        feeFunc: async (sender: Signer) => await sbridge.getFee(sender),
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_SenderNotWhitelisted']
      },
      {
        name: 'Insufficient fees',
        sender: () => signer1,
        destinationChain: () => lChainId,
        token: () => sLBTC.address,
        recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        amount: () => 10000_0000,
        feeFunc: async (sender: Signer) => (await sbridge.getFee(sender)) - 1n,
        dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
        customError: () => [sbridge, 'BridgeV2_NotEnoughFee']
      }
      // {
      //   name: 'Correct case',
      //   destinationChain: () => lChainId,
      //   token: () => sLBTC.address,
      //   recipient: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      //   amount: () => 10000_0000,
      //   dCaller: () => encode(['address'], [ethers.Wallet.createRandom().address]),
      // },
    ];

    invalidArgs.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async () => {
        const sender = arg.sender();
        const fee = await arg.feeFunc(sender);
        await expect(
          sbridge
            .connect(sender)
            .deposit(arg.destinationChain(), arg.token(), arg.recipient(), arg.amount(), arg.dCaller(), { value: fee })
        )
          // @ts-ignore
          .to.be.revertedWithCustomError(...arg.customError());
      });
    });
  });

  describe('Whitelist and fees', () => {
    describe('Set config', () => {
      let sbridge: BridgeV2 & Addressable;

      beforeEach(async () => {
        await snapshot.restore();

        sbridge = await deployContract<BridgeV2 & Addressable>('BridgeV2', [owner.address, smailbox.address]);
        sbridge.address = await sbridge.getAddress();
      });

      it('setSenderConfig owner can add to whitelist', async () => {
        const discount = randomBigInt(2);
        const sender = signer3;
        await expect(sbridge.connect(owner).setSenderConfig(sender, discount, true))
          .to.emit(sbridge, 'SenderConfigChanged')
          .withArgs(sender, discount, true);

        const conf = await sbridge.getSenderConfig(sender);
        expect(conf.whitelisted).to.be.true;
        expect(conf.feeDiscount).to.be.eq(discount);
      });

      it('setSenderConfig owner update', async () => {
        const discount = 0n;
        await expect(sbridge.connect(owner).setSenderConfig(signer3, discount, false))
          .to.emit(sbridge, 'SenderConfigChanged')
          .withArgs(signer3, discount, false);

        const conf = await sbridge.getSenderConfig(signer3);
        expect(conf.whitelisted).to.be.false;
        expect(conf.feeDiscount).to.be.eq(discount);
      });

      it('setSenderConfig reverts when called by not an owner', async () => {
        await expect(sbridge.connect(deployer).setSenderConfig(ethers.Wallet.createRandom().address, 0, false))
          .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
          .withArgs(deployer.address);
      });

      it('setSenderConfig reverts when discount too big', async () => {
        await expect(
          sbridge.connect(owner).setSenderConfig(ethers.Wallet.createRandom().address, 100_01n, true)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_TooBigDiscount');
      });

      it('setSenderConfig reverts when sender is zero address', async () => {
        await expect(
          sbridge.connect(owner).setSenderConfig(ethers.ZeroAddress, 0, false)
        ).to.be.revertedWithCustomError(sbridge, 'BridgeV2_ZeroSender');
      });
    });

    describe('Fees', () => {
      let sender: Signer;
      const dCaller = encode(['address'], [ethers.ZeroAddress]);
      const recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
      beforeEach(async () => {
        await snapshot.restore();
        globalNonce = 1;

        sender = signer1;
      });

      const args = [
        {
          name: 'user has no discount',
          feeDiscount: 0n,
          extra: 0n
        },
        {
          name: 'user has discount',
          feeDiscount: randomBigInt(4),
          extra: 0n
        },
        {
          name: 'user has discount 100%',
          feeDiscount: 100_00n,
          extra: 0n
        },
        {
          name: 'user has no discount and payed extra',
          feeDiscount: 0n,
          extra: 10n ** 18n
        }
      ];

      args.forEach(arg => {
        it(`Get fees when ${arg.name}`, async () => {
          const feeDiscount = arg.feeDiscount;
          await sbridge.connect(owner).setSenderConfig(sender, feeDiscount, true);

          const amount = randomBigInt(10);
          const body = ethers.solidityPacked(
            ['uint8', 'bytes32', 'bytes32', 'uint256'],
            [await sbridge.MSG_VERSION(), dBridgeBytes, recipient, amount]
          );

          const { fee } = calcFee(body, weiPerByte);
          const expectedFee = (fee * (MAX_FEE_DISCOUNT - feeDiscount)) / MAX_FEE_DISCOUNT;
          const actualFee = await sbridge.getFee(sender);
          expect(actualFee).to.be.closeTo(expectedFee, 1n);

          const extra = arg.extra;
          const tx = await sbridge
            .connect(sender)
            .deposit(lChainId, sLBTC.address, recipient, amount, dCaller, { value: actualFee + extra });
          await expect(tx).to.emit(smailbox, 'MessageSent');
          await expect(tx).to.changeEtherBalance(sender, -(actualFee + extra), { includeFee: false });
          await expect(tx).to.changeEtherBalance(smailbox, actualFee + extra, { includeFee: false });
        });
      });
    });
  });

  describe('Deliver and handle', function () {
    describe('Destination caller is specified', function () {
      let recipient: Signer;
      let dCaller: Signer;
      let amount: bigint;
      let payload: string;
      let proof: string;
      let payloadHash: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        await dbridge.connect(owner).setTokenRateLimits(dLBTC, {
          chainId: lChainId,
          limit: AMOUNT * 100n,
          window: 300n
        });
        await sbridge.connect(owner).setSenderConfig(signer1, 0n, true);

        amount = randomBigInt(8);
        dCaller = signer3;
        recipient = signer2;
        const fee = await sbridge.getFee(signer1);
        const tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [dCaller.address]),
            { value: fee }
          );
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        // @ts-ignore
        payload = (await payloadFromReceipt(receipt))?.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([notary], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('deliverAndHandle reverts when called by unauthorized caller', async () => {
        await expect(dmailbox.connect(signer1).deliverAndHandle(payload, proof))
          .to.be.revertedWithCustomError(dmailbox, 'Mailbox_UnexpectedDestinationCaller')
          .withArgs(dCaller.address, signer1.address);
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

        const tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, globalNonce, encode(['address'], [sbridge.address]), payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('repeated deliverAndHandle does not mint', async () => {
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        const receipt = await tx.wait();
        await expect(tx).to.emit(dmailbox, 'MessageHandleError');
        // @ts-ignore
        const errorEvent = receipt?.logs.find(l => l.eventName === 'MessageHandleError')?.args;
        expect(errorEvent.customError).to.be.eq(dbridge.interface.encodeErrorResult('BridgeV2_PayloadSpent'));
        await expect(tx).to.not.emit(dbridge, 'WithdrawFromBridge');
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, 0n);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter).to.be.eq(dLbtcSupplyBefore);
      });

      it('deliver another message from the same src', async () => {
        let amount = randomBigInt(6);
        const fee = await sbridge.getFee(signer1);
        let tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [dCaller.address]),
            { value: fee }
          );
        globalNonce++;
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        // @ts-ignore
        payload = (await payloadFromReceipt(receipt))?.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([notary], [true], payload);
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, res.proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(res.payloadHash, dCaller.address, globalNonce, encode(['address'], [sbridge.address]), payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('deliver other token on the chain', async () => {
        const sLBTC2 = encode(['address'], [ethers.Wallet.createRandom().address]);
        const dLBTC2 = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
          consortium.address,
          0,
          owner.address,
          owner.address
        ]);
        dLBTC2.address = await dLBTC2.getAddress();
        await dLBTC2.connect(owner).addMinter(dbridge.address);
        await dbridge.connect(owner).addDestinationToken(lChainId, dLBTC2, sLBTC2);

        const amount = randomBigInt(8);
        const body = ethers.solidityPacked(
          ['uint8', 'bytes32', 'bytes32', 'uint256'],
          [
            await sbridge.MSG_VERSION(),
            encode(['address'], [dLBTC2.address]),
            encode(['address'], [recipient.address]),
            amount
          ]
        );

        const payload = getGMPPayload(
          smailbox.address,
          lChainId,
          lChainId,
          1,
          sBridgeBytes,
          dBridgeBytes,
          encode(['address'], [dCaller.address]),
          body
        );
        const { proof, payloadHash } = await signPayload([notary], [true], payload);

        const dLbtcSupplyBefore = await dLBTC2.totalSupply();

        // first time emit error, because rate limits not set for the new dLBTC
        let tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, 1, sBridgeBytes, payload);

        // set rate limit to resolve error
        await dbridge.connect(owner).setTokenRateLimits(dLBTC2, {
          chainId: lChainId,
          limit: amount,
          window: 1000n
        });

        // proof can be zero array, because message already delivered
        tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, '0x');
        await expect(tx).to.not.emit(dmailbox, 'MessageDelivered');
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC2.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC2, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC2.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('deliver token from other chain', async () => {
        const newSrcChain = encode(['uint256'], [12345]);
        const newSrcMailbox = ethers.Wallet.createRandom().address;
        const newSrcBridge = ethers.Wallet.createRandom().address;
        const newSrcBridgeBytes = encode(['address'], [newSrcBridge]);
        await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox]));
        await dbridge.connect(owner).setDestinationBridge(newSrcChain, newSrcBridgeBytes);
        await dbridge.connect(owner).addDestinationToken(newSrcChain, dLBTC, encode(['address'], [sLBTC.address]));

        // Set rate limit
        const amount = randomBigInt(8);
        await dbridge.connect(owner).setTokenRateLimits(dLBTC, {
          chainId: newSrcChain,
          limit: amount,
          window: 1000n
        });

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
          encode(['address'], [dCaller.address]),
          body
        );

        const { proof } = await signPayload([notary], [true], payload);
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        let tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.emit(dmailbox, 'MessageDelivered');
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, newSrcChain, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });
    });

    describe('Caller is arbitrary', function () {
      let recipient: Signer;
      let amount: bigint;
      let payload: string;
      let proof: string;
      let payloadHash: string;

      before(async () => {
        await snapshot.restore();
        globalNonce = 1;

        await dbridge.connect(owner).setTokenRateLimits(dLBTC, {
          chainId: lChainId,
          limit: AMOUNT * 100n,
          window: 300n
        });
        await sbridge.connect(owner).setSenderConfig(signer1, 0n, true);

        amount = randomBigInt(8);
        recipient = signer2;
        const fee = await sbridge.getFee(signer1);
        const tx = await sbridge
          .connect(signer1)
          .deposit(
            lChainId,
            sLBTC.address,
            encode(['address'], [recipient.address]),
            amount,
            encode(['address'], [ethers.ZeroAddress]),
            { value: fee }
          );
        let receipt = (await tx.wait()) as ContractTransactionReceipt;
        // @ts-ignore
        payload = (await payloadFromReceipt(receipt))?.payload;
        expect(payload).to.not.undefined;

        let res = await signPayload([notary], [true], payload);
        proof = res.proof;
        payloadHash = res.payloadHash;
      });

      it('any address can call deliverAndHandle', async () => {
        let dCaller = signer1;

        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        await expect(tx).to.not.emit(dmailbox, 'MessageHandleError');
        await expect(tx)
          .to.emit(dmailbox, 'MessageDelivered')
          .withArgs(payloadHash, dCaller.address, globalNonce, encode(['address'], [sbridge.address]), payload);
        await expect(tx)
          .to.emit(dbridge, 'WithdrawFromBridge')
          .withArgs(recipient.address, lChainId, dLBTC.address, amount);
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, amount);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter - dLbtcSupplyBefore).to.be.eq(amount);
      });

      it('repeat deliverAndHandle with different caller', async () => {
        let dCaller = signer3;
        const dLbtcSupplyBefore = await dLBTC.totalSupply();

        const tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
        const receipt = await tx.wait();
        await expect(tx).to.emit(dmailbox, 'MessageHandleError');
        // @ts-ignore
        const errorEvent = receipt?.logs.find(l => l.eventName === 'MessageHandleError')?.args;
        expect(errorEvent.customError).to.be.eq(dbridge.interface.encodeErrorResult('BridgeV2_PayloadSpent'));
        await expect(tx).to.not.emit(dbridge, 'WithdrawFromBridge');
        await expect(tx).to.changeTokenBalance(dLBTC, recipient.address, 0n);

        const dLbtcSupplyAfter = await dLBTC.totalSupply();
        expect(dLbtcSupplyAfter).to.be.eq(dLbtcSupplyBefore);
      });
    });

    describe('Payload is invalid', function () {
      let unknownToken: StakedLBTC & Addressable;
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

        unknownToken = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
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
          customError: (arg: any) => sbridge.interface.encodeErrorResult('BridgeV2_ZeroRecipient')
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
          let dCaller = signer1;
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
              encode(['address'], [dCaller.address]),
              body
            ],
            GMP_V1_SELECTOR
          );

          const { proof } = await signPayload([notary], [true], payload);

          const tx = await dmailbox.connect(dCaller).deliverAndHandle(payload, proof);
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

  describe('Rate limits', function () {
    let sLBTC2: string, sLBTC3: string;
    let dLBTC2: StakedLBTC & Addressable;
    const newSrcChain = encode(['uint256'], [12345]);
    const newSrcMailbox = ethers.Wallet.createRandom().address;
    const newSrcBridge = ethers.Wallet.createRandom().address;
    const newSrcBridgeBytes = encode(['address'], [newSrcBridge]);
    const rateLimits = new Map();
    let sender: Signer;
    let recipient = encode(['address'], [ethers.Wallet.createRandom().address]);
    let dCaller = encode(['address'], [ethers.ZeroAddress]);

    before(async function () {
      await snapshot.restore();
      globalNonce = 1;
      // Map another pair
      sLBTC2 = encode(['address'], [ethers.Wallet.createRandom().address]);
      dLBTC2 = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
        consortium.address,
        0,
        owner.address,
        owner.address
      ]);
      dLBTC2.address = await dLBTC2.getAddress();
      await dLBTC2.connect(owner).addMinter(dbridge.address);
      await dbridge.connect(owner).addDestinationToken(lChainId, dLBTC2, sLBTC2);

      //Link another chain
      sLBTC3 = encode(['address'], [ethers.Wallet.createRandom().address]);
      await dmailbox.connect(owner).enableMessagePath(newSrcChain, encode(['address'], [newSrcMailbox]));
      await dbridge.connect(owner).setDestinationBridge(newSrcChain, newSrcBridgeBytes);
      await dbridge.connect(owner).addDestinationToken(newSrcChain, dLBTC, sLBTC3);

      sender = signer1;
      await sbridge.connect(owner).setSenderConfig(sender, 0n, true);
    });

    it('Reverts when rate limit is not set for the chain', async function () {
      const rateLimit = {
        chainId: lChainId,
        limit: randomBigInt(12),
        window: 86400n
      };
      await expect(dbridge.connect(deployer).setTokenRateLimits(dLBTC, rateLimit))
        .to.be.revertedWithCustomError(sbridge, 'OwnableUnauthorizedAccount')
        .withArgs(deployer.address);
    });

    it('Admin can set rate limit', async function () {
      const rateLimit = {
        chainId: lChainId,
        limit: randomBigInt(12),
        window: 86400n
      };
      rateLimits.set(dLBTC.address + lChainId, rateLimit);

      const tx = await dbridge.connect(owner).setTokenRateLimits(dLBTC, rateLimit);
      await expect(tx).to.emit(dbridge, 'RateLimitsSet').withArgs(dLBTC, lChainId, rateLimit.limit, rateLimit.window);

      const res = await dbridge.getTokenRateLimit(dLBTC.address, lChainId);
      expect(res[0]).to.be.eq(0n);
      expect(res[1]).to.be.eq(rateLimit.limit);
    });

    it('Set rate limit for the same token but different chain', async function () {
      const rateLimit = {
        chainId: newSrcChain,
        limit: randomBigInt(12),
        window: 86400n
      };
      rateLimits.set(dLBTC.address + newSrcChain, rateLimit);

      const tx = await dbridge.connect(owner).setTokenRateLimits(dLBTC, rateLimit);
      await expect(tx)
        .to.emit(dbridge, 'RateLimitsSet')
        .withArgs(dLBTC, newSrcChain, rateLimit.limit, rateLimit.window);

      const res = await dbridge.getTokenRateLimit(dLBTC, newSrcChain);
      expect(res[0]).to.be.eq(0n);
      expect(res[1]).to.be.eq(rateLimit.limit);
    });

    it('Set rate limit for other token on the same chain', async function () {
      const rateLimit = {
        chainId: lChainId,
        limit: randomBigInt(12),
        window: 86400n
      };
      rateLimits.set(dLBTC2.address + lChainId, rateLimit);

      const tx = await dbridge.connect(owner).setTokenRateLimits(dLBTC2, rateLimit);
      await expect(tx).to.emit(dbridge, 'RateLimitsSet').withArgs(dLBTC2, lChainId, rateLimit.limit, rateLimit.window);

      const res = await dbridge.getTokenRateLimit(dLBTC2, lChainId);
      expect(res[0]).to.be.eq(0n);
      expect(res[1]).to.be.eq(rateLimit.limit);
    });

    it('Withdraw less than limit', async function () {
      const rateLimit = rateLimits.get(dLBTC.address + lChainId)?.limit;
      let amount = rateLimit / 4n;
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
        dCaller,
        body
      );

      let { proof } = await signPayload([notary], [true], payload);
      await dmailbox.connect(signer1).deliverAndHandle(payload, proof);

      const limitStatus = await dbridge.getTokenRateLimit(dLBTC, lChainId);
      expect(limitStatus[0]).to.be.eq(amount);
      expect(limitStatus[1]).to.be.eq(rateLimit - amount);
    });

    it('Spent all limit', async function () {
      const limitConfig = rateLimits.get(dLBTC.address + lChainId);
      const delta = BigInt(limitConfig.limit / limitConfig.window);
      const limitStatusBefore = await dbridge.getTokenRateLimit(dLBTC, lChainId);
      const amount = limitStatusBefore[1];
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
        dCaller,
        body
      );

      let { proof } = await signPayload([notary], [true], payload);
      await dmailbox.connect(signer1).deliverAndHandle(payload, proof);

      const limitStatus = await dbridge.getTokenRateLimit(dLBTC, lChainId);
      expect(limitStatus[0]).to.be.closeTo(limitStatusBefore[0] + amount, delta * 2n);
      expect(limitStatus[1]).to.be.closeTo(0n, delta * 2n);

      const limitStatusOtherChain = await dbridge.getTokenRateLimit(dLBTC, newSrcChain);
      expect(limitStatusOtherChain[0]).to.be.eq(0n);
    });

    it('Reverts when limit exceeded', async function () {
      const limitConfig = rateLimits.get(dLBTC.address + lChainId);
      const delta = BigInt(limitConfig.limit / limitConfig.window);
      const limitStatusBefore = await dbridge.getTokenRateLimit(dLBTC, lChainId);
      console.log(limitStatusBefore);
      const amount = limitStatusBefore[1] + delta * 1000n;
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC.address]), recipient, amount]
      );
      const nonce = Number(randomBigInt(2));
      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        nonce,
        sBridgeBytes,
        dBridgeBytes,
        dCaller,
        body
      );

      let { proof, payloadHash } = await signPayload([notary], [true], payload);
      const tx = await dmailbox.connect(signer1).deliverAndHandle(payload, proof);
      await expect(tx)
        .to.emit(dmailbox, 'MessageDelivered')
        .withArgs(payloadHash, signer1.address, nonce, sBridgeBytes, payload);
      await expect(tx).to.not.emit(dbridge, 'WithdrawFromBridge');
      await expect(tx).to.emit(dmailbox, 'MessageHandleError');
      const receipt = await tx.wait();
      // @ts-ignore
      const errorEvent = receipt?.logs.find(l => l.eventName === 'MessageHandleError')?.args;
      expect(errorEvent.customError).to.be.eq(dbridge.interface.encodeErrorResult('RateLimitExceeded'));
    });

    it('Wait till rate limit recovered and call again', async function () {
      const limitConfig = rateLimits.get(dLBTC.address + lChainId);
      await time.increase(limitConfig.window);
      const delta = BigInt(limitConfig.limit / limitConfig.window);
      const amount = limitConfig.limit;
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
        dCaller,
        body
      );

      let { proof } = await signPayload([notary], [true], payload);
      await dmailbox.connect(signer1).deliverAndHandle(payload, proof);

      const limitStatus = await dbridge.getTokenRateLimit(dLBTC, lChainId);
      expect(limitStatus[0]).to.be.closeTo(amount, delta * 2n);
      expect(limitStatus[1]).to.be.closeTo(0n, delta * 2n);
    });

    it('Withdraw same token but from different chain', async function () {
      const limitConfig = rateLimits.get(dLBTC.address + newSrcChain);
      const delta = BigInt(limitConfig.limit / limitConfig.window);
      const amount = limitConfig.limit;
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC.address]), recipient, amount]
      );
      const payload = getGMPPayload(
        newSrcMailbox,
        newSrcChain,
        lChainId,
        globalNonce++,
        newSrcBridgeBytes,
        dBridgeBytes,
        dCaller,
        body
      );

      let { proof } = await signPayload([notary], [true], payload);
      await dmailbox.connect(signer1).deliverAndHandle(payload, proof);

      const limitStatus = await dbridge.getTokenRateLimit(dLBTC, newSrcChain);
      expect(limitStatus[0]).to.be.closeTo(amount, delta * 2n);
      expect(limitStatus[1]).to.be.closeTo(0n, delta * 2n);
    });

    it('Withdraw different token on the same chain', async function () {
      const limitConfig = rateLimits.get(dLBTC2.address + lChainId);
      const delta = BigInt(limitConfig.limit / limitConfig.window);
      const amount = limitConfig.limit;
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await sbridge.MSG_VERSION(), encode(['address'], [dLBTC2.address]), recipient, amount]
      );
      const payload = getGMPPayload(
        smailbox.address,
        lChainId,
        lChainId,
        globalNonce++,
        sBridgeBytes,
        dBridgeBytes,
        dCaller,
        body
      );

      let { proof } = await signPayload([notary], [true], payload);
      await dmailbox.connect(signer1).deliverAndHandle(payload, proof);

      const limitStatus = await dbridge.getTokenRateLimit(dLBTC2.address, lChainId);
      expect(limitStatus[0]).to.be.closeTo(amount, delta * 2n);
      expect(limitStatus[1]).to.be.closeTo(0n, delta * 2n);
    });

    it('Wait until all limits recovered', async function () {
      const limitConfig1 = rateLimits.get(dLBTC2.address + lChainId);
      await time.increase(limitConfig1.window);
      const limitStatus1 = await dbridge.getTokenRateLimit(dLBTC2.address, lChainId);
      expect(limitStatus1[0]).to.be.eq(0n);
      expect(limitStatus1[1]).to.be.eq(limitConfig1.limit);

      const limitConfig2 = rateLimits.get(dLBTC.address + newSrcChain);
      const limitStatus2 = await dbridge.getTokenRateLimit(dLBTC.address, newSrcChain);
      expect(limitStatus2[0]).to.be.eq(0n);
      expect(limitStatus2[1]).to.be.eq(limitConfig2.limit);
    });
  });
});

async function payloadFromReceipt(receipt: ContractTransactionReceipt): Promise<
  | {
      payload: string;
      msgSender: string;
    }
  | undefined
> {
  const mailbox = await ethers.getContractFactory('Mailbox');

  for (const log of receipt.logs) {
    try {
      const parsed = mailbox.interface.parseLog(log);
      // @ts-ignore
      if (parsed.name === 'MessageSent') {
        return {
          // @ts-ignore
          payload: parsed.args.payload,
          // @ts-ignore
          msgSender: parsed.args.msgSender
        };
      }
    } catch {}
  }
  return;
}

function decodePayload(payload: string): PayloadStruct {
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['bytes32', 'uint256', 'bytes32', 'address', 'address', 'bytes'],
    payload.replace(GMP_V1_SELECTOR, '0x')
  );
  return {
    id: ethers.sha256(payload),
    msgPath: decoded[0],
    msgNonce: decoded[1],
    msgSender: decoded[2],
    msgRecipient: decoded[3],
    msgDestinationCaller: decoded[4],
    msgBody: decoded[5]
  };
}
