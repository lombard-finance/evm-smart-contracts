import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify, getProxyFactoryAt, getProxySalt } from './index';

import { CustomRuntimeEnvironment } from '../cre';

export async function proxyDeployment(
    contract: string,
    args: any[],
    admin: string,
    hre: HardhatRuntimeEnvironment
): Promise<{ proxy: any; proxyAdmin: any }> {
    const { ethers, run, upgrades } = hre;

    const cre = new CustomRuntimeEnvironment(hre);

    const implementationAddress = await cre.deployImplementation(contract);
    const implementationContractFactory =
        await ethers.getContractFactory(contract);

    const initData = implementationContractFactory.interface.encodeFunctionData(
        'initialize',
        args
    );

    const proxyAddress = await cre.deployTransparentProxy(
        admin,
        implementationAddress,
        initData
    );
    console.log('Proxy address:', proxyAddress);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxyAddress);
    console.log('Proxy admin:', proxyAdmin);

    await verify(run, proxyAdmin, {
        contract:
            '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin',
        constructorArguments: [admin],
    });

    await verify(run, proxyAddress, {
        contract:
            '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
        constructorArguments: [implementationAddress, admin, initData],
    });

    return { proxy: proxyAddress, proxyAdmin };
}
