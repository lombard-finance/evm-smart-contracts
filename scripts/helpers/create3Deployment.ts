import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify, getProxyFactoryAt, getProxySalt } from './index';

export async function create3(
  contract: string,
  contractName: string = contract,
  args: any[],
  factoryAddr: string,
  ledgerNetwork: string,
  admin: string,
  hre: HardhatRuntimeEnvironment
): Promise<{ proxy: any; proxyAdmin: any }> {
  const { ethers, run, upgrades } = hre;

  const factory = await getProxyFactoryAt(ethers, factoryAddr);
  const saltHash = getProxySalt(ethers, ledgerNetwork, contractName);

  const impl = await ethers.deployContract(contract);
  await impl.waitForDeployment();

  const data = impl.interface.encodeFunctionData('initialize', args);

  const tx = await factory.createTransparentProxy(await impl.getAddress(), admin, data, saltHash);
  await tx.wait();

  const proxy = await factory.getDeployed(saltHash);
  console.log('Proxy address:', proxy);

  const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
  console.log('Proxy admin:', proxyAdmin);

  await verify(run, await impl.getAddress());
  await verify(run, proxyAdmin, {
    contract: '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin',
    constructorArguments: [admin]
  });
  await verify(run, proxy, {
    contract: '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
    constructorArguments: [await impl.getAddress(), admin, data]
  });

  return { proxy, proxyAdmin };
}
