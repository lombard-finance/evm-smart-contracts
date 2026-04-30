import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-consortium', 'Deploys the Consortium contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('upgradeAdmin', 'The address of the owner', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    const { ledgerNetwork, admin, upgradeAdmin, proxyFactoryAddr } = taskArgs;

    const { owner, upgradeAdmin: upgradeOwner } = await getOwnersOrDefault(hre, admin, upgradeAdmin);

    await create3('Consortium', [owner], proxyFactoryAddr, ledgerNetwork, upgradeOwner, hre);
  });
