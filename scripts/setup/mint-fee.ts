import { task } from 'hardhat/config';

task('setup-mint-fee', 'Call `setMintFee` on smart-contract')
    .addParam('target', 'The address of smart-contract')
    .addParam('fee', 'The fee to be set')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, fee } = taskArgs;

        const lbtc = await ethers.getContractAt('LBTC', target);
        await lbtc.setMintFee(fee);
    });
