import { task } from 'hardhat/config';
import { DEFAULT_STRATEGY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';

task('deploy-blocklist-oracle', 'Deploys a BlocklistOracle via ProxyFactory (CREATE3)')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_STRATEGY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    const { ledgerNetwork, adminDelay, proxyFactoryAddr } = taskArgs;

    const { owner, upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    await create3(
      'BlocklistOracle',
      [Number(adminDelay), owner],
      proxyFactoryAddr,
      ledgerNetwork,
      upgradeAdmin,
      hre,
      'BlocklistOracle'
    );
  });
