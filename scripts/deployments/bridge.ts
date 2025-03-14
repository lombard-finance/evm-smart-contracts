import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set destinations
 */

task('deploy-bridge', 'Deploys the Bridge contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .addParam('lbtc', 'The address of the LBTC contract')
  .addParam('treasury', 'The address of the treasury')
  .setAction(async (taskArgs, hre) => {
    let { ledgerNetwork, lbtc, admin: adminArg, proxyFactoryAddr, treasury } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await create3('Bridge', [lbtc, treasury, admin], proxyFactoryAddr, ledgerNetwork, admin, hre);
  });
