import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';
import { populateTx } from '../utils';

export async function transferDefaulAdmin(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target, populate } = taskArgs;

  const contract = await ethers.getContractAt('IAccessControlDefaultAdminRules', target);

  if (populate) {
    await populateTx(contract.beginDefaultAdminTransfer, [owner]);
  } else {
    const tx = await contract.beginDefaultAdminTransfer(owner);
    await tx.wait(2);
    console.log(`beginDefaultAdminTransfer tx hash: ${tx.hash}`);
  }
}
