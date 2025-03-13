import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { getProxyFactoryAt, getProxySalt, verify } from '../helpers';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-proxy-mock', 'Deploys ProxyMock')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .addParam('contractName', 'The name of contract to be mocked')
    .addParam('admin', 'Admin of proxy')
    .setAction(async (taskArgs, hre) => {
        const { ledgerNetwork, admin, proxyFactoryAddr, contractName } =
            taskArgs;

        const factory = await getProxyFactoryAt(hre.ethers, proxyFactoryAddr);
        const saltHash = getProxySalt(hre.ethers, ledgerNetwork, contractName);

        const impl = await hre.ethers.deployContract('ProxyMock');
        await impl.waitForDeployment();

        const data = impl.interface.encodeFunctionData('initialize');

        const tx = await factory.createTransparentProxy(
            await impl.getAddress(),
            admin,
            data,
            saltHash
        );
        await tx.wait();

        const proxy = await factory.getDeployed(saltHash);
        console.log('Proxy address:', proxy);

        const proxyAdmin = await hre.upgrades.erc1967.getAdminAddress(proxy);
        console.log('Proxy admin:', proxyAdmin);

        await verify(run, await impl.getAddress());
        await verify(run, proxyAdmin, {
            contract:
                '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin',
            constructorArguments: [admin],
        });
        await verify(run, proxy, {
            contract:
                '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
            constructorArguments: [await impl.getAddress(), admin, data],
        });

        return { proxy, proxyAdmin };
    });
