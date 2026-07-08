import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify, getProxyFactoryAt, getProxySalt } from './index';
import { deployLinkedImplementation, implementationVerifyOptions, LinkedLibraries } from './linkedLibraries';
import { Addressable } from 'ethers';

export async function create3(
  contract: string,
  args: any[],
  factoryAddr: string,
  ledgerNetwork: string,
  admin: string,
  hre: HardhatRuntimeEnvironment,
  contractName: string = contract,
  nonce: number = 0,
  libraries: LinkedLibraries = {}
): Promise<{ proxy: any; proxyAdmin: any }> {
  const { impl, libraries: linkedLibraries } = await deployLinkedImplementation(hre, contract, libraries);

  const data = impl.interface.encodeFunctionData('initialize', args);

  return deployProxyWithCreate3(
    impl,
    data,
    factoryAddr,
    getProxySalt(hre.ethers, ledgerNetwork, contractName, nonce),
    admin,
    hre,
    contract,
    linkedLibraries
  );
}

export async function deployProxyWithCreate3(
  impl: Addressable,
  implData: string,
  factoryAddr: string,
  saltHash: string,
  admin: string,
  hre: HardhatRuntimeEnvironment,
  contract?: string,
  linkedLibraries: LinkedLibraries = {}
): Promise<{ proxy: any; proxyAdmin: any }> {
  const { ethers, run, upgrades } = hre;

  const factory = await getProxyFactoryAt(ethers, factoryAddr);

  const tx = await factory.createTransparentProxy(await impl.getAddress(), admin, implData, saltHash);
  await tx.wait();

  const proxy = await factory.getDeployed(saltHash);
  console.log('Proxy address:', proxy);

  const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
  console.log('Proxy admin:', proxyAdmin);

  if (contract) {
    await verify(run, await impl.getAddress(), implementationVerifyOptions(hre, contract, linkedLibraries));
  } else {
    await verify(run, await impl.getAddress());
  }
  await verify(run, proxyAdmin, {
    contract: '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin',
    constructorArguments: [admin]
  });
  await verify(run, proxy, {
    contract: '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
    constructorArguments: [await impl.getAddress(), admin, implData]
  });

  return { proxy, proxyAdmin };
}
