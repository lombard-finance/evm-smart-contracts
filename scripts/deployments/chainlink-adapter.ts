import { task } from 'hardhat/config';
import { sleep, verify } from '../helpers';

/*
 * After deployment:
 * 1. Set adapter in bridge
 * 2. Accept ownership
 * 3. Configure Token pool
 */
function chainlinkAdapterTask(taskName: string) {
    task(taskName, 'Deploys the TokenPoolAdapter contract')
        .addOptionalParam('admin', 'The address of the owner')
        .addParam('router', 'The chainlink ccip router')
        .addParam('bridge', 'Bridge to set adapter on')
        .addParam('rmn', 'The address of the RmnProxy')
        .addVariadicPositionalParam(
            'allowlist',
            'The list of addresses allowed to bridge',
            []
        )
        .setAction(async (taskArgs, hre) => {
            const { admin, bridge, router, rmn, allowlist } = taskArgs;

            const args = [router, allowlist, rmn, bridge];

            const adapter = await hre.ethers.deployContract(
                'TokenPoolAdapter',
                args
            );
            console.log('Chainlink Adapter:', await adapter.getAddress());

            await verify(hre.run, await adapter.getAddress(), {
                constructorArguments: args,
            });

            if (admin && (await adapter.owner()) != admin) {
                await adapter.transferOwnership(admin);
            }
        });
}

chainlinkAdapterTask('deploy-chainlink-adapter');
chainlinkAdapterTask('deploy-token-pool-adapter');
chainlinkAdapterTask('deploy-token-pool');
chainlinkAdapterTask('deploy:TokenPoolAdapter');
