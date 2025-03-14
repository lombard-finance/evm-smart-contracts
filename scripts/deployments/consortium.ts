import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-consortium', 'Deploys the Consortium contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    const { ledgerNetwork, admin, proxyFactoryAddr } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    await create3('Consortium', [owner], proxyFactoryAddr, ledgerNetwork, owner, hre);
  });
