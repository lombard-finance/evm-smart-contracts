import { task } from 'hardhat/config';

/*
 * After deployment:
 * 1. Set adapter in bridge
 * 2. Set bridge in adapter
 */
function defaultAdapterTask(taskName: string) {
    task(taskName, 'Deploys the DefaultAdapter contract')
        .addParam('admin', 'The address of the owner')
        .addParam('lbtc', 'The address of the LBTC contract')
        .addOptionalParam('bridge', 'Bridge to set adapter on')
        .setAction(async (taskArgs, hre) => {
            const { lbtc, admin, bridge } = taskArgs;

            const adapter = await hre.ethers.deployContract('DefaultAdapter', [
                lbtc,
                admin,
            ]);
            console.log('Default Adapter:', await adapter.getAddress());

            if (bridge) {
                const bridgeContract = await hre.ethers.getContractAt(
                    'Bridge',
                    bridge
                );
                await bridgeContract.changeAdapter(await adapter.getAddress());
                await adapter.changeBridge(bridge);
            }
        });
}

defaultAdapterTask('deploy-default-adapter');
defaultAdapterTask('deploy:DefaultAdapter');
