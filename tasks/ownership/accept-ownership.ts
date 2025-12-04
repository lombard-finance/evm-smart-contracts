import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';
import { populateTx } from '../utils';

export async function acceptOwnership(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { target, populate } = taskArgs;

  const contract = await ethers.getContractAt('IOwnable', target);

  if (populate) {
    await populateTx(contract.acceptOwnership, []);
  } else {
    const tx = await contract.acceptOwnership();
    await tx.wait(2);
    console.log(`acceptOwnership tx hash: ${tx.hash}`);
  }
}
