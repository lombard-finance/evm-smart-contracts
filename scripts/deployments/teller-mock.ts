import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-teller-mock', 'Deploys the Teller Mock contract').setAction(
    async (taskArgs, hre) => {
        const { ethers, run } = hre;

        const deployment = await ethers.deployContract(
            'TellerWithMultiAssetSupportMock'
        );
        await deployment.waitForDeployment();

        console.log(`Deployment address is ${await deployment.getAddress()}`);

        await verify(run, await deployment.getAddress());
    }
);
