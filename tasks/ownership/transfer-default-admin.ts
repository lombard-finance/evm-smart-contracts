import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function transferDefaulAdmin(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { owner, target } = taskArgs;

  const contract = await ethers.getContractAt('IAccessControlDefaultAdminRules', target);
  const tx = await contract.beginDefaultAdminTransfer(owner);
  await tx.wait(2);
  console.log(`beginDefaultAdminTransfer tx hash: ${tx.hash}`);
}
