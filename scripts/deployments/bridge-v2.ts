import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set destinations
 */

task('deploy-gmp-bridge', 'Deploys the BridgeV2 contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .addParam('mailbox', 'The address of the mailbox')
  .setAction(async (taskArgs, hre) => {
    let { ledgerNetwork, mailbox, admin: adminArg, proxyFactoryAddr } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await create3('BridgeV2', [admin, mailbox], proxyFactoryAddr, ledgerNetwork, admin, hre);
  });
