import { task, vars } from 'hardhat/config';
import {
    verify,
    getAddresses,
    getProxyFactoryAt,
    getProxySalt,
} from './helpers';
import { DEFAULT_PROXY_FACTORY } from './helpers/constants';

/*
 * After deployment:
 * 1. Grant pauser role
 * 2. Grant timelock role
 */

task('deploy-btcbpmm', 'Deploys the LombardConsortium contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('btcb', 'The address of the BTCB contract')
    .addParam('stakeLimit', 'The stake limit', (30n * 10n ** 8n).toString()) // default is 30 LBTC
    .addParam('withdrawAddress', 'The address to withdraw to')
    .addParam('relativeFee', 'The relative fee of the pmm', 10n.toString())
    .setAction(async (taskArgs, hre) => {
        const {
            ledgerNetwork,
            lbtc,
            btcb,
            admin,
            stakeLimit,
            withdrawAddress,
            proxyFactoryAddr,
            relativeFee,
        } = taskArgs;
        const { ethers, run, upgrades } = hre;

        const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);
        const saltHash = getProxySalt(ethers, ledgerNetwork, 'BTCBPMM');

        const btcpmmImpl = await ethers.deployContract('BTCBPMM');
        await btcpmmImpl.waitForDeployment();

        const data = btcpmmImpl.interface.encodeFunctionData('initialize', [
            lbtc,
            btcb,
            admin,
            stakeLimit,
            withdrawAddress,
            relativeFee,
        ]);

        const tx = await factory.createTransparentProxy(
            await btcpmmImpl.getAddress(),
            admin,
            data,
            saltHash
        );
        await tx.wait();

        const proxy = await factory.getDeployed(saltHash);
        console.log('Proxy address:', proxy);

        const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
        console.log('Proxy admin:', proxyAdmin);

        await verify(run, await factory.getAddress());
        await verify(run, await btcpmmImpl.getAddress());
        await verify(run, proxyAdmin, {
            contract:
                '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin',
            constructorArguments: [admin],
        });
        await verify(run, proxy, {
            contract:
                '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
            constructorArguments: [await btcpmmImpl.getAddress(), admin, data],
        });
    });

task(
    'deploy-btcbpmm-vars',
    'Deploys the BTCBPMM contract with environment variables'
)
    .addOptionalParam('lbtc', 'The address of the LBTC contract')
    .addOptionalParam('btcb', 'The address of the BTCB contract')
    .addOptionalParam('admin', 'The address of the admin')
    .addOptionalParam('stakeLimit', 'The stake limit')
    .addOptionalParam('withdrawAddress', 'The address to withdraw to')
    .setAction(async (taskArgs, hre) => {
        const { run, network } = hre;
        const { lbtc, btcb, admin, stakeLimit, withdrawAddress } = taskArgs;
        const addresses = getAddresses(network.name);

        const _lbtc = vars.get('LBTC_ADDRESS', lbtc || addresses.LBTC);
        const _btcb = vars.get('BTCB_ADDRESS', btcb || addresses.BTCB);
        const _admin = vars.get('ADMIN_ADDRESS', admin || addresses.Owner);
        const _stakeLimit = vars.get('STAKE_LIMIT', stakeLimit);
        const _withdrawAddress = vars.get('WITHDRAW_ADDRESS', withdrawAddress);
        await run('deploy-btcbpmm', {
            lbtc: _lbtc,
            btcb: _btcb,
            admin: _admin,
            stakeLimit: _stakeLimit,
            withdrawAddress: _withdrawAddress,
        });
    });
