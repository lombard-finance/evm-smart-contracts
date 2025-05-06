import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set minters (e.g. BTCBPMM)
 * 2. Set pauser
 * 3. Set mint fee
 * 4. Set claimers
 * 5. Set operator
 */

task('deploy-native-lbtc', 'Deploys the NativeLBTC contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('consortium', 'The address of LombardConsortium')
  .addParam('burnCommission', 'The burn commission')
  .addParam('treasury', 'The address of the treasury')
  .addParam('admin', 'The owner of the proxy', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, consortium, burnCommission, treasury, admin, proxyFactoryAddr } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    const data = await create3(
      'NativeLBTC',
      [consortium, burnCommission, treasury, admin],
      proxyFactoryAddr,
      ledgerNetwork,
      owner,
      hre
    );

    // reinitialize
    const lbtc = await ethers.getContractAt('NativeLBTC', data.proxy);
    await lbtc.reinitialize();
  });
