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
        .addParam(
            'gasLimit',
            'Execution gas limit on destination chain',
            300_000n.toString()
        )
        .addFlag('enableAttestation')
        .setAction(async (taskArgs, hre) => {
            const {
                admin,
                bridge,
                router,
                rmn,
                allowlist,
                gasLimit,
                enableAttestation,
            } = taskArgs;

            const args = [
                bridge,
                gasLimit,
                router,
                allowlist,
                rmn,
                enableAttestation,
            ];

            const adapter = await hre.ethers.deployContract('CLAdapter', args);
            await adapter.waitForDeployment();
            await sleep(12_000);

            console.log('Adapter:', await adapter.getAddress());
            console.log('TokenPool:', await adapter.tokenPool());

            await verify(hre.run, await adapter.getAddress(), {
                constructorArguments: args,
                force: true,
            });

            await verify(hre.run, await adapter.tokenPool(), {
                constructorArguments: [
                    await adapter.lbtc(),
                    router,
                    allowlist,
                    rmn,
                    await adapter.getAddress(),
                    enableAttestation,
                ],
            });

            const tokenPool = await hre.ethers.getContractAt(
                'LombardTokenPool',
                await adapter.tokenPool()
            );

            await tokenPool.acceptOwnership();
            console.log(
                'TokenPool ownership accepted:',
                await tokenPool.owner()
            );

            if (admin && (await adapter.owner()) != admin) {
                await adapter.transferOwnership(admin);
            }

            if (admin && (await tokenPool.owner()) != admin) {
                await tokenPool.transferOwnership(admin);
            }
        });
}

chainlinkAdapterTask('deploy-chainlink-adapter');
chainlinkAdapterTask('deploy-token-pool-adapter');
chainlinkAdapterTask('deploy-token-pool');
chainlinkAdapterTask('deploy:TokenPool');
