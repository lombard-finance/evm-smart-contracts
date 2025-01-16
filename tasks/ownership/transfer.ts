import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function transferOwnership(
    taskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment
) {
    const { ethers } = hre;

    const contract = await ethers.getContractAt('IOwnable', taskArgs.target);
    const tx = await contract.transferOwnership(taskArgs.target);
    await tx.wait(2);
    console.log(`tx hash: ${tx.hash}`);
}
