import { task } from 'hardhat/config';

task('setup-change-consortium', 'Call `changeConsortium` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('consortium', 'The address of consortium to be set')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, consortium } = taskArgs;

        const consumer = await ethers.getContractAt(
            'IConsortiumConsumer',
            target
        );
        await consumer.changeConsortium(consortium);
    });
