import { task } from 'hardhat/config';

task('setup-claimer', 'Call `addClaimer` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('claimer', 'The address to be claimer')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, claimer } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.addClaimer(claimer);
    });
