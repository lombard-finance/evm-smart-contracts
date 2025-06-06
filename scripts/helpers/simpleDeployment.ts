import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify } from './index';

export async function deploy(
  contract: string,
  args: any[],
  contractFile: string,
  hre: HardhatRuntimeEnvironment
): Promise<{ contractAddress: any }> {
  const { ethers, run, upgrades } = hre;

  const impl = await ethers.deployContract(contract, args);
  await impl.waitForDeployment();

  const contractAddress = await impl.getAddress();
  console.log('Contract address:', contractAddress);
  await verify(run, contractAddress, {
    contract: contractFile,
    constructorArguments: args
  });

  return { contractAddress };
}
