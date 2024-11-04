import { task } from 'hardhat/config';

task('setup-change-treasury', 'Call `changeTreasuryAddress` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('treasury', 'The address to be treasury')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, treasury } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.changeTreasuryAddress(treasury);
    });
