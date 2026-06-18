import { HardhatRuntimeEnvironment } from 'hardhat/types';

export async function deployLibrary(hre: HardhatRuntimeEnvironment, libraryName: string): Promise<string> {
  const lib = await hre.ethers.deployContract(libraryName);
  await lib.waitForDeployment();
  return await lib.getAddress();
}
