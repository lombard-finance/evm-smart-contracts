import { task } from 'hardhat/config';
import { sleep, verify } from '../helpers';

/*
 * After deployment:
 * 1. Set adapter in bridge
 * 2. Accepts ownership
 *    1. RegistryModuleOwnerCustom::registerAdminViaOwner
 *    2. TokenAdminRegistry::acceptAdminRole
 *    3. TokenAdminRegistry::setPool
 * 3. Configure Token pool `yarn hardhat setup-token-pool`
 */
function chainlinkAdapterTask(taskName: string) {
    task(taskName, 'Deploys the TokenPoolAdapter contract')
        .addOptionalParam('admin', 'The address of the owner', 'self')
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
        .setAction(async (taskArgs, hre) => {
            const {
                admin: adminArg,
                bridge,
                router,
                rmn,
                allowlist,
                gasLimit,
            } = taskArgs;

            const args = [bridge, gasLimit, router, allowlist, rmn];

            const [signer] = await hre.ethers.getSigners();
            const admin = hre.ethers.isAddress(adminArg)
                ? adminArg
                : await signer.getAddress();

            const adapter = await hre.ethers.deployContract('CLAdapter', args);
            await adapter.waitForDeployment();
            await sleep(12_000);

            console.log('Adapter:', await adapter.getAddress());
            console.log('TokenPool:', await adapter.tokenPool());

            await verify(hre.run, await adapter.getAddress(), {
                constructorArguments: args,
                // force: true,
            });

            await verify(hre.run, await adapter.tokenPool(), {
                constructorArguments: [
                    await adapter.lbtc(),
                    router,
                    allowlist,
                    rmn,
                    await adapter.getAddress(),
                ],
                // force: true,
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

            await sleep(12_000);

            if (
                admin &&
                (await adapter.owner()).toLowerCase() != admin.toLowerCase()
            ) {
                console.log(admin, await adapter.owner());
                await adapter.transferOwnership(admin);
            }

            if (
                admin &&
                (await tokenPool.owner()).toLowerCase() != admin.toLowerCase()
            ) {
                console.log(admin, await tokenPool.owner());
                await tokenPool.transferOwnership(admin);
            }
        });
}

chainlinkAdapterTask('deploy-chainlink-adapter');
chainlinkAdapterTask('deploy-token-pool-adapter');
chainlinkAdapterTask('deploy-token-pool');
chainlinkAdapterTask('deploy:TokenPool');
