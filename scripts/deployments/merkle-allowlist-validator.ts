import { task } from 'hardhat/config';
import { verify } from '../helpers';

/*
 * After deployment:
 * 1. Call setAllowlistRoot() with the initial Merkle root
 * 2. Wire the validator address into the target strategy via setValidator()
 */

task('deploy-merkle-allowlist-validator', 'Deploys the MerkleAllowlistValidator contract')
  .addParam('owner', 'Initial owner address (Ownable2Step)', 'self')
  .setAction(async (taskArgs, hre) => {
    const [signer] = await hre.ethers.getSigners();
    const owner = hre.ethers.isAddress(taskArgs.owner) ? taskArgs.owner : await signer.getAddress();

    const validator = await hre.ethers.deployContract('MerkleAllowlistValidator', [owner]);
    await validator.waitForDeployment();
    const addr = await validator.getAddress();
    console.log('MerkleAllowlistValidator:', addr);
    await verify(hre.run, addr, { constructorArguments: [owner] });
  });
