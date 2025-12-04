import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';
import { populateTx } from '../utils';

export async function transferOwnership(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target, populate } = taskArgs;

  const contract = await ethers.getContractAt('IOwnable', target);

  if (populate) {
    await populateTx(contract.transferOwnership, [owner]);
  } else {
    const tx = await contract.transferOwnership(owner);
    await tx.wait(2);
    console.log(`tx hash: ${tx.hash}`);
  }
}
