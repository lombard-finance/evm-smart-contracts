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
    .addParam(
        'gasLimit',
        'Execution gas limit on destination chain',
        100_000n.toString()
    )
    .setAction(async (taskArgs, hre) => {
        const { admin, bridge, lzEndpoint, gasLimit } = taskArgs;

        const args = [admin, bridge, lzEndpoint, gasLimit];

        const adapter = await hre.ethers.deployContract('LZAdapter', args);
        console.log(`LZAdapter: ${await adapter.getAddress()}`);

        await verify(hre.run, await adapter.getAddress(), {
            constructorArguments: args,
        });
    });
