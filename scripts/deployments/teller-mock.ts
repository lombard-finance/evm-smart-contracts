import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-teller-mock', 'Deploys the Teller Mock contract')
    .addParam('lbtc', 'The address of the LBTC contract')
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;

        const { lbtc } = taskArgs;

        const deployment = await hre.ethers.deployContract(
            'TellerWithMultiAssetSupportMock',
            [lbtc]
        );
        await deployment.waitForDeployment();

        console.log(`Deployment address is ${await deployment.getAddress()}`);

        await verify(hre.run, await deployment.getAddress(), {
            constructorArguments: [lbtc],
        });
    });
