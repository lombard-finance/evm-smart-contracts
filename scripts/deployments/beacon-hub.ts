import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';

/*
 * After deployment:
 * 1. Grant BEACON_ADMIN_ROLE to the address responsible for registering beacons
 * 2. Grant DEPLOYER_ROLE to the address(es) that will call deploy() / deployCreate2()
 */

task('deploy-beacon-hub', 'Deploys the BeaconHub contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'Default admin address', 'self')
  .addParam('upgradeAdmin', 'Proxy upgrade admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    const { ledgerNetwork, adminDelay, proxyFactoryAddr } = taskArgs;

    const { owner, upgradeAdmin: upgradeOwner } = await getOwnersOrDefault(hre, taskArgs.admin, taskArgs.upgradeAdmin);

    await create3('BeaconHub', [Number(adminDelay), owner], proxyFactoryAddr, ledgerNetwork, upgradeOwner, hre);
  });
