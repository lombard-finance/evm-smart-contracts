import { task } from 'hardhat/config';
import { deploy } from '../helpers/simpleDeployment';
import { ethers } from 'ethers';

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

/*
 * After deployment:
 * 1. Nothing
 */

task('deploy-bard-distributor', 'Deploys the BARD token distributor contract (non-upgradable)')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('token', 'The address of the BARD token')
  .addParam('merkleRoot', 'The Merkle Root for the distribution')
  .addParam('claimEnd', 'The Claim end timestamp')
  .addParam('vault', 'The address of the vault to stake claimed tokens', ethers.ZeroAddress)
  .setAction(async (taskArgs, hre) => {
    let { ledgerNetwork, admin: adminArg, token, merkleRoot, claimEnd, vault } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await deploy(
      'TokenDistributor',
      [merkleRoot, token, admin, claimEnd, vault],
      'contracts/BARD/TokenDistributor.sol:TokenDistributor',
      hre
    );
  });
