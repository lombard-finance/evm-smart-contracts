import { task } from 'hardhat/config';
import { sleep, verify } from '../helpers';

/*
 * After deployment:
 * 1. Set EIDs
 */

task('deploy-lzadapter', 'Deploys the LZAdapter contract')
    .addParam('admin', 'The address of the owner')
    .addParam('lzEndpoint', 'The LayerZero endpoint')
    .addParam('bridge', 'Bridge to set adapter on')
    .setAction(async (taskArgs, hre) => {
        const { admin, bridge, lzEndpoint } = taskArgs;

        const args = [admin, lzEndpoint, bridge];

        const adapter = await hre.ethers.deployContract('LZAdapter', args);
        console.log(`LZAdapter: ${await adapter.getAddress()}`);

        await verify(hre.run, await adapter.getAddress(), {
            constructorArguments: args,
        });
    });
