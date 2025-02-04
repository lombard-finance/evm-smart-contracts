import { task } from 'hardhat/config';

task('transfer-ownership', 'Transfers ownership of a contract')
    .addParam('owner', 'The address of the new owner')
    .addParam('target', 'The target contract')
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre;

        const { owner, target } = taskArgs;

        const contract = await ethers.getContractAt('IOwnable', target);
        const tx = await contract.transferOwnership(owner);
        await tx.wait(2);
        console.log(`tx hash: ${tx.hash}`);
    });
