import { BridgeV2, LombardTokenPoolV2 } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { Addressable, deployContract, getSignersWithPrivateKeys, Signer } from './helpers';

describe('LombardTokenPoolV2', function () {
  let deployer: Signer, owner: Signer, router: Signer, rmnProxy: Signer, mailbox: Signer;
  let tokenPool: LombardTokenPoolV2;
  let snapshot: SnapshotRestorer;

  before(async () => {
    [deployer, owner, router, rmnProxy, mailbox] = await getSignersWithPrivateKeys();

    const tokenWithDecimals = await deployContract('BridgeTokenMock', [], false);
    const bridge = await deployContract('BridgeV2', [owner.address, mailbox.address]);

    tokenPool = await deployContract(
      'LombardTokenPoolV2',
      [await bridge.getAddress(), await tokenWithDecimals.getAddress(), [], rmnProxy.address, router.address, 18],
      false
    );

    snapshot = await takeSnapshot();
  });

  it('deploy', async () => {});

  // TODO: deploy without decimals method
  // TODO: try to implement integration tests
});
