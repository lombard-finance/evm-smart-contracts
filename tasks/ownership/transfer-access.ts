import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function transferAccessControl(
    taskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment
) {
    const { ethers } = hre;

    const { owner, target } = taskArgs;

    const contract = await ethers.getContractAt('IAccessControl', target);
    const tx = await contract.grantRole(
        ethers.encodeBytes32String('0x00'),
        owner
    );
    await tx.wait(2);
    console.log(`grant tx hash: ${tx.hash}`);

    const [signer] = await ethers.getSigners();
    const tx2 = await contract.revokeRole(
        ethers.encodeBytes32String('0x00'),
        await signer.getAddress()
    );
    await tx2.wait(2);
    console.log(`revoke tx hash: ${tx2.hash}`);
}
