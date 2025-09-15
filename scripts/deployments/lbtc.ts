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

task('deploy-lbtc', 'Deploys the StakedLBTC contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('consortium', 'The address of LombardConsortium')
  .addParam('treasury', 'The address of the treasury', 'self')
  .addParam('admin', 'The owner of the proxy', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, consortium, treasury, admin, proxyFactoryAddr } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();
    let treasuryAddr = owner;

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    if (hre.ethers.isAddress(treasury)) {
      treasuryAddr = treasury;
    }

    const data = await create3(
      'StakedLBTC',
      [consortium, treasuryAddr, owner],
      proxyFactoryAddr,
      ledgerNetwork,
      owner,
      hre,
      'LBTC'
    );

    // reinitialize
    const lbtc = await ethers.getContractAt('StakedLBTC', data.proxy);
    await lbtc.reinitialize();
  });
