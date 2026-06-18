import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { parseLibrariesArg } from '../helpers/linkedLibraries';

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
  .addParam('treasury', 'The address of the treasury', 'self')
  .addParam('admin', 'The owner of the proxy', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .addOptionalParam('adminChangeDelay', 'Default admin delay (seconds) for AccessControlDefaultAdminRules', '0')
  .addOptionalParam('libraries', 'Comma-separated linked libraries as LibraryName:address', '')
  .setAction(async (taskArgs, hre, network) => {
    const { ledgerNetwork, treasury, admin, proxyFactoryAddr, adminChangeDelay, libraries } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();
    let treasuryAddr = owner;

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    if (hre.ethers.isAddress(treasury)) {
      treasuryAddr = treasury;
    }

    await create3(
      'StakedLBTC',
      [treasuryAddr, owner, adminChangeDelay],
      proxyFactoryAddr,
      ledgerNetwork,
      owner,
      hre,
      'LBTC',
      0,
      parseLibrariesArg(libraries)
    );
  });
