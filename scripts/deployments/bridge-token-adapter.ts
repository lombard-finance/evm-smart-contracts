import { task } from 'hardhat/config';
import { proxyDeployment } from '../helpers/proxyDeployment';
import { deploy } from '../helpers/simpleDeployment';
import { parseLibrariesArg } from '../helpers/linkedLibraries';

task('deploy-bridge-token-adapter', 'Deploys the BridgeTokenAdapter contract')
  .addParam('consortium', 'The address of LombardConsortium')
  .addOptionalParam('treasury', 'The address of the treasury', 'self')
  .addOptionalParam('admin', 'The owner of the proxy', 'self')
  .addOptionalParam('bridgeToken', 'The bridge token contract address', 'mock')
  .addOptionalParam('adminChangeDelay', 'The delay of admin role change', '0')
  .addOptionalParam('libraries', 'Comma-separated linked libraries as LibraryName:address', '')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const {
      consortium,
      treasury: treasuryArg,
      admin: adminArg,
      adminChangeDelay,
      bridgeToken: bridgeTokenArg,
      libraries
    } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();
    let treasury = hre.ethers.isAddress(treasuryArg) ? treasuryArg : await signer.getAddress();
    if (!hre.ethers.isAddress(consortium)) {
      throw Error(`invalid arg: consortium (${consortium}) not an address`);
    }
    let bridgeToken = bridgeTokenArg;
    let bridgeTokenMocked = false;
    if (!hre.ethers.isAddress(bridgeToken)) {
      console.log('Deploying BridgeTokenMock...');
      const { contractAddress } = await deploy(
        'BridgeTokenMock',
        [],
        'contracts/mock/BridgeTokenMock.sol:BridgeTokenMock',
        hre
      );

      console.log(`BridgeTokenMock deployed at ${contractAddress}`);
      bridgeToken = contractAddress;
      bridgeTokenMocked = true;
    }

    const { proxy: adapter } = await proxyDeployment(
      'BridgeTokenAdapter',
      [consortium, treasury, owner, adminChangeDelay, bridgeToken],
      owner,
      hre,
      parseLibrariesArg(libraries)
    );

    if (bridgeTokenMocked) {
      const bridgeTokenContract = await ethers.getContractAt('BridgeTokenMock', bridgeToken);
      console.log(`Migrating BridgeTokenMock bridge role to ${adapter}...`);
      await bridgeTokenContract.migrateBridgeRole(adapter);
    }
  });
