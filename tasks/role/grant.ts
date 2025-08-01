import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export async function grantRole(taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;

  const { account, target, role, populate } = taskArgs;

  if (!hre.ethers.isAddress(account)) {
    throw new Error(`account ${account} is not a valid address`);
  }

  const contract = await ethers.getContractAt('IAccessControl', target);

  let roleHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(role.toUpperCase()));
  if (role.toUpperCase() === 'DEFAULT_ADMIN_ROLE') {
    roleHash = ethers.ZeroHash;
  }

  console.log(`grant role ${roleHash} to ${account}`);
  if (populate) {
    const txData = await contract.grantRole.populateTransaction(roleHash, account);
    console.log(`Tx: ${JSON.stringify(txData, null, 2)}`);
  } else {
    const tx = await contract.grantRole(roleHash, account);
    await tx.wait(2);
    console.log(`grant tx hash: ${tx.hash}`);
  }
}
