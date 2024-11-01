import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { verify, getProxyFactoryAt, getProxySalt } from './index';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';
import { string } from 'hardhat/internal/core/params/argumentTypes';

export async function upgradeProxy(
    contract: string,
    proxy: string,
    hre: HardhatRuntimeEnvironment,
    calldata: BytesLike = '0x'
): Promise<{ proxy: string; implementation: string }> {
    const { ethers, run, upgrades } = hre;

    const impl = await ethers.deployContract(contract);
    await impl.waitForDeployment();

    const proxyAdmin = await ethers.getContractAt(
        'IProxyAdmin',
        await upgrades.erc1967.getAdminAddress(proxy)
    );
    console.log('Proxy admin:', await proxyAdmin.getAddress());

    const response = await proxyAdmin.upgradeAndCall(proxy, impl, calldata);
    await response.wait(2);

    await verify(run, await impl.getAddress());

    return {
        proxy,
        implementation: await impl.getAddress(),
    };
}
