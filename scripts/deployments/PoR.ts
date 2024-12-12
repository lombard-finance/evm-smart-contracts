import { task } from 'hardhat/config';
import { create3 } from '../helpers/create3Deployment';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';

/*
 * After deployment:
 * 1. Add root pubkeys
 * 2. Grant operator role
 * 3. Add addresses
 */
task('deploy-por', 'Deploys the PoR contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre) => {
        const { ledgerNetwork, admin, proxyFactoryAddr } = taskArgs;

        await create3('PoR', [admin], proxyFactoryAddr, ledgerNetwork, admin, hre);
    });
