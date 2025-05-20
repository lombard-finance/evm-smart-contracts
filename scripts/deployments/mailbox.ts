import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

task('deploy-gmp-mailbox', 'Deploys the GMP mailbox contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('consortium', 'The address of LombardConsortium')
  .addOptionalParam('admin', 'The owner of the proxy', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ledgerNetwork, consortium, admin, proxyFactoryAddr } = taskArgs;

    if (!hre.ethers.isAddress(consortium)) {
      throw new Error('consortium not an address');
    }
    if (!hre.ethers.isAddress(proxyFactoryAddr)) {
      throw new Error('proxyFactory not an address');
    }

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    await create3('Mailbox', [owner, consortium], proxyFactoryAddr, ledgerNetwork, owner, hre);
  });
