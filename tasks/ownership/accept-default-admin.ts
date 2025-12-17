import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';
import { populateTx } from '../utils';

export async function acceptDefaultAdmin(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { target, populate } = taskArgs;

  const contract = await ethers.getContractAt('IAccessControlDefaultAdminRules', target);

  if (populate) {
    await populateTx(contract.acceptDefaultAdminTransfer, []);
  } else {
    const tx = await contract.acceptDefaultAdminTransfer();
    await tx.wait(2);
    console.log(`beginDefaultAdminTransfer tx hash: ${tx.hash}`);
  }
}
