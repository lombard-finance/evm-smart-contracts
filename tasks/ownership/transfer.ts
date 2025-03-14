import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function transferOwnership(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target } = taskArgs;

  const contract = await ethers.getContractAt('IOwnable', target);
  const tx = await contract.transferOwnership(owner);
  await tx.wait(2);
  console.log(`tx hash: ${tx.hash}`);
}
