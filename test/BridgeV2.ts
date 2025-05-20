import { MailboxMock, LBTCMock, BridgeV2 } from '../typechain-types';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { getSignersWithPrivateKeys, deployContract, encode, Signer, getGMPPayload } from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';

const BRIDGE_PAYLOAD_SIZE = 356;

describe('BridgeV2', function () {
  let deployer: Signer, signer1: Signer, signer2: Signer;
  let mailbox: MailboxMock;
  let snapshot: SnapshotRestorer;
  let bridge: BridgeV2;
  let lChainId: string;
  let globalNonce = 1;
  let lbtc: LBTCMock;

  before(async function () {
    [deployer, signer1, signer2] = await getSignersWithPrivateKeys();

    mailbox = await deployContract<MailboxMock>('MailboxMock', [deployer.address, deployer.address, 0n, 0n]);

    const { chainId } = await ethers.provider.getNetwork();
    lChainId = encode(['uint256'], [chainId]);

    await mailbox.enableMessagePath(lChainId, encode(['address'], [await mailbox.getAddress()]));

    bridge = await deployContract<BridgeV2>('BridgeV2', [deployer.address, await mailbox.getAddress()]);
    // allow required payload size and exclude from fees
    await mailbox.connect(deployer).setSenderConfig(bridge, BRIDGE_PAYLOAD_SIZE, true);
    lbtc = await deployContract<LBTCMock>('LBTCMock', [deployer.address, 0, deployer.address, deployer.address]);
    await lbtc.addMinter(await bridge.getAddress());

    snapshot = await takeSnapshot();
  });

  const AMOUNT = 1_0000_0000n;

  beforeEach(async function () {
    globalNonce = 1;
    await lbtc.mintTo(signer1.address, AMOUNT);
    await lbtc.connect(signer1).approve(await bridge.getAddress(), AMOUNT);

    const bridge32Bytes = encode(['address'], [await bridge.getAddress()]);
    const lbtc32Bytes = encode(['address'], [await lbtc.getAddress()]);

    await bridge.connect(deployer).setDestinationBridge(lChainId, bridge32Bytes);
    await bridge.connect(deployer).setDestinationToken(lChainId, await lbtc.getAddress(), lbtc32Bytes);
  });

  afterEach(async function () {
    await snapshot.restore();
  });

  describe('Setters and Getters', () => {
    it('should return owner', async function () {
      expect(await bridge.owner()).to.equal(deployer.address);
    });

    it('should return consortium', async function () {
      expect(await bridge.mailbox()).to.equal(await mailbox.getAddress());
    });
  });

  describe('Bridge', function () {
    // TODO: should fail if token not added
    // TODO: should fail if destination bridge not added

    it('configured', async () => {
      const bridge32Bytes = encode(['address'], [await bridge.getAddress()]);
      expect(await bridge.destinationBridge(lChainId)).to.be.equal(bridge32Bytes);
    });

    it('successful', async () => {
      const recipient = encode(['address'], [signer1.address]);
      const destinationCaller = encode(['address'], [ethers.ZeroAddress]);
      const body = ethers.solidityPacked(
        ['uint8', 'bytes32', 'bytes32', 'uint256'],
        [await bridge.MSG_VERSION(), encode(['address'], [await lbtc.getAddress()]), recipient, AMOUNT]
      );

      const bridge32Bytes = encode(['address'], [await bridge.getAddress()]);

      const payload = getGMPPayload(
        await mailbox.getAddress(),
        lChainId,
        lChainId,
        globalNonce++,
        bridge32Bytes,
        await bridge.destinationBridge(lChainId),
        destinationCaller,
        body
      );

      await expect(
        bridge.connect(signer1).deposit(lChainId, await lbtc.getAddress(), recipient, AMOUNT, destinationCaller)
      )
        .to.emit(mailbox, 'MessageSent')
        .withArgs(lChainId, await bridge.getAddress(), bridge32Bytes, payload);

      const result = mailbox.connect(signer1).deliverAndHandle(payload, '0x');
      await expect(result).to.not.emit(mailbox, 'MessageHandleError');
      await expect(result)
        .to.emit(bridge, 'WithdrawFromBridge')
        .withArgs(signer1.address, lChainId, await lbtc.getAddress(), AMOUNT);
    });

    // TODO: revert after message path disabled (when implemented)
    // TODO: revert if destination caller set, but caller is different
    // TODO: `MessageHandleError` emitted if handler call failed, but reprocessable without signatures
  });
});
