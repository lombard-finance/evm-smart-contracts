import { LombardTokenPoolV2 } from '../typechain-types';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { deployContract, Signer } from './helpers';

describe('LombardTokenPoolV2', function () {
  let deployer: Signer, owner: Signer, router: Signer, rmnProxy: Signer, bridge: Signer;
  let tokenPool: LombardTokenPoolV2;
  let snapshot: SnapshotRestorer;

  before(async () => {
    const tokenWithDecimals = await deployContract('BridgeTokenMock', [], false);

    tokenPool = await deployContract(
      'LombardTokenPoolV2',
      [bridge, tokenWithDecimals, [], rmnProxy, router, 18],
      false
    );

    snapshot = await takeSnapshot();
  });

  // TODO: deploy without decimals method
  // TODO: try to implement integration tests
});
