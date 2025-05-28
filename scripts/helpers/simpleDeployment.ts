import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify } from './index';

export async function deploy(
  contract: string,
  args: any[],
  ledgerNetwork: string,
  hre: HardhatRuntimeEnvironment
): Promise<{ contractAddress: any }> {
  const { ethers, run, upgrades } = hre;

  const impl = await ethers.deployContract(contract, args);
  await impl.waitForDeployment();

  const contractAddress = await impl.getAddress()
  await verify(run, contractAddress);

  return { contractAddress };
}
