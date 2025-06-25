import { task } from 'hardhat/config';
import { deploy } from '../helpers/simpleDeployment';

/*
 * After deployment:
 * 1. Nothing
 */

task('deploy-bard', 'Deploys the BARD contract (non-upgradable)')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('treasury', 'The address of the treasury')
  .setAction(async (taskArgs, hre) => {
    let { ledgerNetwork, admin: adminArg, treasury } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await deploy('BARD', [admin, treasury], 'contracts/BARD/BARD.sol:BARD', hre);
  });
