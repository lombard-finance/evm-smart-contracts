import { task } from 'hardhat/config';

task('setup-change-bridge', 'Call `changeBridge` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('bridge', 'The address of bridge to be set')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, bridge } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.changeBridge(bridge);
    });
