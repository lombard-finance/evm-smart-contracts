import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-oracle', 'Deploys the Oracle contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('upgradeAdmin', 'The address of the owner', 'self')
  .addParam('consortium', 'The address of LombardConsortium')
  .addParam('token', 'The address of StakedLBTC token')
  .addParam('denom', 'The hash of token denominator')
  .addParam('ratio', 'The initial ratio for the token', (10n ** 18n).toString())
  .addParam('switchTime', 'The time when ratio becomes applicable', 0n.toString())
  .addParam(
    'maxInterval',
    'The maximum interval between now and switch time when publishing new ratio',
    3600n.toString()
  ) // Default - 1 hour
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    const {
      ledgerNetwork,
      admin: adminArg,
      upgradeAdmin: upgradeAdminArg,
      proxyFactoryAddr,
      consortium,
      token,
      denom,
      ratio,
      switchTime,
      maxInterval
    } = taskArgs;

    const { owner, upgradeAdmin: upgradeOwner } = await getOwnersOrDefault(hre, adminArg, upgradeAdminArg);

    await create3(
      'StakedLBTCOracle',
      [owner, consortium, token, denom, ratio, switchTime, maxInterval],
      proxyFactoryAddr,
      ledgerNetwork,
      upgradeOwner,
      hre
    );
  });
