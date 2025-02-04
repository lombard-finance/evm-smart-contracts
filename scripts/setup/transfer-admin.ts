import { task } from 'hardhat/config';

task('transfer-admin', 'Transfers admin role of a contract')
    .addParam('owner', 'The address of the new admin')
    .addParam('target', 'The target contract')
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre;

        const { owner, target } = taskArgs;

        const contract = await ethers.getContractAt('IAccessControl', target);
        const tx = await contract.grantRole(0x00, owner);
        await tx.wait(2);
        console.log(`grant tx hash: ${tx.hash}`);

        const [signer] = await ethers.getSigners();
        const tx2 = await contract.revokeRole(0x00, await signer.getAddress());
        await tx2.wait(2);
        console.log(`revoke tx hash: ${tx2.hash}`);
    });
