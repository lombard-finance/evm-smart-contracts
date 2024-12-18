import { task } from 'hardhat/config';

task('setup-transfer-owner-role', 'Call `transferOwnership` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('owner', 'The address to be owner')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, owner } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.transferOwnership(owner);
    });
