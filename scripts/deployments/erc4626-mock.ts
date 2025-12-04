import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-erc4626-mock', 'Deploys the ERC4626 Mock contract')
  .addParam('asset', 'The asset address', 'mainnet')
  .setAction(async (taskArgs, hre) => {
    const { ethers, run } = hre;
    const { asset } = taskArgs;

    const deployment = await ethers.deployContract('ERC4626Mock', [asset]);
    await deployment.waitForDeployment();

    console.log(`Deployment address is ${await deployment.getAddress()}`);

    await verify(run, await deployment.getAddress(), {
      constructorArguments: [asset]
    });
  });
