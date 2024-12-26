import { task } from 'hardhat/config';

task('setup-minter', 'Call `addMinter` on smart-contract')
    .addParam('target', 'The address of the smart-contract')
    .addParam('minter', 'The address of the minter')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, minter } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.addMinter(minter);
    });
